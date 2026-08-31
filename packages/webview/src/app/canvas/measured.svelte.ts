import type { LineAt } from "./wire.js";

/**
 * What the cards turned out to be, once a browser had drawn them.
 *
 * The layout engine sizes a card in the extension, where there is no document:
 * it counts rows and multiplies. That is close and it is never exact — a
 * proportional glyph in a title, a counter that wrapped, a platform that draws
 * its own checkbox — and every arrow in the drawing is aimed at the edge of a
 * card, so "close" means every arrow lands a little wrong, and the error piles
 * up down a column. Correcting it in the browser is the one measurement this
 * page takes; everything else it is told.
 *
 * The correction is kept here rather than written back into the view model, and
 * that is the whole of the design. Two things make the loop impossible. A card
 * measures its own contents, whose height does not depend on the height anybody
 * hands the card — so being told it is taller does not make it taller again.
 * And the placement only ever reads these numbers: nothing that produces a
 * measurement reads one. Written back into `model.current` instead, every reader
 * of the model would re-run, the cards would re-render, and the effect that
 * measures them would be asked the same question for as long as the browser
 * would sit still for it.
 *
 * Keyed by node id and not cleared when a card leaves. A card hidden by a filter
 * is measured the same as it was when it comes back, and the alternative — an
 * entry deleted on unmount — has the drawing fall back to estimates for a frame
 * every time the reader opens a part.
 */

/** How tall each card really is. Empty until a browser has drawn one. */
const heights = $state<Record<string, number>>({});

/*
 * The same numbers, unreactive, and the batch waiting to join them.
 *
 * Every card measures itself, and the placement reads all of the measurements —
 * so a card writing its height on its own wakes the placement, which places all
 * of them, which measures all of them again. On a change of a hundred and
 * ninety-nine cards that is a hundred and ninety-nine placement passes over a
 * hundred and ninety-nine cards apiece, and it is most of a thirty-second pause
 * in which the editor's window answers nobody.
 *
 * So the writes are collected and published together. A round of measurements
 * becomes one invalidation instead of one each, which is the difference between
 * n² and n — and the answer is identical, because nothing here reads a
 * measurement in order to produce one.
 *
 * `known` is what lets a card be told it has not changed without reading the
 * reactive copy: reading that inside the effect that writes it is exactly the
 * dependency this module exists to avoid.
 */
const known: Record<string, number> = {};
let waiting: Record<string, number> | null = null;
let publishing = 0;

/**
 * Publishes a round of measurements, once, on the next frame.
 *
 * A frame rather than a microtask because that is the beat the measurements
 * themselves arrive on: they are taken after the browser has drawn, so
 * gathering them until it is about to draw again collects the whole round.
 * Where there are no frames — a page being rendered to a string, a test — the
 * timer is the same promise a beat later.
 */
function later(publish: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(publish);
  else setTimeout(publish, 0);
}

function publish(): void {
  publishing = 0;
  const batch = waiting;
  waiting = null;
  if (!batch) return;
  // Assigned one by one on purpose: each card is its own piece of state, so a
  // card whose height did not change is not woken by one whose height did.
  for (const id of Object.keys(batch)) heights[id] = batch[id]!;
}

/**
 * A card, reporting itself.
 *
 * Nought is refused rather than recorded: a card that has not been laid out yet
 * — the first frame, or a page being rendered to a string where nothing has a
 * size at all — would otherwise flatten its column and take every arrow in it
 * along.
 */
export function measure(id: string, height: number): void {
  if (height <= 0) return;
  // Against the unreactive copy, so this asks nothing of the state it is about
  // to write and a card that has settled stops taking part.
  if (known[id] === height) return;
  known[id] = height;
  (waiting ??= {})[id] = height;
  if (!publishing) {
    publishing = 1;
    later(publish);
  }
}

/** What a card measured, or nothing when nothing has measured it. */
export function heightOf(id: string): number | undefined {
  return heights[id];
}

/** Where a line sits inside one card, measured from that card's top. */
export type RowFinder = (
  side: "base" | "head",
  line: number,
  fileLevel: boolean,
) => number | null;

/**
 * How to ask each card where its rows are.
 *
 * Reactive state holding functions, which is unusual and is the point: a card
 * hands over a new one whenever anything moves its rows, and everything drawn
 * from row positions is reading this, so the arrows are re-routed by the same
 * mechanism that redraws everything else. The old renderer had a reroute pass
 * that every one of those paths had to remember to call, and the paths that
 * forgot left arrows pointing at where a row used to be.
 */
const finders = $state<Record<string, RowFinder | null>>({});

/**
 * A card, offering to answer for its own rows — or taking the offer back.
 *
 * A card that has gone leaves a nothing behind rather than having its entry
 * removed, for the same reason the heights are only ever assigned: emptying a
 * key is a read as well as a write, and a write that reads is how an effect
 * comes to depend on what it has just said.
 */
export function anchors(id: string, find: RowFinder | null): void {
  finders[id] = find;
}

/**
 * Where a line sits on whichever card holds it.
 *
 * Nothing for a card that is not on the page: the arrow layer then falls back to
 * the one position that is never wrong about which card it means.
 */
export const lineAt: LineAt = (nodeId, side, line, fileLevel) =>
  finders[nodeId]?.(side, line, fileLevel) ?? null;

/** Whether an element is in the picture, as opposed to folded away. */
function shows(element: HTMLElement): boolean {
  return element.offsetParent !== null;
}

/**
 * The visible band that says it stands in for this line, or nothing.
 *
 * A band between two hunks has no rows behind it — those lines were never read —
 * so there is nothing in the document to walk back from. Each band carries the
 * range it hides instead, which is the only way to find the one covering a line
 * that was never rendered. Without it an arrow aimed at such a line fell through
 * to the truncation bar, and claimed a position it had no reason to claim.
 */
function bandCovering(
  root: HTMLElement,
  side: "base" | "head",
  line: number,
): HTMLElement | null {
  const from = side === "base" ? "data-base-from" : "data-head-from";
  const to = side === "base" ? "data-base-to" : "data-head-to";

  for (const band of root.querySelectorAll<HTMLElement>(`.row.gap[${from}]`)) {
    if (!shows(band)) continue;
    if (
      line >= Number(band.getAttribute(from)) &&
      line <= Number(band.getAttribute(to))
    ) {
      return band;
    }
  }
  return null;
}

/** The visible band or bar standing in for a row that is not on screen. */
function foldFor(
  root: HTMLElement,
  row: HTMLElement | null,
  side: "base" | "head",
  line: number,
): HTMLElement | null {
  const covering = bandCovering(root, side, line);
  if (covering) return covering;

  // Held back by the card's height rather than by a fold. The bar at the foot is
  // the honest place to point: it says there is more below and opens it. The
  // nearest band above would say "in this stretch of unchanged code", which is a
  // different claim, and a false one.
  if (row?.classList.contains("beyond-cap")) {
    const bar = root.querySelector<HTMLElement>(".row.more");
    if (bar) return bar;
  }

  // A row that exists but is folded away: the band above it is the one.
  if (row) {
    for (
      let previous = row.previousElementSibling;
      previous;
      previous = previous.previousElementSibling
    ) {
      const band = previous as HTMLElement;
      if (band.classList.contains("gap") && shows(band)) return band;
    }
  }
  return root.querySelector<HTMLElement>(".row.more");
}

/**
 * Where a line sits on one card, measured from the top of that card.
 *
 * Relative to the card rather than to the canvas, because the card moves: a
 * filter re-places every card on the page, and an answer in canvas units would
 * be stale the moment it was given. The card is the positioned ancestor of its
 * rows, so a row's own offset already counts the title above it — adding the
 * body's offset as well put every arrow a title-height too low, which is about
 * two rows and close enough to look plausible.
 *
 * Nothing when the line cannot be placed at all. That is not the same as the
 * middle of the card: the middle is a decision about how to draw an arrow, and
 * it belongs to whatever is drawing one.
 */
export function lineIn(
  card: HTMLElement,
  side: "base" | "head",
  line: number,
  fileLevel: boolean,
): number | null {
  // An import names the file, so it meets the card at its title.
  if (fileLevel) {
    const title = card.querySelector<HTMLElement>(".card-title");
    return title ? title.offsetHeight / 2 : null;
  }

  const body = card.querySelector<HTMLElement>(".card-body") ?? card;
  const attribute = side === "base" ? "data-old" : "data-new";
  let row = body.querySelector<HTMLElement>(`.row[${attribute}="${line}"]`);

  // A row inside a closed band, or below the cap, has no position to point at;
  // whatever stands in for it does.
  if (!row || !shows(row)) {
    const fold = foldFor(body, row, side, line);
    if (!fold) return null;
    row = fold;
  }

  return row.offsetTop + row.offsetHeight / 2;
}
