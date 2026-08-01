import {
  DARK_THEME,
  cardTitle,
  describeGaps,
  type ChangeGraph,
  type DisplayRow,
  type GraphLayout,
  type PlacedEdge,
  type PlacedNode,
  type Theme,
} from "@odin/core";

import { CLIENT_SCRIPT } from "./client.js";
import { stylesheet } from "./styles.js";

export interface RenderOptions {
  theme?: Theme;
  title?: string;
  /**
   * Positions to use when test files are shown.
   *
   * Hiding tests changes the layout, and the browser has no layout engine, so
   * both arrangements are computed here and the checkbox swaps between them.
   * Two sets of coordinates cost a few kilobytes; shipping the layout engine to
   * the client would cost far more, and risk the two disagreeing.
   */
  withTests?: GraphLayout;
  /**
   * Content policy for an editor webview, which refuses inline scripts without
   * one. Omitted for a standalone file, where the document is opened directly
   * from disk and no policy applies.
   */
  csp?: {
    /** Per-load random value; the host must generate a fresh one each time. */
    nonce: string;
    /** The host's resource origin, e.g. `webview.cspSource`. */
    source: string;
  };
}

/**
 * Renders a laid-out change graph as one self-contained HTML document.
 *
 * Cards and arrows are written into the markup rather than built by script, so
 * the page is meaningful before any JavaScript runs, the code inside it is
 * findable with the browser's own search, and the same markup can be handed to
 * an editor webview under a strict content policy.
 */
export function renderHtml(
  graph: ChangeGraph,
  layout: GraphLayout,
  options: RenderOptions = {},
): string {
  const theme = options.theme ?? DARK_THEME;
  const title = options.title ??
    `${graph.meta.baseRef} → ${graph.meta.headRef} · Odin`;

  const full = options.withTests ?? layout;
  const place = (l: GraphLayout) => ({
    width: l.width,
    height: l.height,
    nodes: Object.fromEntries(
      l.nodes.map((n) => [n.id, { x: n.x, y: n.y, height: n.height }]),
    ),
  });

  const viewModel = {
    width: layout.width,
    height: layout.height,
    // Cards come from the arrangement that includes everything, so the markup
    // holds every file; only positions and visibility change with the toggle.
    nodes: full.nodes.map((n) => ({
      id: n.id,
      path: n.path,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      isTest: n.node.isTest === true,
    })),
    arrangements: { withTests: place(full), withoutTests: place(layout) },
    edges: full.edges.map((e) => ({
      id: e.id,
      from: e.edge.from.nodeId,
      to: e.edge.to.nodeId,
      fromPath: pathOf(layout, e.edge.from.nodeId),
      toPath: pathOf(layout, e.edge.to.nodeId),
      fromLine: e.edge.from.line,
      toLine: e.edge.to.line,
      // Which checkout each end lives in. A host that opens files needs this:
      // a removed reference points at the merge base, not the working tree.
      fromSide: e.edge.from.side,
      toSide: e.edge.to.side,
      change: e.edge.change,
      kind: e.edge.kind,
      confidence: e.edge.confidence,
      symbol: e.edge.to.symbolName ?? "",
      label: e.edge.label ?? "",
    })),
  };

  const nonce = options.csp ? ` nonce="${options.csp.nonce}"` : "";

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    ...(options.csp ? [contentSecurityPolicy(options.csp)] : []),
    `<title>${escapeHtml(title)}</title>`,
    `<style>${stylesheet(theme, layout.metrics)}</style>`,
    `</head><body>`,
    toolbar(graph, layout),
    `<div class="viewport">`,
    `<div class="canvas" style="width:${layout.width}px;height:${layout.height}px">`,
    edgeLayer(full),
    full.nodes.map((node) => card(node, full)).join("\n"),
    `</div></div>`,
    `<div class="tooltip"></div>`,
    hint(),
    `<script${nonce}>window.__ODIN__=${jsonForScript(viewModel)};</script>`,
    `<script${nonce}>${CLIENT_SCRIPT}</script>`,
    `</body></html>`,
  ].join("\n");
}

/**
 * Locks the page down to what it actually needs: its own inline styles, the two
 * nonced scripts, and nothing else. There is no network access to grant, since
 * the document embeds everything it uses.
 */
function contentSecurityPolicy(csp: { nonce: string; source: string }): string {
  const policy = [
    `default-src 'none'`,
    `style-src ${csp.source} 'unsafe-inline'`,
    `script-src 'nonce-${csp.nonce}'`,
    `img-src ${csp.source} data:`,
    `font-src ${csp.source}`,
  ].join("; ");
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

function toolbar(graph: ChangeGraph, layout: GraphLayout): string {
  const gaps = describeGaps(graph.meta.coverage);
  const counts = layout.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.node.status] = (acc[n.node.status] ?? 0) + 1;
    return acc;
  }, {});

  const legend = (["added", "modified", "deleted", "renamed", "phantom"] as const)
    .filter((status) => counts[status])
    .map(
      (status) =>
        `<span class="${status}"><i></i>${counts[status]} ${status}</span>`,
    )
    .join("");

  return `<div class="toolbar">
  <span class="refs"><strong>${escapeHtml(graph.meta.baseRef)}</strong> → <strong>${escapeHtml(graph.meta.headRef)}</strong></span>
  <span class="legend">${legend}</span>
  ${gaps ? `<span class="gaps" title="These files have diff lines but no arrows, because nothing could read them">${escapeHtml(gaps)}</span>` : ""}
  <span class="spacer"></span>
  <label><input type="checkbox" id="filter-imports" checked> imports</label>
  <label><input type="checkbox" id="filter-unchanged"> unchanged</label>
  <label title="Test files reference a great deal of what they exercise, which buries the change under them"><input type="checkbox" id="filter-tests"> tests</label>
  <button id="action-fit">fit</button>
</div>`;
}

function hint(): string {
  return `<div class="hint">
  click an arrow to follow it &middot; click a filename to isolate &middot; ⌘/ctrl + click to open it<br>
  scroll to pan &middot; ⌘/ctrl + scroll to zoom &middot; <b>f</b> to fit &middot; <b>esc</b> to clear
</div>`;
}

function card(node: PlacedNode, layout: GraphLayout): string {
  const { metrics } = layout;
  const style =
    `left:${node.x}px;top:${node.y}px;` +
    `width:${node.width}px;height:${node.height}px`;

  const title = cardTitle(node.node);
  const was = title.was ? `<span class="was">${escapeHtml(title.was)}</span>` : "";
  const stats = `<span class="stats">${escapeHtml(title.stats)}</span>`;
  const note = title.note
    ? `<span class="note" title="Odin could not look for references in this file">${escapeHtml(title.note)}</span>`
    : "";

  void metrics;

  // Every row is written into the document, including the ones the card starts
  // out hiding. Expanding is then a matter of revealing markup that is already
  // there, and the browser's own search still finds code inside a closed gap.
  const body = node.rows
    .map((row, i) => renderRow(row, i >= node.visibleRows))
    .join("");
  const more =
    node.hiddenRows > 0
      ? `<div class="row more" role="button" tabindex="0">` +
        `<span class="text">show ${node.hiddenRows} more lines</span></div>`
      : "";

  const unresolved = title.note ? " unresolved" : "";
  const test = node.node.isTest ? " is-test" : "";
  return `<div class="card status-${node.node.status}${unresolved}${test}" id="card-${cssId(node.id)}" ` +
    `data-id="${escapeHtml(node.id)}" data-path="${escapeHtml(node.path)}" style="${style}">
  <div class="card-title" title="${escapeHtml(node.path)}">${escapeHtml(title.name)}${was}${stats}${note}</div>
  <div class="card-body">${body}${more}</div>
</div>`;
}

function renderRow(row: DisplayRow, beyondCap = false): string {
  const overflow = beyondCap ? " beyond-cap" : "";

  if (row.kind === "gap") {
    // A gap that knows what it hides can be opened; one that does not must not
    // pretend otherwise, so it is rendered inert.
    const expandable = row.rows ? " expandable" : "";
    const hidden = (row.rows ?? [])
      .map((inner) => renderRow(inner, beyondCap).replace(
        'class="row ', 'class="row in-gap ',
      ))
      .join("");
    return `<div class="row gap${expandable}${overflow}" title="${escapeHtml(row.header ?? "")}"` +
      (row.rows ? ' role="button" tabindex="0"' : "") + ">" +
      `<span class="text">${escapeHtml(row.text)}</span>` +
      `<span class="header">${escapeHtml(row.header ?? "")}</span></div>` +
      hidden;
  }

  const marker = row.kind === "add" ? "+" : row.kind === "del" ? "−" : "";
  // Base number on the left, head number on the right, both always populated so
  // the columns run unbroken down the card. A single shared column would
  // interleave the two numbering schemes and read as nonsense on any file where
  // lines were both added and removed. Where a line exists on one side only,
  // the other column shows the position it occupies there rather than a line
  // number it does not have, dimmed so the difference is visible.
  // The line numbers double as anchors: after an expansion the client finds a
  // row by the line it shows rather than by an index that has since moved.
  const anchors =
    (row.oldLine !== undefined ? ` data-old="${row.oldLine}"` : "") +
    (row.newLine !== undefined ? ` data-new="${row.newLine}"` : "");
  return `<div class="row ${row.kind}${overflow}"${anchors}>` +
    `<span class="marker">${marker}</span>` +
    `<span class="num old${row.oldLine === undefined ? " anchor" : ""}">` +
      `${row.oldLine ?? row.oldAnchor ?? ""}</span>` +
    `<span class="text">${escapeHtml(row.text)}</span>` +
    `<span class="num new${row.newLine === undefined ? " anchor" : ""}">` +
      `${row.newLine ?? row.newAnchor ?? ""}</span></div>`;
}

function edgeLayer(layout: GraphLayout): string {
  const markers = (["added", "removed", "unchanged"] as const)
    .map(
      (change) =>
        `<marker id="arrow-${change}" viewBox="0 0 10 10" refX="9" refY="5" ` +
        `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M 0 0 L 10 5 L 0 10 z" class="head-${change}"/></marker>`,
    )
    .join("");

  const style =
    `<style>` +
    `#arrow-added path, .head-added { fill: var(--added); }` +
    `#arrow-removed path, .head-removed { fill: var(--removed); }` +
    `#arrow-unchanged path, .head-unchanged { fill: var(--unchanged); }` +
    `</style>`;

  const paths = layout.edges.map((edge) => {
    const d = curve(edge);
    return `<g class="edge ${edge.edge.change} ${edge.edge.kind}" data-id="${escapeHtml(edge.id)}">` +
      `<path class="hit" d="${d}"/>` +
      `<path class="wire" d="${d}" marker-end="url(#arrow-${edge.edge.change})"/>` +
      `</g>`;
  });

  return `<svg id="edges" width="${layout.width}" height="${layout.height}">` +
    `<defs>${markers}</defs>${style}${paths.join("")}</svg>`;
}

/** Same curve the static SVG draws, so the two renderers agree. */
function curve(edge: PlacedEdge): string {
  const dx = Math.max(40, Math.abs(edge.to.x - edge.from.x) * 0.45);
  const c1 = edge.fromSide === "right" ? edge.from.x + dx : edge.from.x - dx;
  const c2 = edge.toSide === "left" ? edge.to.x - dx : edge.to.x + dx;
  return `M ${edge.from.x} ${edge.from.y} C ${c1} ${edge.from.y}, ${c2} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`;
}

function pathOf(layout: GraphLayout, nodeId: string): string {
  return layout.nodes.find((n) => n.id === nodeId)?.path ?? nodeId;
}

function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Embeds JSON in a `<script>` safely. Source text can legitimately contain
 * `</script>`, and a naive stringify would end the block early and put the rest
 * of the diff into the document as markup.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    // Valid in JSON, but they terminate a JavaScript string literal, and
    // source text can legitimately contain them.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
