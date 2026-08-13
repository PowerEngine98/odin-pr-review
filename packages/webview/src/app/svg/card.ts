import type { LayoutMetrics, Theme } from "@odin/core";

import type { CardTitle } from "../canvas/rows.js";

/**
 * What a drawing shows that the view model does not carry.
 *
 * The model is the geometry of the change: where every card sits and what every
 * arrow joins. It says nothing about what is written inside a card, because the
 * page it was written for keeps that in the markup and lets the browser lay it
 * out. An SVG has no browser to lay anything out, so every line it draws has to
 * arrive already measured, already cut to width and already told where its
 * baseline is.
 *
 * All of it is plain data on purpose. These types cross into components that
 * are also compiled for the browser, and anything they import at runtime is
 * bundled with them — which `@odin/core` cannot be, since its entry point
 * reaches `node:child_process`. Types cost nothing at runtime, so they come
 * across; the arithmetic behind them is done in `scene.ts`, once.
 */
export interface Drawn {
  /**
   * The palette, spelled out.
   *
   * A page inherits its colours from a stylesheet in its head. A file dropped
   * into a README has no head and no stylesheet, so every colour it uses has to
   * be written onto the shape that uses it.
   */
  ink: Theme;
  /** The card geometry the layout engine measured this drawing with. */
  metrics: LayoutMetrics;
  /** Each card's heading and rows, keyed by the node they belong to. */
  cards: Record<string, CardFace>;
  /** Every component's compiled styles, for the SVG's own style element. */
  css: string;
  /** Draw the arrows that stand for an import. */
  includeImports: boolean;
  /** Draw the arrows for references that were already there. */
  includeUnchanged: boolean;
}

/** Everything one card draws, prepared. */
export interface CardFace {
  title: CardTitle;
  /**
   * One column of code rather than two. A file that exists on one side only has
   * one text to show, and a schema is not a diff at all.
   */
  panes: 1 | 2;
  rows: DrawnRow[];
  /** The bar at the foot, when the card was measured taller than it shows. */
  more?: DrawnBar;
}

/**
 * The two heights anything sitting on a row is drawn against.
 *
 * `top` is where the row's fill begins and `y` is where its text sits, both
 * measured from the top of the card. Two numbers rather than one and a rule for
 * deriving the other, because a fill and a baseline are not the same offset —
 * text hangs from its baseline, and a band drawn from the same number sits half
 * a line above the line it is standing in for.
 */
export interface RowAt {
  top: number;
  y: number;
}

/** One row of a card: a band across it, or a line of code in each pane. */
export interface DrawnRow extends RowAt {
  /** A run of the file the card is not showing. Spans both panes. */
  band?: { text: string; header?: string };
  left?: DrawnCell;
  right?: DrawnCell;
}

/** One pane of one row: a line of code, on one side of the change. */
export interface DrawnCell {
  kind: "add" | "del" | "ctx";
  /** Already cut to the width this card has room for. */
  text: string;
  /** The line's number in the base checkout, when it has one. */
  base?: number;
  /** And in the head checkout. Both, because the unified reading shows both. */
  head?: number;
}

/** The bar a truncated card wears, and where it sits. */
export interface DrawnBar extends RowAt {
  text: string;
}
