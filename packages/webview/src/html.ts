import {
  DARK_THEME,
  cardTitle,
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

  const visibleEdges = layout.edges;
  const viewModel = {
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes.map((n) => ({
      id: n.id,
      path: n.path,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: visibleEdges.map((e) => ({
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
    edgeLayer(layout),
    layout.nodes.map((node) => card(node, layout)).join("\n"),
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
  <span class="spacer"></span>
  <label><input type="checkbox" id="filter-imports" checked> imports</label>
  <label><input type="checkbox" id="filter-unchanged"> unchanged</label>
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

  void metrics;
  const body = node.rows.map(renderRow).join("");

  return `<div class="card status-${node.node.status}" id="card-${cssId(node.id)}" ` +
    `data-id="${escapeHtml(node.id)}" data-path="${escapeHtml(node.path)}" style="${style}">
  <div class="card-title" title="${escapeHtml(node.path)}">${escapeHtml(title.name)}${was}${stats}</div>
  <div class="card-body">${body}</div>
</div>`;
}

function renderRow(row: DisplayRow): string {
  if (row.kind === "gap") {
    return `<div class="row gap" title="${escapeHtml(row.header ?? "")}">` +
      `<span class="text">${escapeHtml(row.text)}</span>` +
      `<span class="header">${escapeHtml(row.header ?? "")}</span></div>`;
  }

  const marker = row.kind === "add" ? "+" : row.kind === "del" ? "−" : "";
  // Base number on the left, head number on the right, both always present so
  // the columns line up down the whole card. A single shared column would
  // interleave the two numbering schemes and read as nonsense on any file
  // where lines were both added and removed. A line that exists on only one
  // side gets a marker on the other rather than a number: an added line has no
  // position in the base file, and inventing one would be a lie.
  return `<div class="row ${row.kind}">` +
    `<span class="marker">${marker}</span>` +
    `<span class="num old">${row.oldLine ?? "·"}</span>` +
    `<span class="text">${escapeHtml(row.text)}</span>` +
    `<span class="num new">${row.newLine ?? "·"}</span></div>`;
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
