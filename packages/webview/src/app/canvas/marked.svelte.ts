import type { EdgeView } from "../model.js";
import { model, settings, ui } from "../state.svelte.js";
import { allSymbolMarks, type SymbolMark } from "./symbols.js";
import { wantedEdges } from "./wire.js";

/**
 * Which references are on screen, for the cards that have to mark them.
 *
 * A card boxes the word at each end of an arrow. The box is the arrow saying
 * which name it is about, so it only means anything while the arrow is there:
 * left behind by a filtered-away reference it marks a word with nothing
 * pointing at it, which reads as a reference the reader is invited to look for
 * and cannot find. The old renderer wiped every box and redrew them on each
 * pass for exactly this reason, and drew one only for an arrow it had just
 * decided was visible.
 *
 * Derived once for the page rather than once per card. The filters are the
 * reader's, not any card's, and building the answer inside each of them made
 * the work the product of two large numbers for a question with one answer.
 */

const reading = $derived({
  unified: settings.unified,
  showTests: settings.showTests,
  showImports: settings.showImports,
  showUnchanged: settings.showUnchanged,
  showInfra: settings.showInfra,
  hideViewed: settings.hideViewed,
  part: ui.part,
  viewed: ui.viewed,
});

const wanted = $derived(wantedEdges(model.current, reading));

/**
 * Whether the arrow for this reference is being drawn.
 *
 * The reader's filters, and then whether both of its cards are actually on the
 * canvas: an arrow needs two ends, and one to a card that a part has taken away
 * is not a shorter arrow, it is no arrow. `ui.visible` is the canvas's own
 * answer to that, published because more than one thing needs it.
 *
 * An empty set means the canvas has not spoken yet — the first frame, or a page
 * being rendered to a string on the server, where there is no canvas to speak.
 * That is not the same as "no card is on screen", and treating it as though it
 * were would leave the server's markup with no marks at all and the reader
 * watching them appear a frame after the code did.
 */
export function drawn(edge: EdgeView): boolean {
  if (!wanted(edge)) return false;
  if (ui.visible.size === 0) return true;
  return ui.visible.has(edge.from) && ui.visible.has(edge.to);
}

/**
 * The words to box, for every card, worked out once.
 *
 * Same reason the filters are derived here rather than inside each card, and a
 * far more expensive one: this walks every edge in the change, every card used
 * to walk them all for itself, and the answer depends on which cards are on the
 * canvas — so panning invalidated a hundred and thirty copies of one pass. It
 * is the same map either way; only the number of times it is built changes.
 */
const boxes = $derived(allSymbolMarks(model.current.edges, drawn));

const NOTHING: Map<string, SymbolMark[]> = new Map();

/** This card's share of them. Empty for a card no arrow touches. */
export function marksFor(nodeId: string): Map<string, SymbolMark[]> {
  return boxes.get(nodeId) ?? NOTHING;
}
