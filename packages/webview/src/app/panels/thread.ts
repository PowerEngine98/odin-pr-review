import { markSize, reachOf } from "../marks/marks.js";

/**
 * Where an open conversation goes, and what the camera owes it.
 *
 * The box itself is drawn by `Thread.svelte`, which places it against the mark
 * it hangs off — that is a measurement, and the sums it feeds are here so they
 * can be read and checked without a browser. The other half is the part nobody
 * would look for in a panel: the flight that takes a reader to a remark has to
 * land the file somewhere that leaves this box its room, so the size of the box
 * is an input to the camera. Kept in one module because the two are the same
 * fact stated from either end — a panel that shrank and a camera that did not
 * hear about it is a panel back over the code again.
 */

/** The margin the box keeps from the edge of the window. */
export const EDGE = 8;

/** Between the mark and the box, so the two read as pointer and thing. */
export const GAP = 10;

/**
 * The box would rather be narrow than be over the code it is about, so it takes
 * the room beside the file and shrinks into it, down to the width a sentence
 * still reads at: narrow enough to sit beside a file, wide enough that the reply
 * box keeps its toolbar on one or two rows rather than shedding buttons.
 */
export const WIDEST = 430;
export const NARROWEST = 340;

/** How wide the box is, given how much room its mark leaves to the left. */
export function widthOf(anchorLeft: number): number {
  return Math.round(Math.max(NARROWEST, Math.min(WIDEST, anchorLeft - GAP - EDGE)));
}

/**
 * Always to the left, never over the file.
 *
 * The other side is where the code is: a thread that flips onto it hides the
 * lines it is quoting. Where the left is too narrow the box has already shrunk
 * to fit; below that it hugs the edge.
 */
export function leftOf(anchorLeft: number, width: number): number {
  return Math.round(Math.max(EDGE, anchorLeft - GAP - width));
}

/**
 * Level with the mark, and inside the window.
 *
 * Pushed up when a long conversation would otherwise run off the bottom, and
 * never into the chrome — the tabs and the pull request stay reachable while a
 * thread is open.
 */
export function topOf(
  anchorTop: number,
  height: number,
  ceiling: number,
  windowHeight: number,
): number {
  let y = anchorTop;
  if (y + height > windowHeight - EDGE) y = windowHeight - height - EDGE;
  if (y < ceiling) y = ceiling;
  return Math.round(y);
}

/* ------------------------------------------- what the camera has to leave */

/**
 * Breathing room: the file should not arrive with its edge against the
 * conversation about it.
 */
const BREATH = 40;

/**
 * How much of the file has to stay in the window whatever else is asked for.
 *
 * The point of the flight is the code, so the room made for the panel is
 * bounded: pushed any further the file leaves by the right-hand side and the
 * reader is looking at a conversation about something they can no longer see.
 */
const CODE = 260;

/**
 * Everything that has to fit to the left of the file when a remark is open.
 *
 * The window's own margin, the widest the box gets, the gap after it, and the
 * mark with the room its pointer needs. Measured from the mark rather than
 * guessed, because a mark grows with the zoom and a guess made at one scale is
 * wrong at every other.
 */
export function roomFor(scale: number): number {
  const size = markSize(scale);
  return EDGE + WIDEST + GAP + size + reachOf(size) + BREATH;
}

/**
 * Where the drawing has to stand for a file's remarks to have somewhere to open.
 *
 * Room made before the box needs it. It opens into the space to the left of the
 * mark, and centring the file leaves that space to chance — on a narrow window
 * there is none, and the conversation lands over the code it is quoting. So the
 * file is parked far enough right that its own margin holds the box, and centred
 * instead when the window is wide enough that centring already does.
 *
 * The file goes wherever leaves the most room, which is the further right of the
 * two. Clamped so it cannot be pushed so far that the code itself runs out of
 * window.
 */
export function besideFile(
  card: { x: number; width: number },
  viewport: number,
  scale: number,
): number {
  const centred = viewport / 2 - (card.x + card.width / 2) * scale;
  const beside = roomFor(scale) - card.x * scale;
  return Math.min(Math.max(centred, beside), viewport - CODE - card.x * scale);
}
