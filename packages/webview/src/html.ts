import {
  DARK_THEME,
  cardTitle,
  describeGaps,
  type ReviewComment,
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
  /** Comments already on the pull request. */
  comments?: ReviewComment[];
  /** Whether the host can post a review; without it the composer is pointless. */
  canReview?: boolean;
  /**
   * Syntax colouring, already loaded for the languages in this change.
   *
   * Structural on purpose: the renderer needs no dependency on whatever
   * produces the tokens, and a caller with none simply leaves it out and gets
   * the plain text it has always had.
   */
  highlight?: CodeHighlighter;
}

export interface CodeToken {
  text: string;
  color?: string;
  /** 1 italic, 2 bold, 4 underline. */
  fontStyle?: number;
}

export interface CodeHighlighter {
  supports(language: string): boolean;
  tokenize(language: string, code: string): CodeToken[][];
  /** Languages in the change that nothing could colour. */
  readonly missing: readonly string[];
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

  const comments = options.comments ?? [];
  const full = options.withTests ?? layout;
  // Column identity belongs to the arrangement, not to the file: hiding the
  // tests changes the graph, which changes the ranking. Carrying it from one
  // arrangement while taking positions from another is how cards end up
  // believing they are in a column they are not, and collide.
  const place = (l: GraphLayout) => ({
    width: l.width,
    height: l.height,
    nodes: Object.fromEntries(
      l.nodes.map((n) => [
        n.id,
        { x: n.x, y: n.y, height: n.height, column: n.rank },
      ]),
    ),
  });

  const viewModel = {
    width: layout.width,
    height: layout.height,
    rowGap: layout.metrics.rowGap,
    // Cards come from the arrangement that includes everything, so the markup
    // holds every file; only positions and visibility change with the toggle.
    nodes: full.nodes.map((n) => ({
      id: n.id,
      path: n.path,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      // Which column the card belongs to. Cards are centred within a column,
      // so two in the same one rarely share an x — comparing x to decide what
      // moves together leaves the odd-width cards behind, and they collide.
      column: n.rank,
      isTest: n.node.isTest === true,
      // A file the diff never touched is in the picture only because something
      // points at it, which is what lets it follow those references' state.
      untouched: n.node.status === "phantom",
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
    canReview: options.canReview === true,
    comments: comments.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line,
      startLine: c.startLine ?? c.line,
      side: c.side,
      body: c.body,
      author: c.author,
      url: c.url,
      outdated: c.outdated,
    })),
  };

  const nonce = options.csp ? ` nonce="${options.csp.nonce}"` : "";

  // Cards first: colouring them is what fills the palette, and the palette has
  // to be in the head before anything it names is used.
  const palette = new Palette();
  const cards = full.nodes
    .map((node) => card(node, full, options.highlight, palette))
    .join("\n");
  const colours = palette.stylesheet();

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    ...(options.csp ? [contentSecurityPolicy(options.csp)] : []),
    `<title>${escapeHtml(title)}</title>`,
    `<style>${stylesheet(theme, layout.metrics)}</style>`,
    ...(colours ? [`<style>${colours}</style>`] : []),
    `</head><body>`,
    // One fixed block, so the two rows cannot drift apart and the canvas has a
    // single height to make room for.
    `<div class="chrome">`,
    prBar(graph),
    toolbar(graph, layout, options.highlight),
    `</div>`,
    `<div class="viewport">`,
    `<div class="canvas" style="width:${layout.width}px;height:${layout.height}px">`,
    edgeLayer(full),
    cards,
    `</div></div>`,
    `<div class="tooltip"></div>`,
    composer(),
    reviewPanel(),
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

/**
 * Languages present in the change that nothing could colour.
 *
 * Said out loud rather than left as a card that is quietly grey. Odin bundles
 * grammars for the languages it lists, not for all two hundred Shiki carries,
 * and a reviewer looking at uncoloured code deserves to know which of the two
 * reasons they are looking at.
 */
function paint(highlight: CodeHighlighter | undefined): string {
  const missing = highlight?.missing ?? [];
  if (missing.length === 0) return "";

  const names = missing.length > 3
    ? `${missing.slice(0, 3).join(", ")} and ${missing.length - 3} more`
    : missing.join(", ");
  return (
    `<span class="paint" title="Odin ships VS Code's own grammars for the ` +
    `languages it supports. These are not among them, so their code is shown ` +
    `uncoloured; adding one is a line in @odin/highlight.">` +
    `no highlighting for ${escapeHtml(names)}</span>`
  );
}

function toolbar(
  graph: ChangeGraph,
  layout: GraphLayout,
  highlight?: CodeHighlighter,
): string {
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
  <span class="legend">${legend}</span>
  ${gaps ? `<span class="gaps" title="These files have diff lines but no arrows, because nothing could read them">${escapeHtml(gaps)}</span>` : ""}
  ${paint(highlight)}
  <span class="spacer"></span>
  <span class="filters">
    <label title="Import statements and the arrows they produce"><input type="checkbox" id="filter-imports"> imports</label>
    <label><input type="checkbox" id="filter-unchanged"> unchanged</label>
    <label title="Test files reference a great deal of what they exercise, which buries the change under them"><input type="checkbox" id="filter-tests"> tests</label>
    <label title="Files you have marked as reviewed"><input type="checkbox" id="filter-viewed" checked> hide viewed</label>
  </span>
  <button id="action-fit">fit</button>
</div>`;
}

/**
 * The header a pull request has on the forge.
 *
 * Reviewing here and reviewing in the browser should not feel like two
 * different jobs, and the browser's answer to "what am I looking at" is this
 * bar: the state, the title, who is merging what into where, and how much of it
 * has been read. Repeating its shape costs a few rules and saves the reader
 * from having to learn a second one.
 *
 * It renders with or without a pull request. A branch compared against another
 * branch still has an author, a commit count and two ref names, and losing the
 * whole header because no forge is involved would be a strange way to treat the
 * offline case.
 */
function prBar(graph: ChangeGraph): string {
  const meta = graph.meta;
  const pull = meta.pullRequest;
  const authors = meta.authors ?? [];
  const commits = authors.reduce((n, a) => n + a.commits, 0);

  const state = pull
    ? pull.draft
      ? `<span class="state draft">${PR_ICON}Draft</span>`
      : `<span class="state open">${PR_ICON}Open</span>`
    : `<span class="state local">${PR_ICON}Local</span>`;

  const decision =
    pull?.reviewDecision === "APPROVED"
      ? `<span class="tag ok">approved</span>`
      : pull?.reviewDecision === "CHANGES_REQUESTED"
        ? `<span class="tag warn">changes requested</span>`
        : pull?.reviewDecision === "REVIEW_REQUIRED"
          ? `<span class="tag muted">review required</span>`
          : "";

  const heading = pull
    ? `<span class="pr-title" title="${escapeHtml(pull.title)}">${escapeHtml(pull.title)}</span>` +
      `<a class="pr-number" href="${escapeHtml(pull.url)}" target="_blank" rel="noreferrer" ` +
      `title="Open #${pull.number} in the browser">#${pull.number}</a>${decision}`
    : `<span class="pr-title">${escapeHtml(meta.headRef)}</span>`;

  // "wants to merge" is the forge's phrasing, and it is worth borrowing: it
  // names the direction, which two ref names side by side never quite do.
  const who = authors[0]?.name;
  const count = commits === 1 ? "1 commit" : `${commits} commits`;
  const merging =
    (who ? `<span class="who">${escapeHtml(who)}</span> wants to merge ` : "merging ") +
    (commits ? `${count} ` : "") +
    `into <span class="ref base">${escapeHtml(meta.baseRef)}</span> ` +
    `from <span class="ref head">${escapeHtml(meta.headRef)}</span>` +
    `<button class="copy-ref" title="Copy the branch name" data-ref="${escapeHtml(meta.headRef)}">${COPY_ICON}</button>`;

  return `<div class="prbar">
  ${state}
  <span class="about">
    <span class="head-line">${heading}</span>
    <span class="merge-line">${merging}</span>
  </span>
  <span class="spacer"></span>
  <span class="viewed-count" title="Files you have marked as reviewed">
    ${RING}<span class="tally">0 / 0</span> viewed</span>
  <button id="action-review" class="submit" hidden>Submit review<span class="count" hidden>0</span></button>
</div>`;
}

/** A pull request, drawn rather than borrowed, so nothing has to be fetched. */
const PR_ICON =
  `<svg class="icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<circle cx="4" cy="3.6" r="1.9" fill="currentColor"/>` +
  `<circle cx="4" cy="12.4" r="1.9" fill="currentColor"/>` +
  `<circle cx="12" cy="12.4" r="1.9" fill="currentColor"/>` +
  `<path d="M4 5.9v4.4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
  `<path d="M12 10.3V7.2a2.6 2.6 0 0 0-2.6-2.6H6.6" stroke="currentColor" stroke-width="1.5" ` +
  `fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const COPY_ICON =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<rect x="5.2" y="1.8" width="8" height="9.4" rx="1.6" stroke="currentColor" ` +
  `stroke-width="1.3" fill="none"/>` +
  `<path d="M10.8 13.2a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V5.6" ` +
  `stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;

/**
 * The progress ring beside the tally.
 *
 * Drawn as a circle whose dash pattern the client rewrites, so reading a file
 * moves it without anything being re-rendered.
 */
const RING =
  `<svg class="ring" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `opacity="0.3"/>` +
  `<circle class="arc" cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0 39" ` +
  `transform="rotate(-90 8 8)"/></svg>`;

/**
 * Where a line comment is written.
 *
 * Kept out of the card so that composing does not change any card's height and
 * set every arrow in the column moving; it floats over the canvas instead,
 * anchored to whatever line was clicked.
 */
function composer(): string {
  return `<div class="composer" hidden>
  <div class="composer-where"></div>
  <textarea class="composer-body" rows="4" placeholder="Leave a comment"></textarea>
  <label class="composer-suggest"><input type="checkbox" class="as-suggestion"> suggest a replacement</label>
  <div class="composer-actions">
    <button class="composer-cancel">Cancel</button>
    <button class="composer-add primary">Add to review</button>
  </div>
</div>`;
}

/**
 * The pending review: what has been written, and the verdict to send it with.
 *
 * Comments accumulate here rather than being posted one at a time, which is
 * both what the forge's own model expects and what spares a team a notification
 * per remark. Nothing leaves the machine until one of these three is pressed.
 */
function reviewPanel(): string {
  return `<div class="review" hidden>
  <div class="review-head">Pending review · <span class="review-count">0</span></div>
  <div class="review-list"></div>
  <textarea class="review-body" rows="3" placeholder="Summary (required to comment or request changes)"></textarea>
  <div class="review-actions">
    <button class="review-submit" data-event="APPROVE">Approve</button>
    <button class="review-submit" data-event="COMMENT">Comment</button>
    <button class="review-submit" data-event="REQUEST_CHANGES">Request changes</button>
  </div>
</div>`;
}

function hint(): string {
  return `<div class="hint">
  click an arrow to follow it &middot; click a filename to isolate &middot; ⌘/ctrl + click to open it<br>
  scroll to pan &middot; ⌘/ctrl + scroll to zoom &middot; <b>f</b> to fit &middot; <b>esc</b> to clear
</div>`;
}

/**
 * Colours a card's code, one contiguous run at a time.
 *
 * Runs matter: a line taken on its own cannot be told apart from the middle of
 * a block comment, so the largest genuinely adjacent stretch is handed over at
 * once. Lines hidden inside an expandable gap are part of the stretch — they
 * are the file's own lines, just folded — while a gap that knows nothing about
 * what it hides ends it, since the next row is somewhere else in the file.
 */
function colourRows(
  node: PlacedNode,
  highlight: CodeHighlighter | undefined,
): Map<DisplayRow, CodeToken[]> {
  const coloured = new Map<DisplayRow, CodeToken[]>();
  const language = node.node.language;
  if (!highlight || !language || !highlight.supports(language)) return coloured;

  let run: DisplayRow[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const lines = highlight.tokenize(language, run.map((r) => r.text).join("\n"));
    run.forEach((row, i) => {
      const line = lines[i];
      if (line) coloured.set(row, line);
    });
    run = [];
  };

  const walk = (rows: readonly DisplayRow[]): void => {
    for (const row of rows) {
      if (row.kind === "gap") {
        if (row.rows) walk(row.rows);
        else flush();
        continue;
      }
      run.push(row);
    }
  };

  walk(node.rows);
  flush();
  return coloured;
}

/**
 * The colours a page ended up using, as classes.
 *
 * A style attribute per token would be most of the document: a large card runs
 * to thousands of tokens and a theme uses a dozen colours. Collecting them
 * turns thirty bytes a token into three.
 */
class Palette {
  private readonly names = new Map<string, string>();

  classFor(token: CodeToken): string {
    if (!token.color && !token.fontStyle) return "";
    const key = `${token.color ?? ""}|${token.fontStyle ?? 0}`;
    let name = this.names.get(key);
    if (!name) {
      name = `t${this.names.size}`;
      this.names.set(key, name);
    }
    return name;
  }

  stylesheet(): string {
    const rules: string[] = [];
    for (const [key, name] of this.names) {
      const [color, style] = key.split("|");
      const bits = Number(style);
      const parts = [
        color ? `color:${color}` : "",
        bits & 1 ? "font-style:italic" : "",
        bits & 2 ? "font-weight:bold" : "",
        bits & 4 ? "text-decoration:underline" : "",
      ].filter(Boolean);
      rules.push(`.${name}{${parts.join(";")}}`);
    }
    return rules.join("");
  }
}

function card(
  node: PlacedNode,
  layout: GraphLayout,
  highlight?: CodeHighlighter,
  palette?: Palette,
): string {
  const { metrics } = layout;
  const style =
    `left:${node.x}px;top:${node.y}px;` +
    `width:${node.width}px;height:${node.height}px`;

  const title = cardTitle(node.node);
  const was = title.was ? `<span class="was">${escapeHtml(title.was)}</span>` : "";
  // Counts carry the diff's own colours, so the card header reads at a glance.
  const counts = [
    title.additions ? `<span class="added">${escapeHtml(title.additions)}</span>` : "",
    title.deletions ? `<span class="removed">${escapeHtml(title.deletions)}</span>` : "",
  ].filter(Boolean).join(" ");
  const stats = counts
    ? `<span class="stats">${counts}</span>`
    : `<span class="stats">${escapeHtml(title.stats)}</span>`;
  const note = title.note
    ? `<span class="note" title="Odin could not look for references in this file">${escapeHtml(title.note)}</span>`
    : "";

  void metrics;

  // Every row is written into the document, including the ones the card starts
  // out hiding. Expanding is then a matter of revealing markup that is already
  // there, and the browser's own search still finds code inside a closed gap.
  const coloured = colourRows(node, highlight);
  const body = node.rows
    .map((row, i) => renderRow(row, i >= node.visibleRows, coloured, palette))
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
  <div class="card-title" title="${escapeHtml(node.path)}">${escapeHtml(title.name)}${was}${stats}${note}` +
    `<label class="viewed" title="Mark as reviewed"><input type="checkbox" class="viewed-box"></label></div>
  <div class="card-body">${body}${more}</div>
</div>`;
}

function renderRow(
  row: DisplayRow,
  beyondCap = false,
  coloured?: Map<DisplayRow, CodeToken[]>,
  palette?: Palette,
): string {
  const overflow = beyondCap ? " beyond-cap" : "";

  if (row.kind === "gap") {
    // A gap that knows what it hides can be opened; one that does not must not
    // pretend otherwise, so it is rendered inert.
    const expandable = row.rows ? " expandable" : "";
    const imports = row.imports ? " imports" : "";
    const hidden = (row.rows ?? [])
      .map((inner) => renderRow(inner, beyondCap, coloured, palette).replace(
        'class="row ', 'class="row in-gap ',
      ))
      .join("");
    return `<div class="row gap${expandable}${imports}${overflow}" title="${escapeHtml(row.header ?? "")}"` +
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
  // A wholly added or deleted file has a single numbering, so it is mirrored
  // into the other gutter rather than leaving a column empty down the card.
  const left = row.oldLine ?? row.oldAnchor ?? row.newLine;
  const right = row.newLine ?? row.newAnchor ?? row.oldLine;

  return `<div class="row ${row.kind}${overflow}"${anchors}>` +
    `<span class="marker">${marker}</span>` +
    `<span class="num old${row.oldLine === undefined ? " anchor" : ""}">` +
      `${left ?? ""}</span>` +
    `<span class="text">${code(row, coloured?.get(row), palette)}</span>` +
    `<span class="num new${row.newLine === undefined ? " anchor" : ""}">` +
      `${right ?? ""}</span></div>`;
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

/**
 * One line of code, coloured if anything could colour it.
 *
 * The characters are the file's, untouched — only spans are added around them.
 * That matters for more than looks: the browser's own search still finds a
 * string inside a card, and the width the layout engine measured is still the
 * width the line takes.
 */
function code(row: DisplayRow, tokens?: CodeToken[], palette?: Palette): string {
  if (!tokens || tokens.length === 0 || !palette) return escapeHtml(row.text);

  return tokens
    .map((token) => {
      const name = palette.classFor(token);
      return name
        ? `<span class="${name}">${escapeHtml(token.text)}</span>`
        : escapeHtml(token.text);
    })
    .join("");
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
