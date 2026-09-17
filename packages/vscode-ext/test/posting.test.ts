import { describe, expect, it } from "vitest";
import { FileCommentsNotPosted, ReviewNotPosted } from "@odin/core";

import { failedToPost } from "../src/posting.js";

const EOF_ERROR =
  'Post "https://api.github.com/repos/o/r/pulls/80/reviews": unexpected EOF';

describe("what the reviewer is told when a review does not go out", () => {
  it("does not claim anything when the answer was lost and could not be checked", () => {
    const message = failedToPost(new ReviewNotPosted(EOF_ERROR, false), 80);
    expect(message).toMatch(/not known/);
    expect(message).toMatch(/Check the pull request before sending it again/);
    // The exact failure is still there: it is what a reviewer pastes to
    // somebody else when the network is the real problem.
    expect(message).toContain("unexpected EOF");
  });

  it("says plainly that nothing was posted when the pull request was read", () => {
    const message = failedToPost(new ReviewNotPosted(EOF_ERROR, true), 80);
    expect(message).toMatch(/did not reach #80/);
    expect(message).not.toMatch(/not known/);
  });

  it("passes a refusal through as the forge worded it", () => {
    const message = failedToPost(
      new ReviewNotPosted("HTTP 422: Validation Failed", false),
      80,
    );
    expect(message).toMatch(/the review was not posted\. HTTP 422/);
  });

  it("promises the comments are kept, whatever went wrong", () => {
    for (const error of [
      new ReviewNotPosted(EOF_ERROR, false),
      new ReviewNotPosted(EOF_ERROR, true),
      new Error("HTTP 403: forbidden"),
      "gh: command not found",
    ]) {
      expect(failedToPost(error, 80)).toContain("Your comments are still here.");
    }
  });
});

/**
 * The half of a submission that did not go out, told apart from the whole of it.
 *
 * A remark about a whole file is not carried inside the review — the forge will
 * not have it there — so it is a second request, and it can fail on its own
 * after the verdict has landed. "The review was not posted" is then not a guess
 * but a falsehood, and the reviewer who believes it puts their verdict on the
 * pull request a second time.
 */
describe("what the reviewer is told when only a whole-file remark fails", () => {
  const unsent = (paths: string[]) =>
    new FileCommentsNotPosted(
      paths.map((path) => ({ path, side: "RIGHT" as const, body: "why is this here?" })),
      "gh: Validation Failed (HTTP 422) — Validation Failed: path is not part of the diff",
    );

  it("says the review is on the pull request, and which remark is not", () => {
    const message = failedToPost(unsent(["b.kt"]), 80);
    expect(message).toMatch(/the review is on #80/);
    expect(message).toContain("b.kt");
    expect(message).not.toMatch(/was not posted/);
    expect(message).toMatch(/Do not send the review again/);
  });

  it("names every file when more than one remark was left behind", () => {
    const message = failedToPost(unsent(["b.kt", "c.kt"]), 80);
    expect(message).toContain("b.kt, c.kt");
    expect(message).toMatch(/those remarks/);
  });

  it("carries the forge's reason, which is the part that was being thrown away", () => {
    expect(failedToPost(unsent(["b.kt"]), 80)).toContain("path is not part of the diff");
  });
});

/**
 * The reason a refusal gave, in the sentence the reviewer reads.
 *
 * `gh` puts the status on standard error and the forge's answer on standard
 * output, and Odin used to report only the first. The reviewer was left with
 * "gh: Unprocessable Entity (HTTP 422)" and no idea which field the forge meant,
 * which is why a five-second mistake cost an afternoon.
 */
describe("a refusal the forge explained", () => {
  it("shows what was wrong and not only that something was", () => {
    const message = failedToPost(
      new ReviewNotPosted(
        "gh: Validation Failed (HTTP 422) — Validation Failed: Search.q is missing",
        false,
      ),
      80,
    );
    expect(message).toContain("Search.q is missing");
    expect(message).toContain("Your comments are still here.");
  });

  it("finishes the forge's words before the reassurance rather than running on", () => {
    const message = failedToPost(new ReviewNotPosted("HTTP 422: Validation Failed", false), 80);
    expect(message).toContain("Validation Failed. Your comments are still here.");
  });
});
