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

describe("a base branch this checkout has not kept up with", () => {
  /** A bare "forge", a seed clone that pushes to it, and a working clone. */
  function shared(): { seed: string; clone: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "odin-base-fresh-"));
    const origin = join(dir, "origin.git");
    const seed = join(dir, "seed");
    const clone = join(dir, "clone");
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });

    execFileSync("git", ["init", "--bare", "-b", "develop", origin], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "develop", seed], { stdio: "ignore" });
    git(["config", "user.email", "t@example.test"], seed);
    git(["config", "user.name", "T"], seed);
    writeFileSync(join(seed, "a.txt"), "one\n");
    git(["add", "."], seed);
    git(["commit", "-m", "first"], seed);
    git(["remote", "add", "origin", origin], seed);
    git(["push", "origin", "develop"], seed);
    execFileSync("git", ["clone", origin, clone], { stdio: "ignore" });
    git(["config", "user.email", "t@example.test"], clone);
    git(["config", "user.name", "T"], clone);
    return { seed, clone, dir };
  }

  it("prefers the forge's copy when the local one is behind", async () => {
    // A long-lived `develop` gains commits daily, and a merge base computed
    // against a week-old copy of it reports everything that landed on
    // `develop` that week — and came onto the branch through a merge — as part
    // of the change. Somebody else's work, under your name.
    const { seed, clone, dir } = shared();
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });

    writeFileSync(join(seed, "b.txt"), "two\n");
    git(["add", "."], seed);
    git(["commit", "-m", "second"], seed);
    git(["push", "origin", "develop"], seed);
    // Fetched but not merged, which is what a background fetch leaves behind.
    git(["fetch", "origin"], clone);

    expect(await resolveBaseRef("develop", { cwd: clone })).toBe("origin/develop");
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it("keeps the local branch when it is the one that is ahead", async () => {
    // Commits on the base that were never pushed are still part of the base
    // this branch was cut from; dropping to the forge's copy would report them
    // as the change.
    const { clone, dir } = shared();
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });

    writeFileSync(join(clone, "c.txt"), "mine\n");
    git(["add", "."], clone);
    git(["commit", "-m", "local only"], clone);

    expect(await resolveBaseRef("develop", { cwd: clone })).toBe("develop");
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
