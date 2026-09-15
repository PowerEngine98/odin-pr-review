/**
 * Which card the reader is on.
 *
 * The map in the corner has always marked one rectangle "you are here", and the
 * rule behind that mark was buried in the page component as a few lines of
 * arithmetic nobody could exercise. That was tolerable while one thing read it.
 * It stopped being tolerable the moment the file list wanted to mark the same
 * card, because two places working out where the reader is will drift — and the
 * way a reader finds that out is the map and the list disagreeing about it in
 * front of them, which is worse than neither saying anything.
 *
 * So the rule lives here, written out, and the page asks it once and hands the
 * answer to both. It is deliberately a plain module with no reactivity in it:
 * the geometry is the whole of what has to be agreed on, and it can be driven
 * from a test without a camera, a document or a component.
 *
 * What the rule *is*: the card under the middle of what the reader can see, and
 * nothing else. Not the last card they pressed, which stops being where they are
 * the moment they pan away from it; not the file open in the editor, which is
 * often nothing to do with the picture. The middle of the view keeps being true
 * while they move, which is the only reason a mark on a map is worth drawing.
 */

/** What the reader can see, in the drawing's own units. */
export interface Seen {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Anything with a rectangle on the canvas. */
export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The card under the middle of the view, or nothing.
 *
 * `covered` is how much of the top of the window the bar across the page is
 * standing on, in the drawing's units rather than the screen's. It is taken off
 * before the middle is worked out, because the geometric centre of the viewport
 * sits above the centre of what the reader can actually see — by half the height
 * of the chrome — and the card marked "you are here" was consistently the one
 * about forty pixels over their eye line rather than the one they were reading.
 *
 * Nothing under the middle is answered as nothing, not as the nearest card.
 * Guessing at the nearest one makes the mark jump about as the reader crosses
 * open canvas, and an answer that moves when the thing it describes has not is
 * an answer a reader learns to stop believing. What to do instead — hold the
 * last one, mark nothing at all — belongs to whoever asked, because the map and
 * the list may reasonably want different things of it.
 */
export function cardUnderCentre<T extends Placed>(
  seen: Seen,
  covered: number,
  cards: readonly T[],
): T | undefined {
  // Nothing has been measured: the server, or the first frame of a page. There
  // is no middle of a window with no size, and every card is as good an answer
  // as any other, which means none of them is.
  if (!seen.width || !seen.height) return undefined;

  // Never more than the window itself, and never negative. A bar taller than
  // the viewport is not a situation the page can be in, but a measurement taken
  // mid-reshape can say so for a frame, and a centre worked out from it lands
  // outside the drawing entirely.
  const hidden = Math.min(Math.max(covered, 0), seen.height);

  const x = seen.left + seen.width / 2;
  const y = seen.top + hidden + (seen.height - hidden) / 2;

  return cards.find(
    (card) =>
      x >= card.x &&
      x <= card.x + card.width &&
      y >= card.y &&
      y <= card.y + card.height,
  );
}
