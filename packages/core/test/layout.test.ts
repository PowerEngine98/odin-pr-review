import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse.js";
import { toSvg } from "../src/export/svg.js";
import { addPhantomNodes, buildGraph, sortGraph } from "../src/graph/build.js";
import {
  cardTitle,
  displayRows,
  rowForLine,
  titleLength,
} from "../src/layout/display.js";
import { layoutGraph } from "../src/layout/layout.js";
import { DEFAULT_METRICS } from "../src/layout/metrics.js";
import { edgeId, nodeId } from "../src/model/ids.js";
import type { ChangeGraph, Edge, Endpoint } from "../src/model/types.js";

const META = { baseRef: "main", headRef: "feature", generator: "test" };

const PATCH = [
  "diff --git a/src/caller.ts b/src/caller.ts",
  "--- a/src/caller.ts",
  "+++ b/src/caller.ts",
  "@@ -1,4 +1,4 @@",
  " export function run() {",
  "-  target.oldWay();",
  "+  target.newWay();",
  " }",
  "diff --git a/src/target.ts b/src/target.ts",
  "--- a/src/target.ts",
  "+++ b/src/target.ts",
  "@@ -1,5 +1,6 @@",
  " export const target = {",
  "-  oldWay() {},",
  "+  newWay() {},",
  "+  extra() {},",
  " };",
  "diff --git a/src/lonely.ts b/src/lonely.ts",
  "--- a/src/lonely.ts",
  "+++ b/src/lonely.ts",
  "@@ -1 +1 @@",
  "-const a = 1;",
  "+const a = 2;",
  "",
].join("\n");

function edge(from: Endpoint, to: Endpoint, change: Edge["change"]): Edge {
  return {
    id: edgeId(from, to, "call"),
    from,
    to,
    change,
    kind: "call",
    confidence: "resolved",
    resolver: "ts",
  };
}

function graph(): ChangeGraph {
  const base = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
  const caller = base.nodes.find((n) => n.path === "src/caller.ts")!;
  const target = base.nodes.find((n) => n.path === "src/target.ts")!;

  return sortGraph({
    ...base,
    edges: [
      edge(
        { nodeId: caller.id, side: "head", line: 2 },
        { nodeId: target.id, side: "head", line: 2, symbolName: "newWay" },
        "added",
      ),
      edge(
        { nodeId: caller.id, side: "base", line: 2 },
        { nodeId: target.id, side: "base", line: 2, symbolName: "oldWay" },
        "removed",
      ),
    ],
  });
}

describe("displayRows", () => {
  it("renders every hunk line in order", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    expect(displayRows(node).map((r) => r.kind)).toEqual(["ctx", "del", "add", "ctx"]);
  });

  it("inserts a gap where the line numbering jumps", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    const rows = displayRows(node, [
      { side: "head", startLine: 40, lines: ["far away"] },
    ]);
    expect(rows.some((r) => r.kind === "gap")).toBe(true);
    expect(rows[rows.length - 1]!.text).toBe("far away");
  });

  it("drops a snippet the diff already shows", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    const rows = displayRows(node, [
      { side: "head", startLine: 2, lines: ["  target.newWay();"] },
    ]);
    expect(rows).toHaveLength(4);
  });

  it("collapses a long run of untouched code no arrow reaches", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    const rows = displayRows(node, [
      { side: "head", startLine: 20, lines: Array.from({ length: 12 }, (_, i) => `line ${i}`) },
    ]);

    // The run sits far from any change and nothing points at it, so it becomes
    // one band rather than twelve rows of noise.
    const gaps = rows.filter((r) => r.kind === "gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.kind === "gap" && gaps[0]!.hidden).toBe(27);
    expect(rows.some((r) => r.text === "line 6")).toBe(false);
  });

  it("keeps a line an arrow lands on, and its neighbours", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    const rows = displayRows(
      node,
      [{ side: "head", startLine: 20, lines: Array.from({ length: 12 }, (_, i) => `line ${i}`) }],
      { anchors: [{ side: "head", line: 26 }] },
    );

    expect(rows.some((r) => r.text === "line 6")).toBe(true);
    expect(rowForLine(rows, "head", 26)).toBeDefined();
    // Two lines of context on each side of the anchor survive with it.
    expect(rows.some((r) => r.text === "line 4")).toBe(true);
    expect(rows.some((r) => r.text === "line 8")).toBe(true);
    expect(rows.some((r) => r.text === "line 0")).toBe(false);
  });

  it("labels a gap with the hunk header it opens", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    node.hunks[0]!.newStart = 40;
    node.hunks[0]!.oldStart = 40;
    node.hunks[0]!.header = "export function run()";
    const first = displayRows(node)[0]!;
    expect(first.kind).toBe("gap");
    expect(first.kind === "gap" && first.header).toBe(
      "@@ -40,4 +40,4 @@ export function run()",
    );
  });

  it("never emits two gaps in a row", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    const rows = displayRows(node, [
      { side: "head", startLine: 30, lines: Array.from({ length: 8 }, () => "x") },
      { side: "head", startLine: 60, lines: Array.from({ length: 8 }, () => "y") },
    ]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.kind === "gap" && rows[i - 1]!.kind === "gap").toBe(false);
    }
  });

  it("finds the row for a line on the side the card shows", () => {
    const node = graph().nodes.find((n) => n.path === "src/caller.ts")!;
    const rows = displayRows(node);
    expect(rowForLine(rows, "head", 2)).toBe(2);
    expect(rowForLine(rows, "base", 2)).toBe(1);
    expect(rowForLine(rows, "head", 999)).toBeUndefined();
  });
});

describe("layoutGraph", () => {
  it("produces identical geometry on every run", () => {
    const a = layoutGraph(graph());
    const b = layoutGraph(graph());
    expect(JSON.stringify(positions(a))).toBe(JSON.stringify(positions(b)));
  });

  it("is unaffected by the order nodes arrive in", () => {
    const original = graph();
    const reversed: ChangeGraph = { ...original, nodes: [...original.nodes].reverse() };
    expect(JSON.stringify(positions(layoutGraph(reversed)))).toBe(
      JSON.stringify(positions(layoutGraph(original))),
    );
  });

  it("places a target to the right of what references it", () => {
    const layout = layoutGraph(graph());
    const caller = layout.nodes.find((n) => n.path === "src/caller.ts")!;
    const target = layout.nodes.find((n) => n.path === "src/target.ts")!;
    expect(caller.rank).toBeLessThan(target.rank);
    expect(caller.x).toBeLessThan(target.x);
  });

  it("parks files with no references in a trailing column", () => {
    const layout = layoutGraph(graph());
    const lonely = layout.nodes.find((n) => n.path === "src/lonely.ts")!;
    const others = layout.nodes.filter((n) => n.path !== "src/lonely.ts");
    expect(others.every((n) => n.rank < lonely.rank)).toBe(true);
  });

  it("anchors each arrow to the row holding its line", () => {
    const layout = layoutGraph(graph());
    const added = layout.edges.find((e) => e.edge.change === "added")!;
    const removed = layout.edges.find((e) => e.edge.change === "removed")!;

    // The added call sits on the row below the removed one, in both cards.
    expect(added.fromRow).toBe(2);
    expect(removed.fromRow).toBe(1);
    expect(added.from.y).toBeGreaterThan(removed.from.y);
    expect(added.toRow).toBe(2);
    expect(removed.toRow).toBe(1);
  });

  it("falls back to the card edge when the line is off screen", () => {
    const base = graph();
    const target = base.nodes.find((n) => n.path === "src/target.ts")!;
    const caller = base.nodes.find((n) => n.path === "src/caller.ts")!;
    const offScreen = sortGraph({
      ...base,
      edges: [
        edge(
          { nodeId: caller.id, side: "head", line: 2 },
          { nodeId: target.id, side: "head", line: 900, symbolName: "gone" },
          "added",
        ),
      ],
    });

    const placed = layoutGraph(offScreen).edges[0]!;
    expect(placed.toRow).toBeUndefined();
    const card = layoutGraph(offScreen).nodes.find((n) => n.id === target.id)!;
    expect(placed.to.y).toBe(card.y + card.height / 2);
  });

  it("terminates on a cycle instead of ranking forever", () => {
    const base = graph();
    const caller = base.nodes.find((n) => n.path === "src/caller.ts")!;
    const target = base.nodes.find((n) => n.path === "src/target.ts")!;
    const cyclic = sortGraph({
      ...base,
      edges: [
        ...base.edges,
        edge(
          { nodeId: target.id, side: "head", line: 2 },
          { nodeId: caller.id, side: "head", line: 1, symbolName: "run" },
          "added",
        ),
      ],
    });

    const layout = layoutGraph(cyclic);
    expect(layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it("sizes cards to their widest line plus both gutters", () => {
    const layout = layoutGraph(graph());
    const { charWidth, gutterWidth, rightGutterWidth, padding, maxCardWidth } =
      layout.metrics;

    for (const node of layout.nodes) {
      const widest = node.rows.reduce((max, r) => Math.max(max, r.text.length), 0);
      const needed =
        widest * charWidth + gutterWidth + rightGutterWidth + padding * 2;
      expect(node.width).toBeGreaterThanOrEqual(
        Math.min(needed, maxCardWidth) - 1,
      );
    }
  });
});

describe("card titles", () => {
  it("measures the whole header, not just the path", () => {
    const base = graph();
    const renamePatch = [
      "diff --git a/src/a.ts b/src/some-considerably-longer-name.ts",
      "similarity index 100%",
      "rename from src/a.ts",
      "rename to src/some-considerably-longer-name.ts",
      "",
    ].join("\n");
    const renamed = buildGraph(parseUnifiedDiff(renamePatch), { meta: META });
    const node = renamed.nodes[0]!;

    // The card also shows "← a.ts" and the line counts; measuring the path
    // alone would overflow the header and read as missing padding.
    const title = cardTitle(node);
    expect(title.was).toBe("← a.ts");
    expect(titleLength(title)).toBeGreaterThan(node.path.length);

    const card = layoutGraph(renamed).nodes[0]!;
    const needed = titleLength(title) * DEFAULT_METRICS.charWidth;
    expect(card.width).toBeGreaterThan(needed);
    void base;
  });

  it("labels an untouched file rather than showing zero counts", () => {
    const withPhantom = addPhantomNodes(graph(), [
      { nodeId: nodeId("src/never.ts"), path: "src/never.ts" },
    ]);
    const phantom = withPhantom.nodes.find((n) => n.path === "src/never.ts")!;
    expect(cardTitle(phantom).stats).toBe("untouched");
  });
});

describe("toSvg", () => {
  it("emits one card and one arrow per element", () => {
    const svg = toSvg(layoutGraph(graph()));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<rect[^>]*rx="14"/g)).toHaveLength(3);
    expect(svg.match(/marker-end/g)).toHaveLength(2);
  });

  it("escapes source text so code cannot break the document", () => {
    const svg = toSvg(layoutGraph(graph()));
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<(?!\/text)/);
  });

  it("renders the same bytes every time", () => {
    expect(toSvg(layoutGraph(graph()))).toBe(toSvg(layoutGraph(graph())));
  });
});

function positions(layout: ReturnType<typeof layoutGraph>) {
  return layout.nodes.map((n) => [n.path, n.x, n.y, n.width, n.height, n.rank]);
}
