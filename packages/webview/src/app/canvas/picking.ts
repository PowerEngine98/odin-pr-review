import { sideOf, type Side } from "../marks/marks.js";
import type { CodeRow } from "./rows.js";

/**
 * Choosing the lines a remark is about.
 *
 * All of it pure, for the same reason the rest of a card's arithmetic is: what
 * is left once the pointer and the document are taken out is a handful of sums
 * about which line a gutter stands for and whether a pick reaches it, and those
 * are answerable at a desk and checkable in a test. The gesture itself — the
 * press, the drag, the release — lives in the components, because only they
 * have a pointer to listen to.
 */

/**
 * A range of lines being chosen, on one side of one card.
 *
 * The side is fixed when the gesture starts and never moves. A drag that could
 * change sides half way down would produce a range whose two ends are numbered
 * against different checkouts — line 40 of the file as it was and line 40 of
 * the file as it will be are not the ends of anything.
 *
 * `from` and `to` are where the gesture began and where it has got to, in that
 * order rather than in numerical order: dragging upwards is a real gesture and
 * the end it started at is the one the reader is anchored on.
 */
export interface Pick {
  nodeId: string;
  path: string;
  side: Side;
  from: number;
  to: number;
}

/** The same range, said the way the forge says it: lowest line first. */
export interface Span {
  start: number;
  end: number;
}

export function spanOf(pick: Pick): Span {
  return {
    start: Math.min(pick.from, pick.to),
    end: Math.max(pick.from, pick.to),
  };
}

/**
 * The line a gutter stands for, or nothing when it stands for none.
 *
 * Two things can make a gutter uncommentable and they are different failures.
 * A line outside the patch is one the forge cannot see at all — a card also
 * carries source Odin went and read so that an arrow had somewhere to land, and
 * a remark on one of those is refused after the reviewer has written it, which
 * is the worst moment to find out. A gutter with no number in it is the other:
 * an inserted line has no place in the base, so the base gutter beside it is
 * blank, and there is nothing there to point at.
 *
 * A file that exists on one side only is a case on its own. It has a single
 * numbering, which both gutters of a unified row show, so the side is whichever
 * side the file has rather than whichever gutter was pressed — reading the
 * gutter there would offer a base line on a file that was added.
 */
export function commentOn(
  row: CodeRow,
  gutter: Side,
  single: boolean,
): { side: Side; line: number } | null {
  return row.inDiff === true ? lineOn(row, gutter, single) : null;
}

/**
 * Which line of which checkout a gutter shows, whatever may be said about it.
 *
 * The identity on its own, without the question of whether a remark may start
 * there. Two things ask it — the rail, which also wants the patch, and the box
 * an arrow draws round a word, which does not care: a reference can land on a
 * line of untouched context, and refusing to name it because nobody may comment
 * on it would leave the arrow pointing at forty characters at once.
 */
export function lineOn(
  row: CodeRow,
  gutter: Side,
  single: boolean,
): { side: Side; line: number } | null {
  if (single) {
    if (row.newLine !== undefined) return { side: "head", line: row.newLine };
    if (row.oldLine !== undefined) return { side: "base", line: row.oldLine };
    return null;
  }

  const line = gutter === "base" ? row.oldLine : row.newLine;
  return line === undefined ? null : { side: gutter, line };
}

/** Whether a pick reaches a particular line of a particular card. */
export function holds(
  pick: Pick | null,
  nodeId: string,
  side: Side,
  line: number,
): boolean {
  if (!pick || pick.nodeId !== nodeId || pick.side !== side) return false;
  const span = spanOf(pick);
  return line >= span.start && line <= span.end;
}

/** Which end of a picked range a row is, when it is one. */
export type End = "start" | "end";

/** The open pick's two ends on this card, as line numbers on its own side. */
export function endsOf(
  pick: Pick | null,
  nodeId: string,
): { side: Side; start: number; end: number } | null {
  if (!pick || pick.nodeId !== nodeId) return null;
  const { start, end } = spanOf(pick);
  return { side: pick.side, start, end };
}

/**
 * Which end of the range this gutter is, if either.
 *
 * A range of one row is one end, not two: it gets a single handle, because two
 * stacked on the same line would be two things to take hold of that move each
 * other, and there is nothing between them to adjust.
 *
 * Asked of the ends rather than of the rows, so that a handle belongs to the
 * range instead of to a line. Rendered per row it would have to be taken away
 * again when the range moved off it, and the one that was missed stayed behind
 * on a row that was no longer an end of anything.
 */
export function endAt(
  ends: { side: Side; start: number; end: number } | null,
  at: { side: Side; line: number } | null,
): End | null {
  if (!ends || !at || at.side !== ends.side) return null;
  if (at.line === ends.start) return "start";
  if (at.line === ends.end) return "end";
  return null;
}

/**
 * Whether a pick reaches the code a band stands in for.
 *
 * The lines of a selection are what it covers; the bands between them are code
 * it does not show. Both are inside the block the reader is pointing at, and
 * colouring only one of them breaks the block in half and reads as two
 * selections rather than one. A band knows the range it hides, which is the
 * only way to answer this — the lines behind a jump between hunks were never
 * read, so there is nothing in the document to measure.
 */
export function holdsBand(
  pick: Pick | null,
  nodeId: string,
  covers: { base?: [number, number]; head?: [number, number] } | undefined,
): boolean {
  if (!pick || !covers || pick.nodeId !== nodeId) return false;
  const behind = covers[pick.side];
  if (!behind) return false;
  const span = spanOf(pick);
  return behind[0] <= span.end && behind[1] >= span.start;
}

/**
 * A piece of a picked range, as the browser laid it out in card coordinates.
 *
 * `across` says whether the piece speaks for how wide the range is as well as
 * how far it reaches. A band spans both panes because it stands for lines
 * neither side changed, so it says where the range reaches and nothing about
 * which column of it is chosen; a pane on the picked side says both.
 */
export interface Piece {
  top: number;
  left: number;
  width: number;
  height: number;
  across: boolean;
}

/** The one box a picked range is drawn as, or nothing when none of it shows. */
export function patchOf(pieces: readonly Piece[]): Piece | null {
  if (pieces.length === 0) return null;

  let top = Infinity;
  let bottom = -Infinity;
  for (const piece of pieces) {
    top = Math.min(top, piece.top);
    bottom = Math.max(bottom, piece.top + piece.height);
  }

  // A range that is nothing but a band — dragged from one side of a fold to the
  // other with no picked line on screen — still has to be drawn somewhere, so
  // the full width is better than none.
  const sided = pieces.filter((piece) => piece.across);
  const wide = sided.length > 0 ? sided : pieces;

  let left = Infinity;
  let right = -Infinity;
  for (const piece of wide) {
    left = Math.min(left, piece.left);
    right = Math.max(right, piece.left + piece.width);
  }

  return { top, left, width: right - left, height: bottom - top, across: true };
}

/**
 * The side, spelled the way the forge spells it.
 *
 * `sideOf` reads every spelling into the pair the cards are keyed by; this is
 * the way back out, for the one place the word leaves this page. GitHub accepts
 * LEFT and RIGHT and nothing else on a review comment, so a draft carrying
 * "head" is refused — after the review has been written, and with the same
 * unhelpful error as a genuinely bad range.
 */
export function forgeSide(side: Side): "LEFT" | "RIGHT" {
  return side === "base" ? "LEFT" : "RIGHT";
}

/** The side a rail says it is, read back off the row that drew it. */
export function railSide(said: string | null): Side | null {
  return said === null ? null : sideOf(said);
}
