import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { graphFromRepo } from "../src/git/diff.js";
import { refExists, resolveBaseRef } from "../src/git/exec.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A repository whose default branch has the given name. */
function repo(defaultBranch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-base-ref-"));
  created.push(dir);

  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
      },
    });

  run("init", "--quiet", `--initial-branch=${defaultBranch}`);
  run("config", "user.name", "Fixture");
  run("config", "user.email", "fixture@odin.local");
  run("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  run("add", "-A");
  run("commit", "--quiet", "-m", "base");
  return dir;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" });
}

describe("resolveBaseRef", () => {
  it("keeps a base that exists", async () => {
    const dir = repo("main");
    expect(await resolveBaseRef("main", { cwd: dir })).toBe("main");
  });

  it("falls back to master when main does not exist", async () => {
    // The configured default is `main`, but plenty of repositories predate it.
    const dir = repo("master");
    expect(await resolveBaseRef("main", { cwd: dir })).toBe("master");
  });

  it("detects the base when none is configured", async () => {
    const dir = repo("develop");
    expect(await resolveBaseRef(undefined, { cwd: dir })).toBe("develop");
  });

  it("finds the remote copy when no local branch exists", async () => {
    // What a worktree or a shallow CI clone looks like: the branch is only
    // present as a remote-tracking ref.
    const origin = repo("main");
    const clone = mkdtempSync(join(tmpdir(), "odin-clone-"));
    created.push(clone);
    execFileSync("git", ["clone", "--quiet", origin, clone], { stdio: "pipe" });
    git(clone, "checkout", "--quiet", "-b", "feature");
    git(clone, "branch", "--quiet", "-D", "main");

    expect(await refExists("main", { cwd: clone })).toBe(false);
    expect(await resolveBaseRef("main", { cwd: clone })).toBe("origin/main");
  });

  it("reports what is available when nothing matches", async () => {
    const dir = repo("release-2024");
    await expect(resolveBaseRef("nope", { cwd: dir })).rejects.toThrow(
      /no base branch found.*release-2024/s,
    );
  });
});

describe("graphFromRepo", () => {
  it("records the base it actually used, not the one requested", async () => {
    const dir = repo("master");
    git(dir, "checkout", "--quiet", "-b", "feature");
    writeFileSync(join(dir, "a.txt"), "two\n");
    git(dir, "commit", "--quiet", "-am", "change");

    const graph = await graphFromRepo({ cwd: dir, baseRef: "main" });
    expect(graph.meta.baseRef).toBe("master");
    expect(graph.nodes.map((n) => n.path)).toEqual(["a.txt"]);
  });

  it("works in a linked worktree with no local base branch", async () => {
    const dir = repo("main");
    git(dir, "checkout", "--quiet", "-b", "feature");
    writeFileSync(join(dir, "a.txt"), "two\n");
    git(dir, "commit", "--quiet", "-am", "change");

    const tree = mkdtempSync(join(tmpdir(), "odin-wt-"));
    created.push(tree);
    rmSync(tree, { recursive: true, force: true });
    git(dir, "worktree", "add", "--quiet", tree, "feature", "--force");

    const graph = await graphFromRepo({ cwd: tree, baseRef: "main" });
    expect(graph.meta.baseRef).toBe("main");
    expect(graph.meta.mergeBase).toBeDefined();

    git(dir, "worktree", "remove", "--force", tree);
  });
});
