import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachEdges,
  collectProbes,
  graphFromRepo,
  materializeTree,
  type ChangeGraph,
  type Checkout,
} from "@odin/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TsResolver } from "../src/resolver.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "fixtures", "make-demo-repo-ts.sh");

/** Shorthand for asserting on an edge: "who calls what, and is it added or removed". */
function describeEdges(graph: ChangeGraph): string[] {
  const path = new Map(graph.nodes.map((n) => [n.id, n.path]));
  return graph.edges.map(
    (e) =>
      `${e.change} ${path.get(e.from.nodeId)}:${e.from.line} -> ` +
      `${path.get(e.to.nodeId)}:${e.to.line} ${e.to.symbolName}`,
  );
}

describe("TsResolver on the demo repository", () => {
  let dir: string;
  let base: Checkout;
  let graph: ChangeGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-ts-"));
    execFileSync("bash", [SCRIPT, dir], { cwd: REPO_ROOT, stdio: "pipe" });

    const raw = await graphFromRepo({
      cwd: dir, baseRef: "main", headRef: "feature/graph",
    });
    base = await materializeTree(raw.meta.mergeBase!, { cwd: dir });

    const resolver = new TsResolver({ roots: { head: dir, base: base.dir } });
    const results = await resolver.resolve(
      collectProbes(raw, {
        languages: ["typescript", "typescriptreact", "javascript"],
      }),
    );
    graph = attachEdges(raw, results, { resolver: "ts" });
    resolver.dispose();
  }, 120_000);

  afterAll(() => {
    base?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the added call from the new file", () => {
    expect(describeEdges(graph)).toContain(
      "added src/addedFile.ts:9 -> src/myService.ts:2 function1",
    );
  });

  it("resolves both sides of a call site that was retargeted", () => {
    const lines = describeEdges(graph);
    // Base and head disagree on where function2/function3 live, which only
    // comes out right if each side is resolved against its own checkout.
    expect(lines).toContain("removed src/consumer.ts:7 -> src/myService.ts:10 function2");
    expect(lines).toContain("added src/consumer.ts:7 -> src/myService.ts:10 function3");
  });

  it("resolves references leaving a file that no longer exists", () => {
    expect(describeEdges(graph)).toContain(
      "removed src/deletedFile.ts:7 -> src/myService.ts:10 function2",
    );
  });

  it("resolves a reference into a file that was deleted", () => {
    expect(describeEdges(graph)).toContain(
      "removed src/myService.ts:12 -> src/deletedFile.ts:10 anotherFunction2",
    );
  });

  it("pulls an untouched but newly referenced file in as a phantom", () => {
    const logger = graph.nodes.find((n) => n.path === "src/logger.ts");
    expect(logger?.status).toBe("phantom");
    expect(describeEdges(graph)).toContain(
      "added src/addedFile.ts:8 -> src/logger.ts:1 log",
    );
  });

  it("trusts every edge it produced", () => {
    expect(graph.edges.every((e) => e.confidence === "resolved")).toBe(true);
    expect(graph.edges.every((e) => e.resolver === "ts")).toBe(true);
  });

  it("never points at a dependency", () => {
    // `console.log` resolves into lib.dom.d.ts and must not become a vertex.
    expect(graph.nodes.every((n) => !n.path.includes("node_modules"))).toBe(true);
    expect(graph.edges.every((e) => e.to.symbolName !== "log" ||
      graph.nodes.some((n) => n.id === e.to.nodeId && n.path === "src/logger.ts"))).toBe(true);
  });

  it("records the nearest enclosing declaration of each call site", () => {
    // The method, not the class: that is the unit a reviewer reasons about.
    const call = graph.edges.find((e) => e.to.symbolName === "function1");
    expect(call?.from.symbolName).toBe("myNewFunction");
  });
});
