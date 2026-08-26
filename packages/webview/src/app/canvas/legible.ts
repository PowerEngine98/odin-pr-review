/**
 * The zoom at which text stops being text.
 *
 * Worked out rather than picked, and worked out once. A card gives up drawing
 * its code past this and draws its shape instead; anything else pinned to the
 * drawing that is made of words — a diagram an agent drew, with names on every
 * node — has exactly the same question to answer at exactly the same moment,
 * and answering it twice is how two answers come to disagree.
 */

/**
 * The smallest a glyph can be and still be a glyph.
 *
 * Under three device pixels a line of text is a smear. Three is a floor rather
 * than a preference: it is where the question stops being "can this be read"
 * and becomes "is there anything here to read at all".
 */
export const GLYPH = 3;

/**
 * From the character width the layout engine measured, because that is the
 * thing which has to shrink past legibility and the model already carries it.
 *
 * At the metrics this page is built with — a character 7.45 units wide — the
 * cut lands at 0.40, where a line of a twelve-unit font stands under five
 * device pixels tall. Derived rather than written down so that changing the
 * font moves the number instead of leaving it stale.
 */
export function legibleAt(charWidth: number): number {
  return charWidth > 0 ? GLYPH / charWidth : 0.4;
}
