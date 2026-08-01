import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse.js";
import { addPhantomNodes, buildGraph, sortGraph } from "../src/graph/build.js";
import { isTestPath, withoutTests } from "../src/graph/tests.js";
import { validateGraph } from "../src/graph/validate.js";
import { edgeId, nodeId } from "../src/model/ids.js";
import { serializeGraph } from "../src/serialize.js";
import { SCHEMA_VERSION, type ChangeGraph, type Edge } from "../src/model/types.js";

const META = { baseRef: "main", headRef: "feature", generator: "test" };

const PATCH = [
  "diff --git a/src/Zed.ts b/src/Zed.ts",
  "--- a/src/Zed.ts",
  "+++ b/src/Zed.ts",
  "@@ -1 +1 @@",
  "-a",
  "+b",
  "diff --git a/src/Alpha.ts b/src/Alpha.ts",
  "--- a/src/Alpha.ts",
  "+++ b/src/Alpha.ts",
  "@@ -1 +1 @@",
  "-c",
  "+d",
  "",
].join("\n");

describe("buildGraph", () => {
  it("sorts nodes by path regardless of patch order", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    expect(graph.nodes.map((n) => n.path)).toEqual(["src/Alpha.ts", "src/Zed.ts"]);
  });

  it("derives node ids from the path alone", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    expect(graph.nodes[0]!.id).toBe(nodeId("src/Alpha.ts"));
  });

  it("detects language from the extension", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    expect(graph.nodes.every((n) => n.language === "typescript")).toBe(true);
  });
});

describe("determinism", () => {
  it("serialises identically across repeated builds", () => {
    const a = serializeGraph(buildGraph(parseUnifiedDiff(PATCH), { meta: META }));
    const b = serializeGraph(buildGraph(parseUnifiedDiff(PATCH), { meta: META }));
    expect(a).toBe(b);
  });

  it("is insensitive to the order nodes were appended in", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    const shuffled: ChangeGraph = { ...graph, nodes: [...graph.nodes].reverse() };
    expect(serializeGraph(shuffled)).toBe(serializeGraph(graph));
  });

  it("emits object keys in the canonical order", () => {
    const json = serializeGraph(buildGraph([], { meta: META }));
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual(["schemaVersion", "meta", "nodes", "edges"]);
  });
});

describe("addPhantomNodes", () => {
  it("adds untouched referenced files with phantom status", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    const withPhantom = addPhantomNodes(graph, [
      { nodeId: nodeId("src/Untouched.ts"), path: "src/Untouched.ts" },
    ]);
    const phantom = withPhantom.nodes.find((n) => n.path === "src/Untouched.ts");
    expect(phantom?.status).toBe("phantom");
    expect(phantom?.hunks).toEqual([]);
  });

  it("never shadows a node that is already in the diff", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    const same = addPhantomNodes(graph, [
      { nodeId: nodeId("src/Zed.ts"), path: "src/Zed.ts" },
    ]);
    expect(same.nodes).toHaveLength(2);
    expect(same.nodes.find((n) => n.path === "src/Zed.ts")!.status).toBe("modified");
  });
});

describe("test files", () => {
  it("recognises the conventions of each ecosystem", () => {
    for (const path of [
      "backend/src/test/kotlin/com/x/FooTests.kt",
      "src/main/kotlin/com/x/WidgetTest.kt",
      "web/src/thing.spec.ts",
      "web/__tests__/thing.ts",
      "api/tests/test_users.py",
      "api/users_test.py",
      "svc/handler_test.go",
      "app/spec/models/user_spec.rb",
    ]) {
      expect(isTestPath(path)).toBe(true);
    }
  });

  it("does not mistake production code for tests", () => {
    for (const path of [
      "src/main/kotlin/com/x/Widget.kt",
      "src/testing/Harness.kt",
      "web/src/latest.ts",
      "web/src/protest.ts",
    ]) {
      expect(isTestPath(path)).toBe(false);
    }
  });

  it("drops tests and the edges that only they had", () => {
    const base = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    const test = {
      ...base.nodes[0]!,
      id: nodeId("src/Zed.test.ts"),
      path: "src/Zed.test.ts",
      isTest: true,
    };
    const from = { nodeId: test.id, side: "head" as const, line: 1 };
    const to = { nodeId: base.nodes[0]!.id, side: "head" as const, line: 1 };
    const withTest = sortGraph({
      ...base,
      nodes: [...base.nodes, test],
      edges: [{
        id: edgeId(from, to, "call"), from, to,
        change: "added" as const, kind: "call" as const,
        confidence: "resolved" as const, resolver: "ts" as const,
      }],
    });

    const trimmed = withoutTests(withTest);
    expect(trimmed.nodes.some((n) => n.path === "src/Zed.test.ts")).toBe(false);
    expect(trimmed.edges).toEqual([]);
  });

  it("drops a file only a test pulled in", () => {
    const base = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    const withPhantom = addPhantomNodes(base, [
      { nodeId: nodeId("src/OnlyForTests.ts"), path: "src/OnlyForTests.ts" },
    ]);
    // No edge survives to it, so the phantom has nothing left to say.
    expect(
      withoutTests(withPhantom).nodes.some((n) => n.status === "phantom"),
    ).toBe(false);
  });
});

describe("validateGraph", () => {
  it("accepts a well-formed graph", () => {
    expect(validateGraph(buildGraph(parseUnifiedDiff(PATCH), { meta: META }))).toEqual([]);
  });

  it("reports edges pointing at unknown nodes", () => {
    const base = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    const from = { nodeId: base.nodes[0]!.id, side: "head" as const, line: 1 };
    const to = { nodeId: nodeId("src/Nowhere.ts"), side: "head" as const, line: 1 };
    const edge: Edge = {
      id: edgeId(from, to, "call"),
      from,
      to,
      change: "added",
      kind: "call",
      confidence: "guess",
      resolver: "regex",
    };
    const issues = validateGraph(sortGraph({ ...base, edges: [edge] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/unknown node/);
  });

  it("reports hunk headers that disagree with their body", () => {
    const graph = buildGraph(parseUnifiedDiff(PATCH), { meta: META });
    graph.nodes[0]!.hunks[0]!.newLines = 99;
    expect(validateGraph(graph)[0]!.message).toMatch(/claims 99 head lines/);
  });

  it("rejects a mismatched schema version", () => {
    const graph = buildGraph([], { meta: META });
    const wrong = { ...graph, schemaVersion: "9.9.9" } as unknown as ChangeGraph;
    expect(validateGraph(wrong)[0]!.message).toMatch(SCHEMA_VERSION);
  });
});
