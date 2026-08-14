import { ui } from "../state.svelte.js";
import { forgeSide, spanOf, type End, type Pick } from "./picking.js";

/**
 * The gesture that chooses lines, while it is happening.
 *
 * One of these for the whole page rather than one per card, because there is
 * one pointer: a reader cannot be dragging down two files at once, and a pick
 * per card would leave a lit range on every card they had ever touched. It also
 * settles what a shift-click extends — the pick that is open, wherever it was
 * made — without any card having to ask its neighbours what they are holding.
 *
 * `dragging` is true only between the press and the release that ends it. The
 * pick outlives it: the lines stay lit under the composer, so the passage being
 * talked about is visible while the words are being chosen.
 */
export const gesture = $state<{ pick: Pick | null; dragging: boolean }>({
  pick: null,
  dragging: false,
});

export function begin(pick: Pick): void {
  gesture.pick = pick;
  gesture.dragging = true;
}

/** Moves the loose end of the open pick. The end it started at does not move. */
export function extendTo(line: number): void {
  if (gesture.pick && gesture.pick.to !== line) gesture.pick.to = line;
}

/**
 * Takes hold of one end of the open pick, pinning the other.
 *
 * The range keeps the end that was not grabbed and moves the one that was, so
 * dragging the top handle changes where the passage starts and leaves its last
 * line exactly where the reader put it. `from` is the pinned end and `to` the
 * travelling one, which is the same shape a fresh drag has — so everything that
 * extends a pick carries on working without knowing which of the two it is.
 */
export function grip(which: End): void {
  const pick = gesture.pick;
  if (!pick) return;
  const { start, end } = spanOf(pick);
  pick.from = which === "start" ? end : start;
  pick.to = which === "start" ? start : end;
  gesture.dragging = true;
}

export function drop(): void {
  gesture.pick = null;
  gesture.dragging = false;
}

/** A box on the screen, which is all the composer wants of one. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Hands the chosen lines to the composer, and stops the gesture.
 *
 * The row is the last line of the pick that is actually on screen and the card
 * is the file it belongs to. Both are measured by the caller, because only a
 * card knows where its own rows have ended up — a line folded inside a closed
 * band has no position, and hanging the box off one would put it wherever nought
 * happens to be.
 */
export function open(at: { row: Box; card: Box }, lines: string[] = []): void {
  const pick = gesture.pick;
  gesture.dragging = false;
  if (!pick) return;

  const { start, end } = spanOf(pick);
  ui.composer = composing(pick, start, end, at, lines);
}

/**
 * What is written into `ui.composer`, and why it is not quite what that field
 * says it is.
 *
 * The state module describes the composer's anchor as one rectangle and its
 * side as base or head. Neither is what the composer reads. It wants two boxes
 * — the row it hangs under and the card it lines up with — and it copies the
 * side straight into the draft, where the only words the forge will accept are
 * LEFT and RIGHT. Written the way the field is declared, every remark left here
 * would be labelled with the wrong checkout and then refused by the pull
 * request API once the reviewer had finished writing it.
 *
 * So the rectangle is a real `DOMRect` of the row, with the two boxes carried on
 * it, and the side is the forge's word. The assertion below is the seam between
 * the two descriptions rather than a claim that they are the same one; the state
 * module is the thing to change, and it is not this component's to change.
 */
function composing(
  pick: Pick,
  start: number,
  end: number,
  at: { row: Box; card: Box },
  lines: string[],
): NonNullable<typeof ui.composer> {
  const anchor = Object.assign(
    new DOMRect(at.row.left, at.row.top, at.row.width, at.row.height),
    { row: at.row, card: at.card },
  );

  return {
    path: pick.path,
    side: forgeSide(pick.side),
    // The code the reader picked, which is what a suggestion starts from: the
    // forge shows a suggestion as a change, and a change needs the lines it
    // replaces as well as the ones it proposes.
    //
    // A line *range* used to go in here, under a cast that stopped the
    // compiler saying so. Two things came of that: the preview called `join`
    // on it and threw inside an effect, taking the whole composer down, and
    // no suggestion ever knew what it was replacing.
    lines,
    // The range is carried separately, under the names the forge uses.
    line: end,
    startLine: start,
    anchor,
  } as unknown as NonNullable<typeof ui.composer>;
}
