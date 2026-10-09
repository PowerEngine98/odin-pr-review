import type { Picture } from "../graph/pictures.js";
import type { LayoutMetrics } from "./metrics.js";

/**
 * The card a picture gets, and the picture's place inside it.
 *
 * One answer, used twice. The engine sizes every card in the extension host,
 * because the arrows are placed against those sizes before any page exists; the
 * page then draws the picture inside the card it was given. If those two worked
 * the shape out separately they would disagree the moment either changed, and
 * what that looks like is arrows landing in the margin beside a picture, or a
 * picture overflowing the card it is in.
 *
 * Never enlarged past its own size. A sixteen-pixel icon stretched to fill a
 * card is a blurred square, and it has stopped telling the reader the one thing
 * it was drawn to tell them, which is what the icon looks like. So a small
 * picture sits at its own size in a card no narrower than any other, and only a
 * large one is scaled — down, to fit.
 */
export interface Framed {
  /** The card. */
  width: number;
  height: number;
  /** The picture within it, centred in whatever room is left over. */
  drawWidth: number;
  drawHeight: number;
}

/**
 * The widest a card is drawn for a picture, before the picture is scaled down.
 *
 * There is a limit because a photograph is four thousand pixels across and a
 * card that wide is the whole drawing — every other card beside it becomes a
 * speck, which is the same complaint `maxCardRows` exists to answer for code.
 * Unlike a long line of code, nothing is lost: the picture is all there, just
 * smaller, and the file can be opened to see it at its own size.
 */
export const PICTURE_WIDEST = 720;

/**
 * The tallest, for the same reason in the other direction.
 *
 * A screenshot of a whole page is a column a reader has to pan the length of to
 * get past, and the cards below it are pushed out of the drawing entirely.
 */
export const PICTURE_TALLEST = 560;

/**
 * The card for a picture, from the picture's own shape.
 *
 * `within` is a width the card must take instead of choosing one — an SVG
 * showing its drawing has to be exactly as wide as the same SVG showing its
 * markup, because a reader toggling between the two must not move every card
 * around it. The height is free to change: the page measures that and the
 * placement follows, which is a thing it already does for every fold.
 */
export function frame(
  picture: Picture,
  metrics: LayoutMetrics,
  within?: number,
): Framed {
  const chrome = metrics.padding * 2;

  // What the card offers the picture, before the picture says what it wants.
  const room = within
    ? Math.max(1, within - chrome)
    : Math.max(1, Math.min(picture.width, PICTURE_WIDEST));

  // Down to fit and never up past its own size: see the note at the top.
  const scale = Math.min(
    1,
    room / picture.width,
    PICTURE_TALLEST / picture.height,
  );
  const drawWidth = Math.max(1, Math.round(picture.width * scale));
  const drawHeight = Math.max(1, Math.round(picture.height * scale));

  const width = within ?? Math.max(metrics.minCardWidth, drawWidth + chrome);
  return {
    width: Math.round(width),
    height: Math.round(metrics.titleHeight + chrome + drawHeight),
    drawWidth,
    drawHeight,
  };
}
