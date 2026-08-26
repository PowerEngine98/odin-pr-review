import type { PinnedDiagram } from "../model.js";
import { model, settings } from "../state.svelte.js";

/**
 * The drawings pinned to *this* change.
 *
 * They were kept in one list belonging to the reader, which is wrong about what
 * they are: a picture dropped beside a card is about the change it was dropped
 * on. Kept that way, a diagram pinned while reading one pull request appeared
 * over the cards of the next — the same three rectangles following the reader
 * from review to review, in places that meant nothing.
 *
 * So they are filed under the reading, using the same name the drafts and the
 * camera are filed under: the pull request if there is one, the pair of refs if
 * there is not.
 */
export function pinnedHere(): PinnedDiagram[] {
  const all = settings.diagrams;
  if (!all || Array.isArray(all)) return [];
  return all[model.current.review] ?? [];
}

/** Replaces this reading's drawings, leaving every other reading's alone. */
export function pinHere(diagrams: PinnedDiagram[]): void {
  const all = settings.diagrams;
  /*
   * A stored array is the old shape, and the old shape is exactly the data that
   * was appearing in the wrong place. It is dropped rather than adopted: giving
   * it to whichever reading happens to open first would be the same bug with
   * one more step in it.
   */
  const held = !all || Array.isArray(all) ? {} : all;
  settings.diagrams = { ...held, [model.current.review]: diagrams };
}
