import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPatch } from "../src/git/diff.js";

/**
 * Which pull request a reading belongs to.
 *
 * This used to be asked of the working tree — the branch the reader happened to
 * have checked out — which was the same thing as the branch being read for
 * exactly as long as opening a change meant checking it out. It is routinely
 * not the same thing now: reading no longer moves anything, so a reviewer sits
 * on their own branch and reads somebody else's.
 *
 * What that produced was a graph built from one branch wearing another's number
 * and title, in the tab strip and in the bar. Both halves are real, so there is
 * nothing to notice except that the branch named in the bar is not the branch
 * the files came from.
 */
describe("the pull request a reading belongs to", () => {
  let repo: string;
  let bin: string;
  let path: string | undefined;

  const run = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "odin-pullbranch-"));
    bin = mkdtempSync(join(tmpdir(), "odin-fakegh-"));

    run(repo, "init", "--quiet", "-b", "main");
    writeFileSync(join(repo, "one.ts"), "export const one = 1;\n");
    run(repo, "add", "-A");
    run(repo, "commit", "--quiet", "-m", "one");

    // Somebody else's change, which the reader will read without moving to it.
    run(repo, "checkout", "--quiet", "-b", "feat/lab-135-laborer-feed");
    writeFileSync(join(repo, "two.ts"), "export const two = 2;\n");
    run(repo, "add", "-A");
    run(repo, "commit", "--quiet", "-m", "two");

    // And back, so the working tree is on a different branch from the reading.
    run(repo, "checkout", "--quiet", "main");

    /*
     * A forge that answers with the branch it was asked about.
     *
     * The whole question here is which branch reaches `gh`, so the fake says
     * exactly that and nothing else. A real answer would prove less: two
     * plausible pull requests both parse.
     */
    const gh = join(bin, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        // `pr view <branch> --json ...`
        'if [ "$1" != "pr" ] || [ "$2" != "view" ]; then exit 1; fi',
        'printf \'{"number":171,"title":"asked about %s","url":"u","baseRefName":"main"}\' "$3"',
      ].join("\n") + "\n",
    );
    chmodSync(gh, 0o755);

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(repo, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it("asks about the branch being read, not the one checked out", async () => {
    const { meta } = await readPatch({
      cwd: repo,
      headRef: "feat/lab-135-laborer-feed",
      pullRequest: true,
    });
    expect(meta.pullRequest?.title).toBe("asked about feat/lab-135-laborer-feed");
  });

  it("drops the remote from a reading of the forge's copy", async () => {
    // `gh` knows nothing about this machine's remotes. Asked for
    // `origin/feature/x` it finds nothing, and the reading loses its title.
    run(repo, "update-ref", "refs/remotes/origin/feat/lab-135-laborer-feed", "feat/lab-135-laborer-feed");
    const { meta } = await readPatch({
      cwd: repo,
      headRef: "origin/feat/lab-135-laborer-feed",
      pullRequest: true,
    });
    expect(meta.pullRequest?.title).toBe("asked about feat/lab-135-laborer-feed");
  });

  it("keeps a slash that is part of the branch name", async () => {
    // Stripping the first segment of every ref would turn `feat/lab-135` into
    // `lab-135`, which the forge has never heard of — so a local branch with a
    // slash in it would quietly lose its pull request instead of gaining one.
    const { meta } = await readPatch({
      cwd: repo,
      headRef: "feat/lab-135-laborer-feed",
      pullRequest: true,
    });
    expect(meta.pullRequest?.title).toContain("feat/lab-135-laborer-feed");
  });

  it("falls back to the checkout when the reading is of this branch", async () => {
    // No `headRef` is a question about the branch the reader is on, and that
    // is the one answer the working tree is the authority on.
    const { meta } = await readPatch({ cwd: repo, pullRequest: true });
    expect(meta.pullRequest?.title).toBe("asked about main");
  });
});
