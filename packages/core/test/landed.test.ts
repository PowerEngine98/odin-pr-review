import { describe, expect, it } from "vitest";

import { landedAt } from "../src/git/landed.js";

const SQUASH = "f5ede9d257179a07dc0cca585e69603d790b6879";

describe("where a working tree is measured from", () => {
  it("measures a merged change from where it landed", () => {
    /*
     * The report this was written for: a merged pull request with nothing
     * uncommitted showed eighty-two modified files. The working tree was byte
     * for byte identical to the base it had been merged into; the fork point
     * was simply a long way behind, because the forge squashed.
     */
    expect(landedAt({ live: true, state: "MERGED", mergeCommit: SQUASH })).toBe(SQUASH);
  });

  it("leaves an open change at its fork point", () => {
    // Where the merge base is right: work other people landed on the base since
    // the fork is theirs, and measuring from the tip reports all of it as
    // missing from this branch.
    expect(landedAt({ live: true, state: "OPEN", mergeCommit: SQUASH })).toBeUndefined();
  });

  it("leaves a closed change alone", () => {
    // Abandoned, so its content is not on the base and the fork point is still
    // where the comparison belongs.
    expect(landedAt({ live: true, state: "CLOSED" })).toBeUndefined();
    expect(landedAt({ live: true, state: "CLOSED", mergeCommit: SQUASH })).toBeUndefined();
  });

  it("leaves a reading of the forge's own copy alone", () => {
    /*
     * A reading of a merged change as the forge has it is a record of what that
     * change did, and the fork point is what produces it — the diff the pull
     * request itself shows. Only the files on disk are asking a different
     * question.
     */
    expect(landedAt({ live: false, state: "MERGED", mergeCommit: SQUASH })).toBeUndefined();
  });

  it("says nothing when the forge named no commit", () => {
    // A merged change whose merge commit the forge did not report, or a reading
    // with no pull request behind it at all.
    expect(landedAt({ live: true, state: "MERGED" })).toBeUndefined();
    expect(landedAt({ live: true, state: "MERGED", mergeCommit: "" })).toBeUndefined();
    expect(landedAt({ live: true, state: "MERGED", mergeCommit: "   " })).toBeUndefined();
    expect(landedAt({ live: true })).toBeUndefined();
  });
});
