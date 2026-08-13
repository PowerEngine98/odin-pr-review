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
   * A column of its own, between the line numbers and the code, for the marks
   * a reader picks lines with: the square + a hovered row offers, the grip at
   * each end of a chosen range, and the rail joining them.
   *
   * Beside `gutterWidth` rather than folded into it, because only the page has
   * a pointer and only the page draws these marks. A static SVG places its line
   * numbers a fixed distance inside the gutter, so a wider gutter would have
   * carried them sideways into this column for a set of controls it does not
   * have; left alone it simply spends the room on longer lines.
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
  /** Where the base-side number's right edge sits within the left gutter. */
  lineNumberRight: number;
  /** Right gutter: the head-side line number, and the + beside it. */
  rightGutterWidth: number;
  minCardWidth: number;
  maxCardWidth: number;
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
  // pixels either side so the grip is neither against the last digit nor against
  // the first character of the line.
  pickColumn: 20,
  lineNumberRight: 50,
  rightGutterWidth: 52,
  minCardWidth: 240,
  // Wide enough that a changed line of ordinary length fits even in the split
  // reading, where each pane gets half. Past this a card stops being readable
  // as a shape on the canvas, and what is cut is context rather than anything
  // the change touched — with the whole line a hover away wherever it is cut.
  maxCardWidth: 1900,
  columnGap: 140,
  rowGap: 56,
  margin: 48,
  emptyCardHeight: 120,
  maxCardRows: 42,
};
