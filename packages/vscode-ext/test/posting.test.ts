import { describe, expect, it } from "vitest";
import { ReviewNotPosted } from "@odin/core";

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
