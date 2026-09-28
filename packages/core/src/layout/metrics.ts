/**
 * Fixed geometry for a card.
 *
 * Every dimension is a constant rather than something measured from the DOM.
 * That is deliberate: the layout has to be computable in `@odin/core`, produce
 * the same result in a browser, in a VS Code webview and in a static SVG, and
 * be reproducible in a test. A layout that depended on measured text would
 * drift with the user's font settings and lose the spatial memory the tool is
 * built around.
 */
export interface LayoutMetrics {
  /** Advance width of one monospace character at `fontSize`. */
  charWidth: number;
  fontSize: number;
  lineHeight: number;
  /** Height of the filename header at the top of a card. */
  titleHeight: number;
  /** Space between the card border and its contents. */
  padding: number;
  /** Left gutter: the +/- marker and the base-side line number. */
  gutterWidth: number;
  /**
   * A column of its own, between the sign saying what happened to a line and
   * that line's numbers, for the marks a reader picks lines with: the square +
   * a hovered row offers, the grip at each end of a chosen range, and the rail
   * joining them.
   *
   * At the head of the gutter rather than at the end of it, because the offer
   * has to be findable in the same place on every row. Behind the numbers it
   * stood a whole gutter in from the card's edge, and on a line the change
   * inserted — which has no base number, so nothing in that gutter at all — it
   * hung in a blank strip against the first character of the code, where it
   * read as a mark on the indentation rather than as a control on the row.
   *
   * Beside `gutterWidth` rather than folded into it, because it is a different
   * fact: the gutter is a sign and a number, and this is the room kept for a
   * set of controls only a page with a pointer can draw. Every renderer still
   * reserves it in the same place, marks or no marks — a picture of a card the
   * engine measured with this column in it has to put the code where the card
   * was measured for, and a static export that quietly spent the room on longer
   * lines was drawing a different card from the one on the canvas.
   *
   * It is a measurement rather than a stylesheet's business because it moves
   * where a row's first character sits. The engine sizes every card in the
   * extension host, before the page exists, and the arrows are placed against
   * those sizes — so a strip reserved only in CSS would push the code out of
   * the width the card was measured at and clip the end of every long line.
   * Reserved on every row, including the ones no remark can start on: the code
   * has to begin at one offset down a card, and whether a line is in the patch
   * is a fact about that line rather than about the column.
   */
  pickColumn: number;
  /**
   * Where the base-side number's right edge sits within the left gutter.
   *
   * Past the picking column, because that column leads the gutter: a renderer
   * that measured this from the sign alone would write the numbers underneath
   * the marks a reader picks lines with on the page, and the same card would
   * read two different ways depending on which renderer drew it.
   */
  lineNumberRight: number;
  /** Right gutter: the head-side line number, and the + beside it. */
  rightGutterWidth: number;
  /**
   * The narrowest a card is drawn, so that a file of three short lines still
   * has room for its own title.
   *
   * There is no widest. There was: nineteen hundred, on the argument that a
   * card past it stopped reading as a shape on the canvas. What it did in
   * practice was cut lines the change had written, with an ellipsis and
   * nothing to recover them by - the comment beside it promised the whole line
   * was a hover away, and no hover ever showed it. And it bit far sooner than
   * it looked, because the split reading shares one card between two panes: a
   * changed line of a hundred and fifteen characters in a modified file was
   * already past it. How wide a card should be is a fact about the file, not a
   * number chosen in advance, so a card is as wide as its longest line.
   *
   * Which means a generated or minified file with one enormous line draws one
   * enormous card. That is the file saying what it is.
   */
  minCardWidth: number;
  /** Horizontal space between columns. */
  columnGap: number;
  /** Vertical space between cards in a column. */
  rowGap: number;
  /** Margin around the whole drawing. */
  margin: number;
  /** Height used for a card with nothing to show. */
  emptyCardHeight: number;
  /**
   * Rows a card shows before it is truncated with a "show more" bar.
   *
   * A file that is entirely additions has nothing unchanged to collapse, so
   * without a cap one 500-line card sets the height of the whole drawing and
   * every other card becomes a speck. The cap costs nothing in fidelity — the
   * remaining rows are still there, one click away.
   */
  maxCardRows: number;
}

export const DEFAULT_METRICS: LayoutMetrics = {
  // Menlo advances 0.6023em, so 7.23px at 12px. Rounded up, because a card
  // that is a few pixels too wide looks fine and one that is a few pixels too
  // narrow clips the end of a line.
  charWidth: 7.45,
  fontSize: 12,
  lineHeight: 18,
  titleHeight: 34,
  padding: 12,
  gutterWidth: 58,
  // Wide enough for a mark the size of a row — sixteen across, with a couple of
  // pixels either side so the mark is neither against the sign before it nor
  // against the first digit of the line number after it.
  pickColumn: 20,
  // The sign, the picking column, and then the number's own eight pixels of
  // air before the code: `gutterWidth + pickColumn - 8`.
  lineNumberRight: 70,
  rightGutterWidth: 52,
  minCardWidth: 240,
  columnGap: 140,
  rowGap: 56,
  margin: 48,
  emptyCardHeight: 120,
  maxCardRows: 42,
};
