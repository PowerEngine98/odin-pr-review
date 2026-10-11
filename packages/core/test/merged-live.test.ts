import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPatch } from "../src/git/diff.js";

/**
 * A change that has been squashed onto its base, read live afterwards.
 *
 * The reported fault: a merged pull request with nothing uncommitted showed
 * eighty-two modified files and three thousand changed lines. Measured in the
 * repository it came from, the working tree was byte for byte identical to the
 * base it had been merged into — and the whole change still showed, because a
 * squash puts the branch's *content* on the base under a new commit. The branch
 * tip is then an ancestor of nothing, the fork point stays where it was, and a
 * diff from there replays the entire branch.
 *
 * Built here rather than described, because the shape is the whole point: every
 * sha differs while every byte matches, and nothing local can tell that the
 * work has landed.
 */
describe("a change read live after it was squashed onto its base", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;
  let squash: string;

  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    })
      .toString()
      .trim();

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-landed-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-landed-repo-"));

    execFileSync("git", ["init", "--quiet", "-b", "development", repo]);
    writeFileSync(join(repo, "base.txt"), "start\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "base");

    // The branch: several commits, which is what a squash collapses.
    run("checkout", "--quiet", "-b", "feature");
    writeFileSync(join(repo, "one.txt"), "one\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "one");
    writeFileSync(join(repo, "two.txt"), "two\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "two");

    /*
     * The merge, as a forge that squashes performs it: the content on the base
     * under one new commit, and the branch left exactly where it was. Nothing
     * about the branch becomes an ancestor of anything.
     */
    run("checkout", "--quiet", "development");
    run("merge", "--squash", "feature");
    run("commit", "--quiet", "-m", "feature (#307)");
    squash = run("rev-parse", "HEAD");

    // Back to the branch, which is where somebody reading it live would be.
    run("checkout", "--quiet", "feature");

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  /** A forge answering for one pull request, in whatever state the test wants. */
  function forge(state: string, mergeCommit: string | null): void {
    const merge = mergeCommit ? `{"oid":"${mergeCommit}"}` : "null";
    writeFileSync(
      join(bin, "gh"),
      "#!/bin/sh\n" +
        `echo '{"number":307,"title":"t","url":"u","state":"${state}",` +
        `"isDraft":false,"baseRefName":"development","mergeCommit":${merge},` +
        '"reviewDecision":null,"reviewRequests":[],"latestReviews":[]}\'\n',
    );
    chmodSync(join(bin, "gh"), 0o755);
  }

  /** The reading the side list and the drawing are both built from. */
  const live = () =>
    readPatch({
      cwd: repo,
      baseRef: "development",
      worktree: true,
      pullRequest: true,
      pullRequestNumber: 307,
    });

  it("shows the whole change while it is still open", async () => {
    // The fork point is right here: this is work the base has not got.
    forge("OPEN", null);
    const { patch } = await live();
    expect(patch).toContain("one.txt");
    expect(patch).toContain("two.txt");
  });

  it("shows nothing once it has landed and the tree has not moved", async () => {
    /*
     * The complaint, in one assertion. Every file in this tree is already on
     * the base; there is nothing uncommitted; the answer is nothing.
     */
    forge("MERGED", squash);
    const { patch } = await live();
    expect(patch.trim()).toBe("");
  });

  it("measures from where it landed, so later work is the only work", async () => {
    forge("MERGED", squash);
    writeFileSync(join(repo, "three.txt"), "three\n");
    try {
      const { patch } = await live();
      expect(patch).toContain("three.txt");
      // And nothing that was part of the change itself.
      expect(patch).not.toContain("one.txt");
      expect(patch).not.toContain("two.txt");
    } finally {
      rmSync(join(repo, "three.txt"), { force: true });
    }
  });

  it("says where it measured from, so the reading can be checked", async () => {
    forge("MERGED", squash);
    const { meta } = await live();
    expect(meta.mergeBase).toBe(squash);
  });

  it("falls back to the fork point when this checkout lacks that commit", async () => {
    /*
     * The forge names a commit; a repository that has not fetched since the
     * merge does not have it. Handing git a revision it cannot resolve would
     * fail several layers below anything that knows which change is being read,
     * so the old answer is kept instead — wrong in the way it was always wrong,
     * rather than broken in a new one.
     */
    forge("MERGED", "0".repeat(40));
    const { patch } = await live();
    expect(patch).toContain("one.txt");
  });
});
