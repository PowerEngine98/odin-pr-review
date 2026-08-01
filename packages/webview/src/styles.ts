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

.toolbar {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  font-size: 12px;
}

.toolbar .refs { color: var(--muted); }
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

.legend { display: flex; gap: 12px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
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
.row.gap .header {
  color: var(--gutter);
  font-size: calc(var(--font-size) - 2px);
  overflow: hidden;
  text-overflow: ellipsis;
}

.row .marker {
  width: calc(var(--gutter-width) - var(--line-number-right));
  padding-left: var(--padding);
  color: var(--gutter);
}
.row .num {
  color: var(--gutter);
  font-size: calc(var(--font-size) - 1px);
  text-align: right;
  user-select: none;
}
.row .num.old { width: calc(var(--line-number-right) - var(--padding)); }
.row .num.new {
  width: var(--right-gutter-width);
  padding-right: var(--padding);
}
.row.add .marker, .row.del .marker { color: inherit; }
.row .text { flex: 1; }

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
  max-width: 460px;
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
.tooltip .target { color: var(--text); }
.tooltip .meta { color: var(--muted); }

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
