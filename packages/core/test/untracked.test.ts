import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { graphFromRepo } from "../src/git/diff.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository with one commit, and a branch to measure against. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-untracked-"));
  created.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  git("init", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n*.log\n");
  writeFileSync(join(dir, "kept.ts"), "export const kept = 1;\n");
  git("add", "-A");
  git("commit", "-m", "first");
  git("branch", "base", "HEAD");
  return dir;
}

/**
 * Files git has never been told about.
 *
 * `git diff` cannot see one: it compares the index and the tree to a commit,
 * and a file that has never been added is in none of those. So a reading of the
 * working tree showed every edit to an existing file and nothing at all of the
 * new ones — and a change is very often mostly new files, which to the reader
 * are the most changed thing in it, having just been written.
 */
describe("a working tree with files that were never added", () => {
  it("shows them as part of the change", async () => {
    const cwd = repo();
    writeFileSync(join(cwd, "kept.ts"), "export const kept = 2;\n");
    writeFileSync(join(cwd, "brandNew.ts"), "export const fresh = 1;\n");

    const graph = await graphFromRepo({ cwd, baseRef: "base", worktree: true });
    const paths = graph.nodes.map((n) => n.path).sort();
    expect(paths).toEqual(["brandNew.ts", "kept.ts"]);
  }, 30_000);

  it("reads their contents, not just their names", async () => {
    const cwd = repo();
    writeFileSync(join(cwd, "brandNew.ts"), "export const fresh = 1;\nexport const also = 2;\n");

    const graph = await graphFromRepo({ cwd, baseRef: "base", worktree: true });
    const node = graph.nodes.find((n) => n.path === "brandNew.ts");
    expect(node?.status).toBe("added");
    expect(node?.stats.additions).toBe(2);
    const text = node?.hunks.flatMap((h) => h.lines.map((l) => l.text)).join("\n");
    expect(text).toContain("export const fresh = 1;");
  }, 30_000);

  it("leaves out whatever the repository ignores", async () => {
    // Otherwise build output and dependencies arrive as somebody's change, and
    // a `node_modules` is a great many files.
    const cwd = repo();
    mkdirSync(join(cwd, "ignored"), { recursive: true });
    writeFileSync(join(cwd, "ignored", "out.js"), "//\n");
    writeFileSync(join(cwd, "noise.log"), "\n");
    writeFileSync(join(cwd, "brandNew.ts"), "export const fresh = 1;\n");

    const graph = await graphFromRepo({ cwd, baseRef: "base", worktree: true });
    expect(graph.nodes.map((n) => n.path)).toEqual(["brandNew.ts"]);
  }, 30_000);

  it("says nothing about them in a reading of commits", async () => {
    // A file nobody has committed is in no commit. A committed reading that
    // showed it would be describing something the forge cannot see.
    const cwd = repo();
    writeFileSync(join(cwd, "brandNew.ts"), "export const fresh = 1;\n");

    const graph = await graphFromRepo({ cwd, baseRef: "base" });
    expect(graph.nodes.map((n) => n.path)).not.toContain("brandNew.ts");
  }, 30_000);
});
