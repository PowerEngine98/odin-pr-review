import { ReviewNotPosted, brokenConnection } from "@odin/core";

/**
 * What to say when a review did not go out.
 *
 * Three different things went wrong and they call for three different next
 * moves, so they are told apart rather than collapsed into one sentence with
 * the forge's own words appended. The one that matters most is the middle case:
 * the connection broke before the forge answered, and nobody — not Odin, not
 * the reviewer — knows whether the review is on the pull request. Saying "it was
 * not posted" there is a guess, and a reviewer who believes it will approve the
 * same pull request twice.
 *
 * Every message ends the same way because it is the same reassurance and it is
 * true in all three: nothing written is thrown away by a failure to send it.
 */
export function failedToPost(error: unknown, number: number): string {
  const said = error instanceof Error ? error.message : String(error);
  const kept = "Your comments are still here.";

  if (error instanceof ReviewNotPosted && !error.verified && brokenConnection(said)) {
    return (
      `Odin: the connection broke before the forge answered, so whether the review reached #${number} is not known. ` +
      `Check the pull request before sending it again. ${kept} (${said})`
    );
  }

  if (brokenConnection(said)) {
    return (
      `Odin: the review did not reach #${number} — the connection broke, and the pull request has no review from you. ` +
      `Try again when it is back. ${kept} (${said})`
    );
  }

  return `Odin: the review was not posted. ${said} ${kept}`;
}
