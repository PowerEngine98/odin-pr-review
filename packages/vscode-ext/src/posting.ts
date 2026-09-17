import { FileCommentsNotPosted, ReviewNotPosted, brokenConnection } from "@odin/core";

/**
 * What to say when a review did not go out, or did not go out whole.
 *
 * Four different things went wrong and they call for four different next moves,
 * so they are told apart rather than collapsed into one sentence with the
 * forge's own words appended. The two that matter most are the ones about what
 * is already on the pull request. The connection can break before the forge
 * answers, and then nobody — not Odin, not the reviewer — knows whether the
 * review is there; saying "it was not posted" is a guess, and a reviewer who
 * believes it will approve the same pull request twice. And the review can go
 * out while a remark about a whole file does not, since those are sent
 * separately by the endpoint that accepts them; there "the review was not
 * posted" is not a guess but a falsehood, and it costs the same second verdict.
 *
 * Most messages end the same way because it is the same reassurance and it is
 * true in all of them: nothing written is thrown away by a failure to send it.
 * The partly-posted one does not say it, because the review itself has gone and
 * the thing still to be dealt with is the one remark it names.
 */
export function failedToPost(error: unknown, number: number): string {
  const said = error instanceof Error ? error.message : String(error);
  const kept = "Your comments are still here.";

  if (error instanceof FileCommentsNotPosted) {
    const which =
      error.paths.length === 1
        ? `the remark on ${error.paths[0]}`
        : `the remarks on ${error.paths.join(", ")}`;
    return (
      `Odin: the review is on #${number}, but ${which} did not go out — a remark about a whole file is posted on its own. ` +
      `Do not send the review again; post ${error.paths.length === 1 ? "that remark" : "those remarks"} instead. (${error.reason})`
    );
  }

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

  return `Odin: the review was not posted. ${ending(said)} ${kept}`;
}

/**
 * The forge's own words, finished off so the reassurance is a new sentence.
 *
 * A refusal now carries the detail the forge sent with it rather than only its
 * status line, and that detail ends wherever it ends — usually on a field name.
 * Running "Your comments are still here" straight on from it read as part of
 * the same sentence and made both halves harder to take in.
 */
function ending(said: string): string {
  return /[.!?]$/.test(said) ? said : `${said}.`;
}
