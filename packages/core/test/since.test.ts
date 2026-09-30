import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { graphFromRepo, pathsChangedSince } from "../src/git/diff.js";
import { lastReviewIn } from "../src/git/review.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
}

/**
 * A branch reviewed at one commit and pushed to afterwards: `a.txt` changed
 * before the review, `b.txt` after it.
 */
function reviewed(): { dir: string; at: string } {
  const dir = mkdtempSync(join(tmpdir(), "odin-since-"));
  created.push(dir);
  git(dir, "init", "--quiet", "--initial-branch=main");
  git(dir, "config", "user.name", "Fixture");
  git(dir, "config", "user.email", "fixture@odin.local");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, "b.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "base");

  git(dir, "checkout", "--quiet", "-b", "feature");
  writeFileSync(join(dir, "a.txt"), "two\n");
  git(dir, "commit", "--quiet", "-am", "first round");
  const at = git(dir, "rev-parse", "HEAD");

  writeFileSync(join(dir, "b.txt"), "two\n");
  git(dir, "commit", "--quiet", "-am", "answering the review");
  return { dir, at };
}

describe("reading only what came after a review", () => {
  it("draws the whole change when no review is named", async () => {
    const { dir } = reviewed();
    const graph = await graphFromRepo({ cwd: dir, baseRef: "main", headRef: "feature" });
    expect(graph.nodes.map((n) => n.path).sort()).toEqual(["a.txt", "b.txt"]);
    expect(graph.meta.since).toBeUndefined();
  });

  it("draws only what was pushed after the reviewed commit", async () => {
    const { dir, at } = reviewed();
    const graph = await graphFromRepo({
      cwd: dir,
      baseRef: "main",
      headRef: "feature",
      sinceRef: at,
    });
    expect(graph.nodes.map((n) => n.path)).toEqual(["b.txt"]);
    expect(graph.meta.since).toBe(at);
    expect(graph.meta.mergeBase).toBe(at);
    expect(graph.meta.sinceLost).toBeUndefined();
  });

  it("falls back to the whole change when the branch was rewritten past it", async () => {
    // A force-push: the reviewed commit is no longer in the branch's history,
    // and a diff from it would compare two unrelated snapshots.
    const { dir, at } = reviewed();
    git(dir, "reset", "--quiet", "--hard", "main");
    writeFileSync(join(dir, "a.txt"), "three\n");
    git(dir, "commit", "--quiet", "-am", "rewritten");

    const graph = await graphFromRepo({
      cwd: dir,
      baseRef: "main",
      headRef: "feature",
      sinceRef: at,
    });
    expect(graph.nodes.map((n) => n.path)).toEqual(["a.txt"]);
    expect(graph.meta.since).toBeUndefined();
    expect(graph.meta.sinceLost).toBe(at);
  });

  it("falls back when the commit does not exist here at all", async () => {
    const { dir } = reviewed();
    const missing = "0".repeat(40);
    const graph = await graphFromRepo({
      cwd: dir,
      baseRef: "main",
      headRef: "feature",
      sinceRef: missing,
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.meta.sinceLost).toBe(missing);
  });
});

describe("finding the commit a reader last reviewed", () => {
  const lines = [
    "someone\tAPPROVED\taaa",
    "me\tCOMMENTED\tbbb",
    "me\tCHANGES_REQUESTED\tccc",
    "someone\tCOMMENTED\tddd",
    "me\tPENDING\teee",
  ].join("\n");

  it("takes the reader's newest sent review", () => {
    expect(lastReviewIn(lines, "me")).toBe("ccc");
  });

  it("ignores other reviewers and unsent drafts", () => {
    expect(lastReviewIn("me\tPENDING\teee\nyou\tAPPROVED\tfff", "me")).toBeUndefined();
  });

  it("matches the login regardless of case", () => {
    expect(lastReviewIn("Me\tAPPROVED\tabc", "me")).toBe("abc");
  });
});

describe("naming the files that moved, for the orange dot", () => {
  it("names the files pushed after the review", async () => {
    const { dir, at } = reviewed();
    expect(await pathsChangedSince(at, "feature", { cwd: dir })).toEqual(["b.txt"]);
  });

  it("names uncommitted edits and new files when the far end is the disk", async () => {
    const { dir } = reviewed();
    writeFileSync(join(dir, "a.txt"), "edited\n");
    writeFileSync(join(dir, "new.txt"), "fresh\n");
    expect(await pathsChangedSince("HEAD", undefined, { cwd: dir })).toEqual([
      "a.txt",
      "new.txt",
    ]);
  });

  it("names nothing on a branch rewritten past the commit", async () => {
    const { dir, at } = reviewed();
    git(dir, "reset", "--quiet", "--hard", "main");
    expect(await pathsChangedSince(at, "HEAD", { cwd: dir })).toEqual([]);
  });

  it("draws only uncommitted work when a live reading starts at HEAD", async () => {
    const { dir } = reviewed();
    writeFileSync(join(dir, "a.txt"), "edited\n");
    const graph = await graphFromRepo({
      cwd: dir,
      baseRef: "main",
      worktree: true,
      sinceRef: "HEAD",
    });
    expect(graph.nodes.map((n) => n.path)).toEqual(["a.txt"]);
    expect(graph.meta.since).toBe(graph.meta.headSha);
  });
});
