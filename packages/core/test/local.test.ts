import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { graphFromRepo } from "../src/git/diff.js";
import { differs, localBranches, parseTrack } from "../src/git/local.js";

const run = promisify(execFile);

/**
 * A clone with a forge behind it.
 *
 * The point of the whole feature is the gap between what a machine has and what
 * was pushed, so the fixture needs both sides for real: a bare repository
 * standing in for the forge, a clone with tracking branches, and then several
 * ways of having wandered off.
 */
let origin = "";
let clone = "";
let second = "";

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "odin-local-"));
  origin = join(base, "origin.git");
  clone = join(base, "clone");
  second = join(base, "second");

  const git = (args: string[], cwd: string) => run("git", args, { cwd });
  const seed = await mkdtemp(join(tmpdir(), "odin-seed-"));

  await run("git", ["init", "--bare", "-b", "main", origin]);
  await git(["init", "-b", "main"], seed);
  await git(["config", "user.email", "test@example.test"], seed);
  await git(["config", "user.name", "Test"], seed);
  await writeFile(join(seed, "a.txt"), "one\n");
  await git(["add", "."], seed);
  await git(["commit", "-m", "first"], seed);
  // Three branches on the forge: one nobody will touch, one that will grow
  // commits locally, and one that will end up with edits in a second checkout.
  await git(["branch", "steady"], seed);
  await git(["branch", "ahead"], seed);
  await git(["branch", "dirty"], seed);
  await git(["remote", "add", "origin", origin], seed);
  await git(["push", "--all", "origin"], seed);
  await rm(seed, { recursive: true, force: true });

  await run("git", ["clone", origin, clone]);
  await git(["config", "user.email", "test@example.test"], clone);
  await git(["config", "user.name", "Test"], clone);
  for (const branch of ["steady", "ahead", "dirty"]) {
    await git(["branch", "--track", branch, `origin/${branch}`], clone);
  }

  // Two commits the forge has never seen.
  await git(["switch", "ahead"], clone);
  await writeFile(join(clone, "b.txt"), "two\n");
  await git(["add", "."], clone);
  await git(["commit", "-m", "second"], clone);
  await writeFile(join(clone, "c.txt"), "three\n");
  await git(["add", "."], clone);
  await git(["commit", "-m", "third"], clone);
  await git(["switch", "main"], clone);

  // A branch checked out elsewhere, with work in the tree of that checkout.
  await git(["worktree", "add", second, "dirty"], clone);
  await writeFile(join(second, "a.txt"), "edited\n");
  // Untracked, and deliberately not counted: a build directory is not a change
  // anyone asked to review.
  await writeFile(join(second, "junk.log"), "noise\n");
}, 60_000);

afterAll(async () => {
  for (const path of [second, clone, origin]) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("reading git's ahead/behind summary", () => {
  it("reads both numbers out of one bracket", () => {
    expect(parseTrack("[ahead 3, behind 2]")).toEqual({
      ahead: 3,
      behind: 2,
      gone: false,
    });
  });

  it("reads one on its own", () => {
    expect(parseTrack("[ahead 1]")).toMatchObject({ ahead: 1, behind: 0 });
    expect(parseTrack("[behind 4]")).toMatchObject({ ahead: 0, behind: 4 });
  });

  it("reads an empty summary as level with the forge", () => {
    expect(parseTrack("")).toEqual({ ahead: 0, behind: 0, gone: false });
  });

  it("notices a branch the forge no longer has", () => {
    expect(parseTrack("[gone]").gone).toBe(true);
  });
});

describe("whether a local copy is worth offering", () => {
  const of = (over: Partial<Parameters<typeof differs>[0] & object> = {}) => ({
    branch: "topic",
    ahead: 0,
    behind: 0,
    uncommitted: 0,
    ...over,
  });

  it("offers a branch with commits the forge does not have", () => {
    expect(differs(of({ ahead: 1 }))).toBe(true);
  });

  it("offers a branch with work that was never committed", () => {
    expect(differs(of({ uncommitted: 2 }))).toBe(true);
  });

  it("does not offer a branch that is merely out of date", () => {
    // Behind is not a second reading of the change: it is the same change,
    // older. Offering a choice between them would be offering nothing.
    expect(differs(of({ behind: 5 }))).toBe(false);
  });

  it("does not offer a branch nobody has", () => {
    expect(differs(undefined)).toBe(false);
  });
});

describe("what this machine has", () => {
  it("counts commits the forge has not seen", async () => {
    const found = await localBranches({ cwd: clone });
    expect(found.get("ahead")).toMatchObject({ ahead: 2, behind: 0 });
  });

  it("says nothing has moved on a branch level with the forge", async () => {
    const found = await localBranches({ cwd: clone });
    expect(found.get("steady")).toMatchObject({ ahead: 0, uncommitted: 0 });
    expect(differs(found.get("steady"))).toBe(false);
  });

  it("counts uncommitted work in the checkout that holds it", async () => {
    const found = await localBranches({ cwd: clone });
    const dirty = found.get("dirty");
    // One tracked file edited. The untracked log beside it is not a change to
    // review and would make this two.
    expect(dirty?.uncommitted).toBe(1);
    // Compared by its last segment: macOS hands back the real path under
    // `/private`, and the temporary directory was made through the symlink.
    expect(dirty?.worktree?.endsWith("/second")).toBe(true);
    expect(differs(dirty)).toBe(true);
  });

  it("does not blame a branch for another checkout's mess", async () => {
    // `ahead` has no working tree of its own; the edits live under `dirty`.
    const found = await localBranches({ cwd: clone });
    expect(found.get("ahead")?.uncommitted).toBe(0);
    expect(found.get("ahead")?.worktree).toBeUndefined();
  });

  it("compares against origin when no upstream was ever set", async () => {
    // A branch pushed by something that did not set tracking has no
    // `%(upstream)` for git to count against, and would otherwise be reported
    // as matching the forge while carrying two commits it has never seen.
    await run("git", ["branch", "--unset-upstream", "ahead"], { cwd: clone });
    try {
      const blind = await localBranches({ cwd: clone });
      expect(blind.get("ahead")).toMatchObject({ ahead: 0, gone: true });

      const asked = await localBranches({ cwd: clone, branches: ["ahead"] });
      expect(asked.get("ahead")).toMatchObject({ ahead: 2, behind: 0 });
      expect(asked.get("ahead")?.gone).toBeUndefined();
    } finally {
      await run("git", ["branch", "--set-upstream-to=origin/ahead", "ahead"], {
        cwd: clone,
      });
    }
  });

  it("hands back nothing outside a repository", async () => {
    expect((await localBranches({ cwd: tmpdir() })).size).toBe(0);
  });
});

describe("reading the change from the working tree", () => {
  it("sees an edit that was never committed", async () => {
    // The whole reason the fold offers a local reading: `HEAD` names a commit,
    // and this file has not been in one.
    const graph = await graphFromRepo({
      cwd: second,
      baseRef: "main",
      worktree: true,
    });
    expect(graph.nodes.map((n) => n.path)).toContain("a.txt");
    expect(graph.meta.worktree).toBe(true);
  });

  it("sees nothing of it without being asked", async () => {
    const graph = await graphFromRepo({ cwd: second, baseRef: "main" });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.meta.worktree).toBeUndefined();
  });

  it("still names the branch rather than the commit", async () => {
    // Everything downstream — the window title, the file a rendered page is
    // written to, the key the viewed marks are kept under — reads headRef as
    // the answer to "which review is this".
    const graph = await graphFromRepo({
      cwd: second,
      baseRef: "main",
      worktree: true,
    });
    expect(graph.meta.headRef).toBe("dirty");
  });

  it("leaves the working tree out when head is somewhere else", async () => {
    // `worktree` means "the files on disk", and the files on disk are not the
    // branch being asked for. Naming both is a comparison of two commits.
    const graph = await graphFromRepo({
      cwd: second,
      baseRef: "main",
      headRef: "ahead",
      worktree: true,
    });
    expect(graph.nodes.map((n) => n.path)).not.toContain("a.txt");
    expect(graph.meta.worktree).toBeUndefined();
  });
});
