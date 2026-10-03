/**
 * Where the box that writes a remark hangs, once the window has had its say.
 *
 * The box is placed against a row of code, and the code is on a canvas the
 * reader pans — so the two have to be reconciled. Left to the code alone, the
 * box follows its card off the side of the screen and the reader is typing into
 * a box whose left half, and whose close button, are past the edge of the
 * window.
 *
 * This has been both ways round before, and the middle is the point. The box
 * was once clamped into the window outright, and clamping alone is worse than
 * not clamping: as the reader panned, the box stopped following the code and
 * crawled along the edge of the screen, which is the one place it means
 * nothing. The clamps came out, and the box went back to leaving the window.
 *
 * The answer is the one the card's own title already uses. A title that has
 * scrolled under the bar slides down its card to stay in view, and stops at the
 * foot of the card, so a name never outlives the code it names. Here the same
 * shape, in one sentence: the box is held inside the window for as long as the
 * card it belongs to is on screen at all, and let go the moment that card is
 * not. A box over code nobody can see is pointing at nothing, and following the
 * window would be the crawl again.
 *
 * Lifted out of the component because it is arithmetic over two coordinate
 * systems and four edges, and because the cases that matter — a card wider than
 * the window, a row gone up behind the bar, a window with no room in it at all —
 * are ones nobody can produce on purpose by dragging.
 */

/** A rectangle as the document reports one, in window pixels. */
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Hanging {
  /** The pane the remark is about — one side of a split card, or the card. */
  pane: Edges;
  /** The card it belongs to, which is what decides whether to hold it at all. */
  card: Edges;
  /** The row that was picked, which is what the box hangs under. */
  row: Edges;
  /** The box itself. Zero before it has been drawn, which is a loose bound. */
  width: number;
  height: number;
}

export interface Room {
  width: number;
  height: number;
  /** Where the bar across the top ends, so the box stops below it. */
  chromeBottom: number;
}

/** The air between the box and the row above it, or the edge of the window. */
export const HANG_GAP = 6;
export const HANG_EDGE = 8;

/**
 * Held inside a band, with the near edge winning where there is no band left.
 *
 * A window narrower or shorter than the box inverts the band, and an inverted
 * band read naively puts the box off the top or the left of the screen in
 * answer to there not being room for it — which is the one result worse than
 * not fitting.
 */
function held(wanted: number, from: number, to: number): number {
  return Math.min(Math.max(wanted, from), Math.max(from, to));
}

/**
 * Where to put the box, in window pixels.
 *
 * Across: at the left edge of the pane whose code it is about, pulled inside
 * the window when that edge is off it.
 *
 * Down: just under the row that was picked, stopped below the bar when that row
 * has gone up behind it, and lifted off the bottom edge when it would otherwise
 * hang past it.
 *
 * Each direction asks separately whether the card is still in view that way, so
 * a card that has gone off the side keeps its box pinned under the bar rather
 * than losing both at once.
 */
export function hang(what: Hanging, room: Room): { left: number; top: number } {
  const across =
    what.card.right > HANG_EDGE && what.card.left < room.width - HANG_EDGE
      ? held(what.pane.left, HANG_EDGE, room.width - what.width - HANG_EDGE)
      : what.pane.left;

  const down =
    what.card.bottom > room.chromeBottom && what.card.top < room.height
      ? held(
          what.row.bottom + HANG_GAP,
          room.chromeBottom + HANG_GAP,
          room.height - what.height - HANG_EDGE,
        )
      : what.row.bottom + HANG_GAP;

  return { left: Math.round(across), top: Math.round(down) };
}
