import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPullRequest } from "../src/git/pullRequest.js";

/**
 * What the forge is asked, and whether it can answer.
 *
 * `gh pr view` takes a number, a branch or a URL. A tracking ref is none of
 * those: a reading of the forge's own copy of a change is built from
 * `origin/luis/lab-147`, and asked about that, `gh` finds nothing. Everything
 * downstream treats "nothing" as "no pull request" — which is right when there
 * is none and silent when the question was simply unaskable.
 */
describe("asking the forge about a pull request", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-gh-"));
    repo = mkdtempSync(join(tmpdir(), "odin-gh-repo-"));

    // A forge that answers for the number and refuses everything else, which is
    // what the real one does with a ref it has never heard of.
    const file = join(bin, "gh");
    writeFileSync(
      file,
      "#!/bin/sh\n" +
        `echo "$@" >> "${join(repo, "asked.log")}"\n` +
        'case "$3" in\n' +
        '  171) echo \'{"number":171,"title":"t","url":"u","state":"OPEN",' +
        '"isDraft":false,"baseRefName":"development","reviewDecision":"APPROVED",' +
        '"reviewRequests":[{"login":"nym"}],' +
        '"latestReviews":[{"state":"APPROVED","author":{"login":"marco"}}]}\';;\n' +
        "  *) exit 1;;\n" +
        "esac\n",
    );
    chmodSync(file, 0o755);
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("answers when asked by number", async () => {
    const pull = await readPullRequest("171", { cwd: repo });
    expect(pull?.number).toBe(171);
    expect(pull?.reviewDecision).toBe("APPROVED");
  });

  it("finds nothing when asked by a tracking ref", async () => {
    // Not a failure of this function — a demonstration of why the caller must
    // not ask this way. It is what left an approval invisible: the panel asked
    // about `origin/…`, got nothing, and updated nothing.
    const pull = await readPullRequest("origin/luis/lab-147", { cwd: repo });
    expect(pull).toBeUndefined();
    expect(readFileSync(join(repo, "asked.log"), "utf8")).toContain("origin/luis/lab-147");
  });

  it("counts somebody who has reviewed as having reviewed, not as waiting", async () => {
    // The approver is often not on the requested list at all — nobody asked
    // them — so their verdict has nowhere to appear unless the reviews are read
    // alongside the requests.
    const pull = await readPullRequest("171", { cwd: repo });
    const marco = pull?.reviewers?.find((who) => who.login === "marco");
    const nym = pull?.reviewers?.find((who) => who.login === "nym");
    expect(marco?.state).toBe("APPROVED");
    expect(nym?.state).toBe("PENDING");
  });
});
