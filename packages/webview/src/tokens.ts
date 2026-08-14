import type { LayoutMetrics, Theme } from "@odin/core";

/**
 * The page's vocabulary: every colour and every measurement, named once.
 *
 * The components carry their own styles — the compiler scopes them, so a rule
 * for a card cannot reach a tab — but the values those rules are written in
 * are not theirs to invent. A theme is the editor's, and the metrics are the
 * layout engine's: the same numbers the arrows were placed against, so a row
 * is the height the drawing already assumed it would be.
 *
 * This is all that survives of the stylesheet the hand-written renderer used.
 * The rest described elements that no longer exist, and while it was still in
 * the document it went on matching components that happened to reuse a class
 * name — which is how a map anchored to one edge ended up stretched across
 * the window by a rule written for a different renderer entirely.
 */
export function tokens(theme: Theme, metrics: LayoutMetrics): string {
  return `
:root {
  /*
   * The palette, which is the drawing's own and not the editor's.
   *
   * These were briefly taken from the running VS Code theme, on the reasoning
   * that a graph should belong to the editor around it. It does not survive
   * contact: the editor names its colours for a file list and a gutter, where
   * a single amber says "modified" against a neutral background. Here the same
   * token fills whole cards and every arrow between them, and a palette built
   * for small marks turns the entire change one colour.
   *
   * The diff's greens and reds are load-bearing in a way a decoration is not —
   * they are how a reader tells what happened to a line — so they are chosen
   * here, together, against this background.
   */
  --bg: ${theme.background};
  --card-bg: ${theme.cardBackground};
  --text: ${theme.text};
  --muted: ${theme.mutedText};
  --gutter: ${theme.gutter};

  /* The diff's own greens and reds. The editor names these for its gutter and
     its own diff view, which is exactly this job. */
  --added: ${theme.change.added};
  --removed: ${theme.change.removed};
  --unchanged: ${theme.change.unchanged};
  --add-bg: ${theme.lineBackground.add};
  --del-bg: ${theme.lineBackground.del};

  --status-added: ${theme.status.added};
  --status-modified: ${theme.status.modified};
  --status-deleted: ${theme.status.deleted};
  --status-renamed: ${theme.status.renamed};
  --status-phantom: ${theme.status.phantom};

  --gap-bg: ${theme.gapBackground};
  --warning: ${theme.warning};

  /* The one colour in the page that means "do the thing". The editor's button
     already carries that meaning and already has a foreground chosen to be
     legible on it, so the pair is taken together or not at all. */
  /*
   * A ticked box, which is not a button.
   *
   * The action colour is the one on the drawing that means "do the thing", and
   * it is green so that Submit review reads as the end of the review. A
   * checkbox is a different sentence: it records that a file has been read, and
   * borrowing the submit button's green made the two look like the same
   * promise. Blue, and the same blue the sidebar's rows already use, so the box
   * is one colour wherever the reader meets it.
   */
  --box-set: var(--vscode-button-background, #0a84ff);
  --action: #007C36;
  --action-ink: #ffffff;

  /* The edge of a floating panel: the same shade as the strip of tabs, so the
     chrome reads as surfaces meeting rather than as boxes drawn on a page. */
  --panel-edge: color-mix(in srgb, var(--text) 8%, var(--card-bg));
  /* The band the tabs sit on. Anything that runs along it takes the same
     colour, so the only mark on that strip is the one that means something. */
  --strip: color-mix(in srgb, var(--text) 8%, var(--card-bg));
  /* The wash over a picked range. Yellow because it is a selection, not a
     verdict: nothing has been said about these lines yet. */
  --pick-wash: color-mix(in srgb, var(--warning) 22%, transparent);

  /*
   * Not inherited, deliberately: the measurements.
   *
   * The layout engine measured every card against a character of a known
   * width and a row of a known height, and every arrow on the canvas was
   * placed from those numbers before this page existed. Taking the editor's
   * font or its size would redraw the text at a width the geometry never
   * agreed to — cards would out-grow the boxes they were given, and the
   * arrows would point at the wrong lines. The reader's own font belongs to
   * their editor; this drawing has to be in the one it was measured in.
   */
  --line-height: ${metrics.lineHeight}px;
  --font-size: ${metrics.fontSize}px;
  --title-height: ${metrics.titleHeight}px;
  --padding: ${metrics.padding}px;
  --gutter-width: ${metrics.gutterWidth}px;
  /* The strip between a row's numbers and its code. Named here with the rest of
     the geometry because it is the engine's number rather than a stylesheet's:
     the cards were sized with this column in them, and a row that drew it any
     other width would start its code somewhere the drawing did not agree to. */
  --pick-column: ${metrics.pickColumn}px;
  --right-gutter-width: ${metrics.rightGutterWidth}px;
  --line-number-right: ${metrics.lineNumberRight}px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  /*
   * What sits in front of what.
   *
   * Named rather than typed into each component, because the numbers only mean
   * anything relative to each other and a component cannot see the others to
   * compare. That is not hypothetical: the map lost its place in the order
   * when the old stylesheet was deleted — it had never declared one of its own,
   * and a reader's comment mark ended up drawn across it.
   *
   * The order is the order a reader reaches for things. The drawing is the
   * page; the marks are on the drawing; the corner panels are over both,
   * because they are how you get back to something you left; the chrome is
   * over those, because it belongs to the window rather than the change; a
   * conversation is over everything it is about; and a menu is over even that,
   * since it was opened from it.
   */
  /* A zoomed-out card's name, over every card rather than only its own: in a
     packed column a name lies across the card above it, and it is the one
     thing on the drawing that has to stay readable at that distance. */
  --z-name: 10;
  --z-canvas: 1;
  --z-marks: 22;
  /* A comment being written belongs to the passage under it, so it sits with
     the marks rather than with the panels: the map and the chrome are how you
     leave this place, and a box that covered them would take that away while
     you were mid-sentence. */
  --z-compose: 23;
  --z-hud: 25;
  --z-chrome: 30;
  --z-panel: 40;
  --z-thread: 41;
  --z-menu: 45;
}


/* ------------------------------------------------------------- the document */

/*
 * What no component can own.
 *
 * Every rule that draws something now lives beside the thing it draws, but a
 * page still has a body, and the body is not a component. These are the few
 * that have nowhere else to be: the box model everything assumes, the
 * attribute that has to beat any display a class sets, and the surface the
 * whole drawing sits on.
 */
* { box-sizing: border-box; }

/* The attribute has to beat any display a class sets, or an element the page
   has hidden stays on screen — which is how a Submit review button once
   appeared on a page with nothing to submit through. */
[hidden] { display: none !important; }

/*
 * The page's own surface, and the typeface the whole drawing is measured in.
 *
 * The font is not decoration here. The layout engine measured every card
 * against a character of a known width, and the arrows were placed from those
 * measurements — so a page that fell back to a proportional face would not
 * merely look wrong, it would be wrong: the columns it drew would not be the
 * columns the geometry assumed.
 *
 * \`overflow: hidden\` because the canvas is panned rather than scrolled. A
 * scrollbar here would be a second way to move a drawing that already has one,
 * and the two disagree.
 */
html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  overflow: hidden;
}
`;
}
/**
 * The sidebar's vocabulary, which is mostly the editor's.
 *
 * The strip lives inside the editor's chrome and should look like it, so where
 * the panel inherits conservatively — taking the editor's colour only where it
 * names one for the same job — this takes it outright. Anything left is the
 * theme's, for a colour VS Code has no name for.
 *
 * The measurements are the editor's too, and that is the real difference from
 * the page. The canvas has to be drawn in the font the layout engine measured
 * it in or the arrows point at the wrong lines; a list of file names has no
 * geometry riding on it and should be in whatever the reader set their sidebar
 * to.
 */
export function sidebarTokens(theme: Theme): string {
  return `
:root {
  --added: ${theme.change.added};
  --removed: ${theme.change.removed};
  --warning: ${theme.warning};
  --muted: ${theme.mutedText};
  --text: var(--vscode-foreground, ${theme.text});
  --status-added: ${theme.status.added};
  --status-modified: ${theme.status.modified};
  --status-deleted: ${theme.status.deleted};
  --status-renamed: ${theme.status.renamed};
  --status-phantom: ${theme.status.phantom};
  /* The forge's own colour for a change that landed. Nothing in the diff
     palette is purple — a renamed file is blue — and "merged" is a state of the
     pull request rather than of a file, so it gets its own. */
  --merged: #a371f7;

  /* The one colour in the view that means "do the thing", taken together with
     the foreground the editor already chose to be legible on it. Named the same
     as the page names it, so the controls the two share — the reviewed box, for
     one — are drawn from one vocabulary rather than two. */
  --box-set: var(--vscode-button-background, #0a84ff);
  --action: var(--vscode-button-background, #0a84ff);
  --action-ink: var(--vscode-button-foreground, #ffffff);
}

/* ------------------------------------------------------------- the document */

/*
 * What no component can own: the box model everything assumes, the attribute
 * that has to beat any display a class sets, and the surface the list sits on.
 */
* { box-sizing: border-box; }

[hidden] { display: none !important; }

/* Full height, because the chooser pins its button to the bottom of the view
   and cannot do that inside a body only as tall as its contents. */
html, body { height: 100%; }

body {
  margin: 0;
  padding: 4px 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
}
`;
}
