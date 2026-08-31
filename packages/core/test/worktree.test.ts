import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { asPath, hideWorktrees, KEPT, readableCheckout, worktreeFor } from "../src/git/worktree.js";
import { graphFromRepo } from "../src/git/diff.js";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository with two branches whose files differ. */
function repo(): string {
  /*
   * The real path, because git answers with one.
   *
   * On macOS `/var` is a symlink to `/private/var`, so a repository made under
   * the temporary directory has two names — and a test comparing the one it
   * wrote against the one git reports is comparing a symlink with its target.
   */
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "odin-worktree-")));
  made.push(dir);
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
  writeFileSync(join(dir, "one.ts"), "export const one = () => 1;\n");
  git("add", "-A");
  git("commit", "-m", "first");
  git("branch", "base", "HEAD");

  git("checkout", "-b", "feat/other");
  writeFileSync(join(dir, "one.ts"), "export const one = () => 2;\n");
  git("add", "-A");
  git("commit", "-m", "on the other branch");
  git("checkout", "main");
  return dir;
}

/**
 * Reading two branches at once, without moving the reader's own checkout.
 *
 * A live reading is of a working tree; a working tree holds one branch. Two
 * live readings therefore need two checkouts, which is what a linked worktree
 * is — and git refuses to put one branch in two of them, which is the rule that
 * keeps several live readings coherent rather than contradictory.
 */
describe("a checkout Odin can read a branch from", () => {
  it("makes one under the repository, and leaves the reader's alone", async () => {
    const dir = repo();

    const checkout = await readableCheckout("feat/other", { cwd: dir });
    expect(checkout.made).toBe(true);
    expect(checkout.path).toBe(join(dir, KEPT, "feat-other"));
    expect(existsSync(join(checkout.path, "one.ts"))).toBe(true);

    // The reader is where they were, on the branch they were on.
    const here = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    expect(here).toBe("main");
    // And the other checkout holds the other branch.
    expect(await worktreeFor("feat/other", { cwd: dir })).toBe(checkout.path);
  }, 30_000);

  it("uses a checkout the reader already made rather than a second one", async () => {
    const dir = repo();
    const theirs = join(realpathSync(tmpdir()), `odin-theirs-${Date.now()}`);
    made.push(theirs);
    execFileSync("git", ["worktree", "add", theirs, "feat/other"], {
      cwd: dir,
      stdio: "ignore",
    });

    const checkout = await readableCheckout("feat/other", { cwd: dir });
    expect(checkout.made).toBe(false);
    expect(checkout.path).toBe(theirs);
    expect(existsSync(join(dir, KEPT))).toBe(false);
  }, 30_000);

  /*
   * The isolation, and the reason it is not optional.
   *
   * A linked worktree inside the working tree is, to everything that walks that
   * tree, a second copy of the project: `git status` calls it untracked, and a
   * reading of the main checkout would contain every branch the reader had ever
   * looked at.
   */
  it("makes the repository blind to what it keeps under it", async () => {
    const dir = repo();
    await readableCheckout("feat/other", { cwd: dir });

    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(status).not.toContain(KEPT);

    const exclude = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(`/${KEPT}/`);

    // And the change read from the main checkout does not contain the copy.
    const graph = await graphFromRepo({ cwd: dir, baseRef: "base", worktree: true });
    expect(graph.nodes.some((node) => node.path.startsWith(`${KEPT}/`))).toBe(false);
  }, 60_000);

  it("says it once, however many checkouts are made", async () => {
    const dir = repo();
    await hideWorktrees({ cwd: dir });
    await hideWorktrees({ cwd: dir });
    const exclude = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line.trim() === `/${KEPT}/`)).toHaveLength(1);
  }, 30_000);

  it("turns a branch into a directory name without losing which branch it is", () => {
    expect(asPath("feat/lab-147")).toBe("feat-lab-147");
    expect(asPath("release/2.0")).toBe("release-2.0");
    expect(asPath("///")).toBe("branch");
  });
});
