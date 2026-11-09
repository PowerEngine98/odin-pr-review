import type { Box } from "../canvas/wire.js";

/**
 * Where a tour's marks are drawn, in the drawing's own units.
 *
 * Worked out from the card as it is placed now and from where the card says
 * its lines are, so a mark follows its lines through a rebuild, a filter or a
 * change of reading rather than staying where the frame first put it.
 *
 * Pure: the card, the line finder and the row height are handed in.
 */

/** How far a box stands off the lines it is around. */
const PAD = 6;

/**
 * The box around a run of lines on a card.
 *
 * `at` answers where a line's middle sits from the card's top, which is what
 * the cards report. A run the card cannot place — not drawn yet, or a whole-card
 * mark, said with a start of nought — is the whole card: an outline around the
 * right file is still the right thing to point at. In two columns a side is
 * only its own half of the card.
 */
export function markBox(
  card: Box,
  at: (line: number) => number | null,
  start: number,
  end: number,
  row: number,
  half: "left" | "right" | null,
): Box {
  const whole = { x: card.x - PAD, y: card.y - PAD, width: card.width + 2 * PAD, height: card.height + 2 * PAD };
  if (start <= 0) return whole;
  const top = at(start);
  const bottom = at(end) ?? top;
  if (top === null || bottom === null) return whole;

  const y = card.y + Math.min(top, bottom) - row / 2 - PAD / 2;
  const height = Math.abs(bottom - top) + row + PAD;
  if (half === "left") return { x: card.x - PAD, y, width: card.width / 2 + PAD, height };
  if (half === "right") return { x: card.x + card.width / 2, y, width: card.width / 2 + PAD, height };
  return { x: card.x - PAD, y, width: card.width + 2 * PAD, height };
}

/**
 * An arrow from one box to another: the path, and where its head is.
 *
 * It leaves from the side of the first box that faces the second, so arrows
 * read left to right or right to left the way the cards stand. Two boxes in the
 * same column — the same card, often — get a loop out to the right and back, the
 * shape a reviewer draws in a margin.
 */
export function arrowPath(from: Box, to: Box): {
  d: string;
  head: { x: number; y: number; angle: number };
} {
  const fromMid = from.y + from.height / 2;
  const toMid = to.y + to.height / 2;
  const rightward = to.x >= from.x + from.width;
  const leftward = to.x + to.width <= from.x;

  let sx: number;
  let ex: number;
  let c1: number;
  let c2: number;
  if (rightward || leftward) {
    sx = rightward ? from.x + from.width : from.x;
    ex = rightward ? to.x : to.x + to.width;
    const reach = Math.max(40, Math.abs(ex - sx) / 2);
    c1 = sx + (rightward ? reach : -reach);
    c2 = ex + (rightward ? -reach : reach);
  } else {
    sx = from.x + from.width;
    ex = to.x + to.width;
    const out = Math.max(sx, ex) + Math.max(60, Math.abs(toMid - fromMid) / 3);
    c1 = out;
    c2 = out;
  }

  // The curve arrives level, so the head points straight along whichever way
  // its last control point lies.
  const angle = ex >= c2 ? 0 : Math.PI;
  return {
    d: `M ${sx} ${fromMid} C ${c1} ${fromMid}, ${c2} ${toMid}, ${ex} ${toMid}`,
    head: { x: ex, y: toMid, angle },
  };
}
