import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse.js";
import { buildGraph, sortGraph } from "../src/graph/build.js";
import { layoutGraph } from "../src/layout/layout.js";
import { edgeId } from "../src/model/ids.js";
import type { ChangeGraph, Edge } from "../src/model/types.js";

const META = { baseRef: "main", headRef: "feature", generator: "test" };

function file(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
}

function chain(paths: string[], links: [string, string][]): ChangeGraph {
  const base = buildGraph(parseUnifiedDiff(`${paths.map(file).join("\n")}\n`), { meta: META });
  const id = (path: string) => base.nodes.find((n) => n.path === path)!.id;
  const edges: Edge[] = links.map(([from, to]) => {
    const a = { nodeId: id(from), side: "head" as const, line: 1 };
    const b = { nodeId: id(to), side: "head" as const, line: 1 };
    return { id: edgeId(a, b, "call"), from: a, to: b, change: "added", kind: "call", confidence: "resolved", resolver: "ts" };
  });
  return sortGraph({ ...base, edges });
}

function ranks(graph: ChangeGraph): Record<string, number> {
  const layout = layoutGraph(graph);
  return Object.fromEntries(
    layout.nodes.map((placed) => [graph.nodes.find((n) => n.id === placed.id)!.path, placed.rank]),
  );
}

describe("which column a file lands in", () => {
  it("puts a file that only points at the far end beside it, not in the first column", () => {
    const graph = chain(
      ["Order.kt", "OrderService.kt", "OrderDao.kt", "schema.sql", "V2__orders.sql"],
      [
        ["Order.kt", "OrderService.kt"],
        ["OrderService.kt", "OrderDao.kt"],
        ["OrderDao.kt", "schema.sql"],
        ["V2__orders.sql", "schema.sql"],
      ],
    );
    const at = ranks(graph);
    expect(at["V2__orders.sql"]).toBe(at["schema.sql"]! - 1);
    expect(at["Order.kt"]).toBe(0);
  });

  it("keeps a file beside the nearest of the files it points at", () => {
    const graph = chain(
      ["Main.kt", "Middle.kt", "End.kt", "Both.kt"],
      [
        ["Main.kt", "Middle.kt"],
        ["Middle.kt", "End.kt"],
        ["Both.kt", "Middle.kt"],
        ["Both.kt", "End.kt"],
      ],
    );
    const at = ranks(graph);
    expect(at["Both.kt"]).toBe(at["Middle.kt"]! - 1);
  });

  it("never sends an arrow backwards", () => {
    const graph = chain(
      ["A.kt", "B.kt", "C.kt", "D.kt", "E.kt"],
      [
        ["A.kt", "B.kt"],
        ["B.kt", "C.kt"],
        ["C.kt", "D.kt"],
        ["E.kt", "D.kt"],
        ["E.kt", "B.kt"],
      ],
    );
    const at = ranks(graph);
    for (const edge of graph.edges) {
      const from = graph.nodes.find((n) => n.id === edge.from.nodeId)!.path;
      const to = graph.nodes.find((n) => n.id === edge.to.nodeId)!.path;
      expect(at[from]!).toBeLessThan(at[to]!);
    }
  });
});
