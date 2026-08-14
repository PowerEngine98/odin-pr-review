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

  /*
   * Which copy of the base a reading is measured against.
   *
   * Decided by what is being read rather than by whichever copy happens to be
   * ahead. The forge merges into its own copy, so that is what a pull request
   * is a change to — whatever this machine has fetched. Working-tree readings
   * are the reader's own, and comparing uncommitted work against a branch they
   * have not got measures against something they cannot see.
   */
  it("measures a change as the forge has it against the forge's base", async () => {
    // Local `develop` is the one ahead here, and it still loses: the change
    // will be merged into the forge's copy, not into this checkout's.
    const { clone, dir } = shared();
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });

    git(["checkout", "develop"], clone);
    writeFileSync(join(clone, "unpushed.txt"), "mine\n");
    git(["add", "."], clone);
    git(["commit", "-m", "not pushed"], clone);

    expect(await resolveBaseRef("develop", { cwd: clone }, "forge")).toBe("origin/develop");
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it("measures the working tree against the reader's own base", async () => {
    const { clone, dir } = shared();
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });

    git(["checkout", "develop"], clone);
    writeFileSync(join(clone, "unpushed.txt"), "mine\n");
    git(["add", "."], clone);
    git(["commit", "-m", "not pushed"], clone);

    expect(await resolveBaseRef("develop", { cwd: clone }, "local")).toBe("develop");
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it("gives up the local base once it has fallen behind", async () => {
    // The reader's own copy is preferred because it is what they have been
    // working from. It stops being preferable the moment it stops being
    // current: a stale base puts everybody else's landed work inside their
    // change, which is the whole complaint.
    const { seed, clone, dir } = shared();
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });

    writeFileSync(join(seed, "theirs.txt"), "landed\n");
    git(["add", "."], seed);
    git(["commit", "-m", "somebody else"], seed);
    git(["push", "origin", "develop"], seed);
    git(["fetch", "origin"], clone);

    expect(await resolveBaseRef("develop", { cwd: clone }, "local")).toBe("origin/develop");
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

/**
 * A base that picks out a commit rather than naming a branch.
 *
 * `odin.baseRef` takes whatever git takes, and `HEAD~4` is a perfectly good
 * revision — but it is not a branch, and treating it as one made things worse
 * in a way that was hard to see. A branch gets its remote-tracking copy tried
 * as well, so `HEAD~4` became a candidate called `origin/HEAD~4`, which most
 * repositories resolve: four commits back from the default branch. The diff was
 * then measured against a moving point that drifted every time anybody merged
 * anything, and other people's landed work turned up as part of the change.
 */
describe("a base that is a revision rather than a branch", () => {
  it("is used as given, with no remote copy invented for it", async () => {
    const cwd = repo("main");
    // Three commits, so `HEAD~2` names something real.
    for (const n of [1, 2]) {
      writeFileSync(join(cwd, `f${n}.txt`), `${n}\n`);
      execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", `c${n}`], {
        cwd,
        stdio: "ignore",
        env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
      });
    }

    expect(await resolveBaseRef("HEAD~2", { cwd })).toBe("HEAD~2");
  });

  it("still prefers the forge's copy of something that is a branch", async () => {
    // The behaviour this is careful not to break: a plain name still gets its
    // remote-tracking copy tried, which is what makes a worktree work.
    const cwd = repo("main");
    expect(await resolveBaseRef("main", { cwd })).toBe("main");
  });
});

/**
 * A workspace setting against what the forge says.
 *
 * `odin.baseRef` is written once and read for ever, and a stale one measures
 * every change in that repository against the wrong point — which does not look
 * like a misconfiguration. It looks like other people's merged work appearing
 * inside a branch that never touched it, which is nearly impossible to read as
 * a settings problem.
 *
 * So the pull request wins over the setting, and an explicit request wins over
 * the pull request: asking for a comparison against something particular is a
 * thing reviewers do, and the forge's answer is not more correct than the
 * question that was actually asked.
 */
describe("which claim about the base is believed", () => {
  it("prefers what was asked for over anything else", async () => {
    const cwd = repo("main");
    expect(
      await resolveBaseRef("main", { cwd }),
    ).toBe("main");
  });

  it("falls back to the stored preference when nothing else knows", async () => {
    // No forge here, so the setting is all there is — and it is still used.
    const cwd = repo("main");
    const graph = await graphFromRepo({ cwd, fallbackBaseRef: "main" });
    expect(graph.meta.baseRef).toBe("main");
  });

  it("does not let a request be overruled", async () => {
    const cwd = repo("main");
    const graph = await graphFromRepo({ cwd, baseRef: "main", fallbackBaseRef: "nonsense" });
    expect(graph.meta.baseRef).toBe("main");
  });
});

/**
 * The whole complaint, end to end.
 *
 * A reviewer's `development` is a week old. Other people's pull requests have
 * landed on the forge's copy since, and one of them came onto this branch
 * through a merge. Measured against the local base, every file those other
 * changes touched is reported as part of this change — somebody else's work,
 * under the reader's name, in a review they are being asked to approve.
 *
 * Driven through `graphFromRepo` rather than `resolveBaseRef` because the
 * failure was never in choosing a ref. It was in the files that came out of the
 * other end, and that is what this asserts.
 */
describe("an outdated local base against a forge that has moved on", () => {
  it("reports only the files this change touched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-stale-base-"));
    created.push(dir);
    const origin = join(dir, "origin.git");
    const them = join(dir, "them");
    const me = join(dir, "me");
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, {
        cwd,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        },
      });

    execFileSync("git", ["init", "--bare", "-b", "development", origin], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "development", them], { stdio: "ignore" });
    writeFileSync(join(them, "shared.txt"), "start\n");
    git(["add", "-A"], them);
    git(["commit", "-m", "first"], them);
    git(["remote", "add", "origin", origin], them);
    git(["push", "origin", "development"], them);

    // The reviewer clones, and their `development` is current as of now.
    execFileSync("git", ["clone", origin, me], { stdio: "ignore" });

    // Somebody else's change lands on the forge.
    writeFileSync(join(them, "theirs.txt"), "not mine\n");
    git(["add", "-A"], them);
    git(["commit", "-m", "somebody else's pull request"], them);
    git(["push", "origin", "development"], them);

    // The reviewer cuts their branch and does their own work.
    git(["checkout", "-b", "feat/mine"], me);
    writeFileSync(join(me, "mine.txt"), "my work\n");
    git(["add", "-A"], me);
    git(["commit", "-m", "my change"], me);

    // And brings the base in, the way a branch that has been open a while does.
    // Their own `development` is never updated — only the remote-tracking copy,
    // which is what a background fetch leaves behind.
    git(["fetch", "origin"], me);
    git(["merge", "--no-edit", "origin/development"], me);

    const graph = await graphFromRepo({
      cwd: me,
      headRef: "HEAD",
      fallbackBaseRef: "development",
    });

    const paths = graph.nodes.map((n) => n.path).sort();
    expect(paths).toEqual(["mine.txt"]);
    // Named explicitly, because this is the file the whole thing is about: it
    // belongs to a pull request this reviewer had nothing to do with.
    expect(paths).not.toContain("theirs.txt");
    expect(graph.meta.baseRef).toBe("origin/development");
  }, 30_000);
});
