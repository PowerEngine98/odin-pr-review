import type { LayoutMetrics, Theme } from "@odin/core";

/**
 * Stylesheet for the interactive renderer.
 *
 * Card geometry is not styled here: positions and sizes come from the layout
 * engine as inline values, so the browser and the static SVG agree pixel for
 * pixel. CSS only handles appearance and interaction state.
 */
export function stylesheet(theme: Theme, metrics: LayoutMetrics): string {
  return `
:root {
  --bg: ${theme.background};
  --card-bg: ${theme.cardBackground};
  --text: ${theme.text};
  --muted: ${theme.mutedText};
  --gutter: ${theme.gutter};
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
  --line-height: ${metrics.lineHeight}px;
  --font-size: ${metrics.fontSize}px;
  --title-height: ${metrics.titleHeight}px;
  --padding: ${metrics.padding}px;
  --gutter-width: ${metrics.gutterWidth}px;
  --right-gutter-width: ${metrics.rightGutterWidth}px;
  --line-number-right: ${metrics.lineNumberRight}px;
  --gap-bg: ${theme.gapBackground};
  --warning: ${theme.warning};
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  overflow: hidden;
}

/* ------------------------------------------------------------------ toolbar */

/* Everything stacks into columns rather than running across the top: a
   docked editor panel is narrow, and a row of eight items wraps into a mess
   long before it runs out of things to say. */
.toolbar {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 8px 14px;
  overflow-x: auto;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  font-size: 12px;
}

/* Stacking the rest of the toolbar into columns freed a great deal of width,
   so branch names get most of it. Real ones are long and the tail is the part
   that identifies them. */
/* A rule between the groups, so the bar reads as sections rather than as one
   long run of unrelated things. */
.toolbar > .legend,
.toolbar > .gaps,
.toolbar > .pr,
.toolbar > .filters,
.toolbar > button {
  border-left: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
  padding-left: 16px;
}
.toolbar > .gaps { border-left-color: color-mix(in srgb, var(--warning) 45%, transparent); }

.toolbar .pr {
  color: var(--status-renamed);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46ch;
  align-self: center;
  flex: 0 1 auto;
  min-width: 0;
}
.toolbar .pr:hover { text-decoration: underline; }
.toolbar .pr .num { color: var(--muted); margin-right: 4px; }

.toolbar .refs {
  color: var(--muted);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 46ch;
  line-height: 1.35;
}
.toolbar .refs strong {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.toolbar .refs .to { color: var(--muted); }
.legend, .filters, .toolbar button { flex: 0 0 auto; }
.toolbar .refs strong { color: var(--text); font-weight: 600; }
.toolbar .spacer { flex: 1; }

.toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.toolbar label:hover { color: var(--text); }
.toolbar input { accent-color: var(--status-renamed); margin: 0; }

.toolbar button {
  font: inherit;
  color: var(--muted);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
}
.toolbar button:hover { color: var(--text); border-color: var(--text); }

.legend {
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: var(--muted);
  line-height: 1.35;
}
.legend span { display: inline-flex; align-items: center; gap: 5px; }

.filters {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.35;
}
.legend i {
  width: 10px; height: 10px; border-radius: 3px;
  border: 1.5px solid currentColor; font-style: normal;
}
.legend .added { color: var(--status-added); }
.legend .modified { color: var(--status-modified); }
.legend .deleted { color: var(--status-deleted); }
.legend .renamed { color: var(--status-renamed); }
.legend .phantom { color: var(--status-phantom); }
.legend .phantom i { border-style: dashed; }

/* ----------------------------------------------------------------- viewport */

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
}
.viewport.panning { cursor: grabbing; }

.canvas {
  position: absolute;
  transform-origin: 0 0;
  will-change: transform;
}

/* -------------------------------------------------------------------- cards */

.card {
  position: absolute;
  background: var(--card-bg);
  border: 1.5px solid var(--status-modified);
  border-radius: 14px;
  overflow: hidden;
  transition: box-shadow 160ms ease, border-color 160ms ease, opacity 160ms ease;
}

.card.status-added    { border-color: var(--status-added); }
.card.status-modified { border-color: var(--status-modified); }
.card.status-deleted  { border-color: var(--status-deleted); }
.card.status-renamed  { border-color: var(--status-renamed); }
.card.status-phantom  { border-color: var(--status-phantom); border-style: dashed; }

.card-title {
  height: var(--title-height);
  padding: 0 var(--padding);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: calc(var(--font-size) + 1px);
  color: var(--status-modified);
  cursor: pointer;
}
.status-added    .card-title { color: var(--status-added); }
.status-deleted  .card-title { color: var(--status-deleted); }
.status-renamed  .card-title { color: var(--status-renamed); }
.status-phantom  .card-title { color: var(--status-phantom); }

.card-title .was { color: var(--muted); font-size: calc(var(--font-size) - 1px); }
.card-title .stats { color: var(--muted); font-size: calc(var(--font-size) - 2px); }
.card-title .stats .added { color: var(--added); }
.card-title .stats .removed { color: var(--removed); }

/* A file nothing could read. Marked rather than left blank, because a card
   with no arrows otherwise looks like a file that references nothing. */
/* Marking a file reviewed is a per-reader note, not a fact about the change,
   so it sits apart from the counts and stays quiet until hovered. */
.card-title .viewed {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  opacity: 0.35;
  cursor: pointer;
  transition: opacity 120ms ease;
}
.card-title .viewed:hover,
.card.is-viewed .card-title .viewed { opacity: 1; }
.card-title .viewed input { margin: 0; cursor: pointer; }

.card.is-viewed { opacity: 0.45; }
/* Settled by its callers rather than by a click: dimmed like the rest, but
   without the checkbox lighting up, which would claim a decision nobody made. */
.card.is-implied .card-title .viewed { opacity: 0.2; }

.card-title .note {
  color: var(--warning);
  font-size: calc(var(--font-size) - 2px);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-radius: 5px;
  padding: 0 6px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.card.unresolved { border-style: dashed; }

/* A pill radius on a box that has wrapped turns it into a circle, which is
   what a narrow editor panel does to it. Fixed radius, one line, and let the
   toolbar scroll instead. */
.toolbar .gaps {
  align-self: center;
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-radius: 5px;
  padding: 1px 8px;
  white-space: nowrap;
  flex: 0 0 auto;
}

.card-body { padding: var(--padding) 0; }

.row {
  display: flex;
  height: var(--line-height);
  line-height: var(--line-height);
  font-size: var(--font-size);
  white-space: pre;
}
.row.add { background: var(--add-bg); color: var(--added); }
.row.del { background: var(--del-bg); color: var(--removed); }

/* A collapsed run of untouched code, banded the way a diff viewer marks the
   part of a file it is not showing. */
.row.gap {
  background: var(--gap-bg);
  color: var(--muted);
  font-size: calc(var(--font-size) - 1px);
  padding: 0 var(--padding);
  justify-content: space-between;
  gap: 12px;
}
/* Rows the card starts out hiding: past the height cap, or inside a closed
   gap. Present in the document, absent from the picture. */
.row.beyond-cap,
.row.in-gap { display: none; }
.card.expanded .row.beyond-cap { display: flex; }
.row.gap.open + .row.in-gap,
.row.in-gap.open { display: flex; }

/* Gaps open and close rather than opening once, so a band keeps its row
   instead of dissolving into what it revealed and leaving no way back. */
.row.gap.expandable.open { color: var(--gutter); }
.row.gap.expandable.open .text::before { content: "▾ "; }
.row.gap.expandable:not(.open) .text::before { content: "▸ "; }

.row.gap.expandable,
.row.more {
  cursor: pointer;
  user-select: none;
}
.row.gap.expandable:hover,
.row.more:hover { color: var(--text); }

.row.more {
  background: var(--gap-bg);
  color: var(--muted);
  font-size: calc(var(--font-size) - 1px);
  justify-content: center;
}
.row.more .text { flex: 0 0 auto; }

.row.gap .header {
  color: var(--gutter);
  font-size: calc(var(--font-size) - 2px);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The left block spans padding + gutter, matching the static renderer: the
   marker sits at the padding, the base number's right edge lands on
   --line-number-right, and the text starts a clear gap after it. */
.row .marker {
  width: calc(var(--padding) + 14px);
  padding-left: var(--padding);
  color: var(--gutter);
}
.row .num {
  color: var(--gutter);
  opacity: 0.85;
  font-size: calc(var(--font-size) - 1px);
  text-align: right;
  user-select: none;
}
.row .num.anchor { opacity: 0.5; }
.row .num.old {
  width: calc(var(--padding) + var(--line-number-right) - var(--padding) - 14px);
  flex: 0 0 auto;
}
.row .num.new {
  width: var(--right-gutter-width);
  padding-right: var(--padding);
  flex: 0 0 auto;
}
.row .marker { flex: 0 0 auto; }
.row.add .marker, .row.del .marker { color: inherit; }

/* min-width:0 is load-bearing: without it a flex item refuses to shrink below
   its own content, so a long pre-formatted line runs past the card border and
   out from under the line numbers. */
.row .text {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: calc(var(--gutter-width) - var(--line-number-right));
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Rows an arrow touches get a marker so the eye can find them without
   following the line all the way back. */
.row.anchor::after {
  content: "";
  position: absolute;
  right: 0;
  width: 3px;
  height: var(--line-height);
  background: currentColor;
  opacity: 0;
}

/* -------------------------------------------------------------------- edges */

#edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

#edges path.wire {
  fill: none;
  stroke-width: 1.8;
  opacity: 0.85;
  transition: opacity 160ms ease, stroke-width 160ms ease;
}
#edges path.hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  pointer-events: stroke;
  cursor: pointer;
}
#edges g.edge.added    path.wire { stroke: var(--added); }
#edges g.edge.removed  path.wire { stroke: var(--removed); }
#edges g.edge.unchanged path.wire { stroke: var(--unchanged); }
#edges g.edge.import   path.wire { stroke-dasharray: 4 4; opacity: 0.5; }

#edges g.edge.hidden { display: none; }
#edges g.edge.dim path.wire { opacity: 0.12; }
#edges g.edge.active path.wire { opacity: 1; stroke-width: 3; }

.card.hidden,
.card.viewed-hidden { display: none; }
#edges g.edge.viewed-hidden { display: none; }
.card.dim { opacity: 0.32; }
.card.active { box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 22%, transparent); }
.card.flash { animation: flash 900ms ease-out; }

@keyframes flash {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-renamed) 80%, transparent); }
  100% { box-shadow: 0 0 0 26px color-mix(in srgb, var(--status-renamed) 0%, transparent); }
}

/* -------------------------------------------------------------------- hover */

.tooltip {
  position: fixed;
  z-index: 30;
  max-width: 440px;
  padding: 7px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 92%, var(--text) 8%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}
.tooltip.visible { opacity: 1; }
.tooltip .arrow { color: var(--unchanged); font-weight: 600; }
.tooltip.added .arrow { color: var(--added); }
.tooltip.removed .arrow { color: var(--removed); }
.tooltip .target,
.tooltip .meta {
  white-space: normal;
  overflow-wrap: anywhere;
}
.tooltip .target { color: var(--text); }
.tooltip .meta { color: var(--muted); }
.tooltip .meta .at { color: var(--gutter); margin: 0 1px; }
.tooltip .meta .line { color: var(--text); opacity: 0.75; }

/* What the reference is says something different from where it goes, so it is
   set apart rather than run on as a third line of the same grey. */
.tooltip .facts {
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  color: var(--gutter);
  font-size: 10px;
  letter-spacing: 0.02em;
}
.tooltip .facts .added { color: var(--added); }
.tooltip .facts .removed { color: var(--removed); }
.tooltip .facts .unchanged { color: var(--unchanged); }

.hint {
  position: fixed;
  right: 14px;
  bottom: 12px;
  z-index: 20;
  color: var(--muted);
  font-size: 11px;
  text-align: right;
  line-height: 1.7;
  pointer-events: none;
}
`;
}
