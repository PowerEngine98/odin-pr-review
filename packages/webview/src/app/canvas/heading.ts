/**
 * Where a name held under the bar sits, for the folder boxes and for the cards
 * inside them.
 *
 * Split out of `Clusters.svelte` on the same argument `placement.ts` makes about
 * the arrows: this is the part with the units in it, and the part that keeps
 * being wrong. Left in the component it can only be exercised by mounting a page
 * at one zoom, which is exactly the condition under which every version of this
 * bug has looked correct — the two quantities agree at one scale and nowhere
 * else, and one scale is all a screenshot shows.
 *
 * The whole of the difficulty is that two units meet here. The bar across the
 * top of the window is chrome: it is measured in window pixels and it is the
 * same size whatever the reader has done to the zoom. Everything a folder box is
 * made of lives inside one transformed layer — `translate(view.x, view.y)
 * scale(view.scale)` — so it is measured in canvas units and it grows and
 * shrinks with the drawing. A number carried across that boundary without being
 * converted is a distance that means one thing at scale one and something else
 * everywhere else.
 *
 * ## A header is drawn in canvas units, and scales
 *
 * It is the same choice a card's title makes, and it is not really a choice at
 * all. The placement reserves `CLUSTER_HEAD` canvas units of empty band above a
 * folder's first card so that the header has somewhere to be — see `bandsFor`,
 * which pays a pad and a header for every box that opens at a band. A header
 * kept at a constant size on screen would honour that reservation at exactly one
 * zoom: pulled back it would swell out of its band and lie across the cards
 * underneath, and pushed in it would shrink to a sliver in the middle of a strip
 * of nothing. The room is in canvas units, so the thing occupying the room is in
 * canvas units.
 *
 * It also has to agree with a card's title, which scales, because the two are
 * stacked in one column — the folder names, and then the file name under them.
 * One of the pair drawn at a fixed size would mean the column's spacing came
 * from adding pixels to canvas units, which is the fault this module exists to
 * make untestable-by-accident.
 *
 * So a header is enormous when the reader is zoomed in. That is not a fault; it
 * is what being part of the drawing means, and a card's title does the same
 * thing beside it.
 *
 * ## Which leaves one rounding, and it belongs in window pixels
 *
 * A name is held a pixel above the underside of the bar rather than level with
 * it, because level leaves a hairline of whatever is behind showing through once
 * the canvas scale turns whole pixels into fractions. That pixel is a window
 * pixel — it is about the screen's grid, not about the drawing — so it is
 * subtracted before the scale is divided out and never after. The stacking step
 * is the opposite: it steps over a header, a header is `CLUSTER_HEAD` canvas
 * units tall, so it is added after the scale has been divided out and never
 * before. Each of the two roundings happens in the units of the thing it is
 * about, and that is the whole of the arithmetic below.
 */

/**
 * How tall a folder's own header is, in canvas units, and therefore how far each
 * nested one sits below the one above it.
 *
 * Matches `CLUSTER_HEAD` in the placement, which reserves the room for it, and
 * matches what `.cluster-head` is actually drawn at — the header sets
 * `box-sizing: border-box` so that its rule along the bottom is inside this
 * number rather than a thirty-first unit hanging below it.
 */
export const CLUSTER_HEAD = 30;

/** Where the bar is and where the drawing has been dragged to. */
export interface Held {
  /** The bottom of the bar across the top, in window pixels. */
  chromeBottom: number;
  /** The canvas layer's own offset down the window, in window pixels. */
  y: number;
  /** What the canvas layer is scaled by. */
  scale: number;
}

/** Enough of a folder box to say where its name goes. */
export interface Headed {
  /** The top of the box, in canvas units. */
  y: number;
  /** How tall it is, in canvas units. */
  height: number;
  /** How many boxes enclose it, counting itself. One for an outermost box. */
  depth: number;
}

/**
 * The line a name of that depth is held on, in the drawing's own coordinates.
 *
 * The underside of the bar, rounded to a whole window pixel while it is still
 * measured in window pixels, and then one header lower for every box that
 * encloses this one. Because the rounding happens before the conversion and the
 * step after it, a name lands on a whole pixel of the screen and is exactly one
 * header below its parent, at every zoom — which is the pair of promises the
 * reader is actually looking at.
 *
 * Nothing is rounded once the step has been added, and that is deliberate. A
 * second rounding, per box, in canvas units, would put each name within a unit
 * of where it belongs rather than on it, and a unit is three screen pixels at
 * three times and a quarter of one at a fifth — so the column would breathe as
 * the reader zoomed, which is the same complaint in a smaller voice.
 */
export function headLine(held: Held, depth: number): number {
  const bar = Math.floor(held.chromeBottom - 1);
  return (bar - held.y) / held.scale + (depth - 1) * CLUSTER_HEAD;
}

/**
 * How far a header slides down its own box to stay in view, in canvas units.
 *
 * Nought while the box's own top is still below the line, which is the ordinary
 * case: a name sits at the top of the thing it names until the thing it names
 * has gone past the bar.
 *
 * It stops at the foot of the box rather than following the bar for ever, so a
 * name never outlives the cards it is about: as the folder leaves, its header
 * slides out with it and the next folder's takes over.
 */
export function pinHead(held: Held, box: Headed): number {
  const offset = headLine(held, box.depth) - box.y;
  if (offset <= 0 || box.height <= CLUSTER_HEAD) return 0;
  return Math.min(offset, box.height - CLUSTER_HEAD);
}

/**
 * How far down the window a card's own title may start, in window pixels.
 *
 * The card is the last name in the column: the bar, then a header for every
 * folder box holding this card, then the file's own name. It is handed a window
 * pixel figure rather than a canvas one because the card divides by the zoom
 * itself — it is told where the chrome ends and works out the rest — so the
 * headers it is being pushed past are scaled on the way out to survive that
 * division. Handed over unscaled they stood for a different distance than the
 * headers occupy, and a file's name sat in the middle of its own code at one
 * zoom and underneath a folder's name at another.
 */
export function titleLine(held: Held, boxes: number): number {
  return held.chromeBottom + boxes * CLUSTER_HEAD * held.scale;
}

/**
 * Where a name of that depth ends up on the screen, in window pixels.
 *
 * Only the measurements need this — nothing draws with it. It is here rather
 * than in the test so that the conversion the test checks is the conversion the
 * page performs, instead of a second opinion about it written next door.
 */
export function headOnScreen(held: Held, box: Headed): number {
  return held.y + (box.y + pinHead(held, box)) * held.scale;
}
