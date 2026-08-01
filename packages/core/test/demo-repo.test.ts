import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { graphFromRepo } from "../src/git/diff.js";
import { validateGraph } from "../src/graph/validate.js";
import { serializeGraph } from "../src/serialize.js";
import type { ChangeGraph } from "../src/model/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "fixtures", "make-demo-repo.sh");

/**
 * End-to-end against real git. This is the test that catches the things a
 * hand-written patch fixture never will: how git actually formats renames,
 * where it places rename detection, and what merge-base resolution returns.
 */
describe("demo repository", () => {
  let dir: string;
  let graph: ChangeGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-demo-"));
    execFileSync("bash", [SCRIPT, dir], { cwd: REPO_ROOT, stdio: "pipe" });
    graph = await graphFromRepo({
      cwd: dir,
      baseRef: "main",
      headRef: "feature/graph",
    });
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("produces one node per changed file", () => {
    expect(graph.nodes.map((n) => [n.path, n.status])).toEqual([
      ["src/AddedFile.kt", "added"],
      ["src/Consumer.kt", "modified"],
      ["src/DeletedFile.kt", "deleted"],
      ["src/MyService.kt", "modified"],
      ["src/RenamedFile.kt", "renamed"],
    ]);
  });

  it("records where the renamed file came from", () => {
    const renamed = graph.nodes.find((n) => n.status === "renamed")!;
    expect(renamed.prevPath).toBe("src/OldName.kt");
    expect(renamed.stats).toEqual({ additions: 0, deletions: 0 });
  });

  it("recognises Kotlin", () => {
    expect(new Set(graph.nodes.map((n) => n.language))).toEqual(new Set(["kotlin"]));
  });

  it("captures the call-site edit in Consumer", () => {
    const consumer = graph.nodes.find((n) => n.path === "src/Consumer.kt")!;
    const changed = consumer.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind !== "ctx")
      .map((l) => [l.kind, l.text.trim()]);
    expect(changed).toEqual([
      ["del", "myService.function2()"],
      ["add", "myService.function3()"],
    ]);
  });

  it("diffs from the merge base, not the base tip", async () => {
    const mergeBase = execFileSync("git", ["merge-base", "main", "feature/graph"], {
      cwd: dir, encoding: "utf8",
    }).trim();
    expect(graph.meta.mergeBase).toBe(mergeBase);
  });

  it("validates cleanly", () => {
    expect(validateGraph(graph)).toEqual([]);
  });

  it("serialises reproducibly", async () => {
    const again = await graphFromRepo({
      cwd: dir, baseRef: "main", headRef: "feature/graph",
    });
    expect(serializeGraph(again)).toBe(serializeGraph(graph));
  });
});
