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
  /** Where the base-side number's right edge sits within the left gutter. */
  lineNumberRight: number;
  /** Right gutter: the head-side line number. */
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
  lineNumberRight: 50,
  rightGutterWidth: 38,
  minCardWidth: 240,
  maxCardWidth: 620,
  columnGap: 140,
  rowGap: 56,
  margin: 48,
  emptyCardHeight: 120,
};
