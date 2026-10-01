/**
 * What to do about a card that was asked for and is not on screen.
 *
 * Asking for a file by name — from the list, from a reference, from a command —
 * is asking to be taken to it, and the drawing may not be showing it. That used
 * to be the end of the matter: the host was told the press had missed, and the
 * reader got a line in the status bar saying a filter was in the way.
 *
 * One of those filters is not like the others, and that is the whole of this
 * module. Every other reason a card is missing is a choice about the drawing
 * the reader is looking at right now — a part is open, a file has been ticked
 * away — and undoing one of those in answer to a press would be rearranging
 * what they are reading without being asked. Tests being off is a standing
 * preference about a *kind* of file, made long before the reader knew they
 * wanted this one, so a press naming a test file is the better evidence of what
 * they want than the setting is.
 *
 * Here rather than in the component because it is a rule and not a drawing:
 * four cases, one of which only shows up in a reading where the tests are
 * already on, and none of which a page can be asked about.
 */

/** As much of a node as the rule looks at. */
export interface Asked {
  isTest: boolean;
}

/** How the reader has the drawing set up, as much of it as the rule looks at. */
export interface Hiding {
  showTests: boolean;
}

/**
 * The setting to turn on so the asked-for card appears, if there is one.
 *
 * `null` for everything else, which is the honest answer and the one that keeps
 * the caller's two outcomes apart: a card that can be reached by changing a
 * setting, and a press that genuinely missed and the host should hear about.
 *
 * A file the model has never heard of gets `null` too. That is the case where
 * the reading on screen is older than the reader's own edits, and no setting
 * brings back a file that is not in the change.
 */
export function unhides(node: Asked | undefined, how: Hiding): "tests" | null {
  if (!node) return null;
  if (node.isTest && !how.showTests) return "tests";
  return null;
}
