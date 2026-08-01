import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse.js";
import { buildGraph } from "../src/graph/build.js";
import { nodeId } from "../src/model/ids.js";
import { attachEdges } from "../src/resolve/attach.js";
import { collectProbes } from "../src/resolve/probes.js";
import type { ProbeResult } from "../src/resolve/types.js";

const META = { baseRef: "main", headRef: "feature", generator: "test" };

const PATCH = [
  "diff --git a/src/caller.ts b/src/caller.ts",
  "--- a/src/caller.ts",
  "+++ b/src/caller.ts",
  "@@ -1,3 +1,3 @@",
  " const s = new Service();",
  "-s.oldWay();",
  "+s.newWay();",
  "",
].join("\n");

const graph = () => buildGraph(parseUnifiedDiff(PATCH), { meta: META });

describe("collectProbes", () => {
  it("sends added lines to head and deleted lines to base", () => {
    expect(collectProbes(graph())).toEqual([
      { path: "src/caller.ts", side: "base", line: 2, changeKind: "del" },
      { path: "src/caller.ts", side: "head", line: 2, changeKind: "add" },
    ]);
  });

  it("skips context lines unless asked for them", () => {
    const withContext = collectProbes(graph(), { includeContext: true });
    expect(withContext).toHaveLength(3);
    expect(withContext.some((p) => p.changeKind === "ctx")).toBe(true);
  });

  it("skips files the resolver does not handle", () => {
    expect(collectProbes(graph(), { languages: ["kotlin"] })).toEqual([]);
  });
});

describe("attachEdges", () => {
  const results = (): ProbeResult[] => [
    {
      probe: { path: "src/caller.ts", side: "head", line: 2, changeKind: "add" },
      targets: [{
        path: "src/service.ts", line: 9, side: "head",
        symbolName: "newWay", kind: "call", confidence: "resolved",
      }],
    },
    {
      probe: { path: "src/caller.ts", side: "base", line: 2, changeKind: "del" },
      targets: [{
        path: "src/service.ts", line: 4, side: "base",
        symbolName: "oldWay", kind: "call", confidence: "resolved",
      }],
    },
  ];

  it("colours an edge by the line its call site sits on", () => {
    const g = attachEdges(graph(), results(), { resolver: "ts" });
    const byName = new Map(g.edges.map((e) => [e.to.symbolName, e.change]));
    expect(byName.get("newWay")).toBe("added");
    expect(byName.get("oldWay")).toBe("removed");
  });

  it("materialises untouched targets as phantom nodes", () => {
    const g = attachEdges(graph(), results(), { resolver: "ts" });
    const service = g.nodes.find((n) => n.path === "src/service.ts");
    expect(service?.status).toBe("phantom");
    expect(service?.id).toBe(nodeId("src/service.ts"));
  });

  it("can be told to leave untouched targets out", () => {
    const g = attachEdges(graph(), results(), {
      resolver: "ts",
      includePhantoms: false,
    });
    expect(g.nodes.map((n) => n.path)).toEqual(["src/caller.ts"]);
  });

  it("drops references that stay inside one file", () => {
    const selfResult: ProbeResult[] = [{
      probe: { path: "src/caller.ts", side: "head", line: 2, changeKind: "add" },
      targets: [{
        path: "src/caller.ts", line: 7, side: "head",
        symbolName: "helper", kind: "call", confidence: "resolved",
      }],
    }];
    expect(attachEdges(graph(), selfResult, { resolver: "ts" }).edges).toEqual([]);
    expect(
      attachEdges(graph(), selfResult, {
        resolver: "ts",
        includeSelfReferences: true,
      }).edges,
    ).toHaveLength(1);
  });

  it("collapses duplicate references to a single edge", () => {
    const twice = [...results(), ...results()];
    expect(attachEdges(graph(), twice, { resolver: "ts" }).edges).toHaveLength(2);
  });

  it("routes a renamed file's base-side references to the same vertex", () => {
    const renamePatch = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 90%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -1 +1 @@",
      "-call();",
      "+call2();",
      "",
    ].join("\n");
    const renamed = buildGraph(parseUnifiedDiff(renamePatch), { meta: META });

    const g = attachEdges(
      renamed,
      [{
        probe: { path: "src/old.ts", side: "base", line: 1, changeKind: "del" },
        targets: [{
          path: "src/target.ts", line: 1, side: "base",
          symbolName: "call", kind: "call", confidence: "resolved",
        }],
      }],
      { resolver: "ts" },
    );

    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.from.nodeId).toBe(nodeId("src/new.ts"));
  });
});
