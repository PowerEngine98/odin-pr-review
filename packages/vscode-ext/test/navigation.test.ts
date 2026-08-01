import { describe, expect, it } from "vitest";

import { buildGraph, parseUnifiedDiff, type ChangeGraph } from "@odin/core";

import { destinationFor, diffTargetsFor } from "../src/navigation.js";

const REPO = "/repo";

const PATCH = [
  "diff --git a/src/kept.ts b/src/kept.ts",
  "--- a/src/kept.ts",
  "+++ b/src/kept.ts",
  "@@ -1 +1 @@",
  "-a();",
  "+b();",
  "diff --git a/src/gone.ts b/src/gone.ts",
  "deleted file mode 100644",
  "--- a/src/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-old();",
  "diff --git a/src/fresh.ts b/src/fresh.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/fresh.ts",
  "@@ -0,0 +1 @@",
  "+brand();",
  "diff --git a/src/before.ts b/src/after.ts",
  "similarity index 90%",
  "rename from src/before.ts",
  "rename to src/after.ts",
  "--- a/src/before.ts",
  "+++ b/src/after.ts",
  "@@ -1 +1 @@",
  "-x();",
  "+y();",
  "",
].join("\n");

function graph(): ChangeGraph {
  return buildGraph(parseUnifiedDiff(PATCH), {
    meta: {
      baseRef: "main",
      headRef: "feature",
      mergeBase: "abc123",
      generator: "test",
    },
  });
}

describe("destinationFor", () => {
  it("sends a head-side reference to the working tree", () => {
    expect(destinationFor(graph(), REPO, "src/kept.ts", 12, "head")).toEqual({
      kind: "file",
      path: "/repo/src/kept.ts",
      line: 12,
    });
  });

  it("sends a base-side reference to the merge base", () => {
    // The line it points at no longer exists on disk, so opening the working
    // tree would silently show the wrong code.
    expect(destinationFor(graph(), REPO, "src/kept.ts", 4, "base")).toEqual({
      kind: "base",
      path: "src/kept.ts",
      sha: "abc123",
      line: 4,
    });
  });

  it("sends anything inside a deleted file to the merge base", () => {
    const destination = destinationFor(graph(), REPO, "src/gone.ts", 1, "head");
    expect(destination.kind).toBe("base");
    expect(destination.sha).toBe("abc123");
  });

  it("uses the old path when following a rename backwards", () => {
    expect(destinationFor(graph(), REPO, "src/after.ts", 1, "base")).toEqual({
      kind: "base",
      path: "src/before.ts",
      sha: "abc123",
      line: 1,
    });
  });

  it("falls back to the working tree when there is no merge base", () => {
    const noBase = { ...graph(), meta: { ...graph().meta, mergeBase: undefined } };
    expect(destinationFor(noBase, REPO, "src/kept.ts", 3, "base").kind).toBe("file");
  });
});

describe("diffTargetsFor", () => {
  it("compares a modified file against the base", () => {
    const targets = diffTargetsFor(graph(), REPO, "src/kept.ts");
    expect(targets.base).toEqual({ path: "src/kept.ts", sha: "abc123" });
    expect(targets.head).toBe("/repo/src/kept.ts");
    expect(targets.title).toContain("main ↔ feature");
  });

  it("compares a renamed file against its original path", () => {
    expect(diffTargetsFor(graph(), REPO, "src/after.ts").base).toEqual({
      path: "src/before.ts",
      sha: "abc123",
    });
  });

  it("shows a deleted file's base side alone", () => {
    const targets = diffTargetsFor(graph(), REPO, "src/gone.ts");
    expect(targets.base).toBeDefined();
    expect(targets.head).toBeUndefined();
  });

  it("just opens an added file, which has no base side", () => {
    const targets = diffTargetsFor(graph(), REPO, "src/fresh.ts");
    expect(targets.base).toBeUndefined();
    expect(targets.head).toBe("/repo/src/fresh.ts");
  });

  it("just opens a file the diff never mentioned", () => {
    const targets = diffTargetsFor(graph(), REPO, "src/untouched.ts");
    expect(targets.base).toBeUndefined();
    expect(targets.head).toBe("/repo/src/untouched.ts");
  });
});
