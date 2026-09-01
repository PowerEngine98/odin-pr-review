/**
 * Whether an agent's answer settles the conversation it is in.
 *
 * An answer is normally the end of it. The reader asked something, the agent
 * did the work and said what it did, and a thread that stays open after that is
 * one more thing on a list of a hundred and eighty-five for somebody to go back
 * and close by hand — which nobody does, so the list stops meaning anything.
 *
 * But not every answer is an ending. "I have changed the two obvious call sites
 * and left the third because it is in generated code — do you want that one
 * too?" is a question, and closing the thread on it loses the question. The
 * agent knows which of the two it has written and nothing else here does, so it
 * says: a line of its own reading `keep-open` leaves the conversation open.
 *
 * A line of its own, deliberately. An agent that mentions the marker while
 * explaining what it does — this happens, because the agents read this
 * repository — would otherwise leave every thread open by talking about it.
 */

/**
 * The marker, in the forms an agent will actually write it.
 *
 * `keep-open`, `keep open`, `[keep-open]` and `@odin keep-open` are one
 * instruction spelled four ways, and refusing three of them would make the
 * feature depend on somebody's memory of which. What is not accepted is the
 * marker with anything else on the line: that is prose about the marker rather
 * than the marker.
 */
const KEEP_OPEN = /^\s*(?:@odin\s+)?\[?keep[-\s]?open\]?\s*[.!]?\s*$/i;

/**
 * Whether this answer asks for the thread to stay open.
 *
 * Read line by line, and anywhere in the answer: an agent that puts it at the
 * top and an agent that puts it at the bottom mean the same thing.
 */
export function keepsOpen(body: string): boolean {
  if (!body) return false;
  return body.split("\n").some((line) => KEEP_OPEN.test(line));
}

/**
 * The answer with the marker taken out of it.
 *
 * It is an instruction to Odin rather than something said to the reader, and
 * leaving it in the thread means every kept-open conversation ends with a word
 * that looks like a mistake. Only whole lines go, which is the only shape that
 * counts as the marker in the first place.
 */
export function withoutMarker(body: string): string {
  if (!keepsOpen(body)) return body;
  return body
    .split("\n")
    .filter((line) => !KEEP_OPEN.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
