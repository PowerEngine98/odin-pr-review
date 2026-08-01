import {
  cardTitle,
  DARK_THEME,
  LIGHT_THEME,
  type ChangeGraph,
  type Edge,
  type FileNode,
  type FileStatus,
  type PullRequestSummary,
  type Theme,
} from "@odin/core";
import * as vscode from "vscode";

import { ago, buildTree, progressOf, type Folder } from "./tree-model.js";
import type { ViewedStore } from "./viewed.js";

/**
 * The editor's own chevron.
 *
 * Drawn from the codicon path rather than a typographic triangle so the
 * sidebar folds look like every other tree in VS Code. Inlined instead of
 * loading the codicon font, which a webview would have to be granted access to
 * and ship a copy of.
 */
const CHEVRON =
  '<svg class="chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
  '<path fill="currentColor" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/>' +
  "</svg>";

/** The way back to the chooser. The editor's own back arrow, same weight. */
const BACK =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M9.5 3.5L5 8l4.5 4.5"/></svg>';

/**
 * The glyph inside each status box.
 *
 * Follows GitHub Desktop: a small filled square carrying a mark, rather than a
 * bare letter. At sidebar size the shape is what registers — a reader picks out
 * "green plus" long before they read anything.
 */
const STATUS_GLYPH: Record<FileStatus, string> = {
  added: "+",
  modified: "•",
  deleted: "−",
  renamed: "→",
  phantom: "·",
};

/**
 * The change as a list, rendered as a webview rather than a tree.
 *
 * A tree item's description is plain text: the editor gives no way to colour
 * part of a row, and a file decoration can only tint the whole row one colour.
 * That is not enough here — the counts need the diff's green and red, and a
 * file nothing could read needs a warning beside counts that are not warnings.
 * A webview gives up the native tree's affordances to get that, and in exchange
 * the sidebar and the canvas end up drawn from the same palette.
 */
export class ChangeSidebar implements vscode.WebviewViewProvider {
  static readonly viewType = "odin.changes";

  private view: vscode.WebviewView | undefined;
  private graph: ChangeGraph | undefined;
  private pulls: PullRequestSummary[] = [];
  private branch = "";

  constructor(private readonly viewed: ViewedStore) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };

    view.webview.onDidReceiveMessage((message: {
      type: string;
      path?: string;
      edgeId?: string;
      paths?: string[];
      viewed?: boolean;
      number?: number;
    }) => {
      if (message.type === "open" && message.path) {
        void vscode.commands.executeCommand("odin.openFile", message.path);
        return;
      }
      if (message.type === "follow" && message.edgeId) {
        const edge = this.graph?.edges.find((e) => e.id === message.edgeId);
        const target = this.graph?.nodes.find((n) => n.id === edge?.to.nodeId);
        if (!edge || !target) return;
        void vscode.commands.executeCommand("odin.followEdge", {
          toPath: target.path,
          toLine: edge.to.line,
          toSide: edge.to.side,
        });
        return;
      }
      if (message.type === "review") {
        void vscode.commands.executeCommand("odin.review");
        return;
      }
      if (message.type === "viewed" && message.paths) {
        this.viewed.set(message.paths, message.viewed === true);
        return;
      }
      if (message.type === "checkout" && typeof message.number === "number") {
        void vscode.commands.executeCommand("odin.checkout", message.number);
        return;
      }
      // Back to the chooser. The graph is only dropped from this view — the
      // panel keeps the one it is showing, so stepping back to look at the
      // list does not throw away the reading it took to get here.
      if (message.type === "chooser") {
        this.graph = undefined;
        this.render();
      }
    });

    this.render();
  }

  setGraph(graph: ChangeGraph | undefined): void {
    this.graph = graph;
    this.render();
  }

  /** The pull requests to choose from before a graph has been built. */
  setPullRequests(pulls: PullRequestSummary[], branch: string): void {
    this.pulls = pulls;
    this.branch = branch;
    if (!this.graph) this.render();
  }

  /** Reflects a change made elsewhere, without redrawing the list. */
  apply(paths: string[], viewed: boolean): void {
    void this.view?.webview.postMessage({ type: "setViewed", paths, viewed });
  }

  private render(): void {
    if (!this.view) return;
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.view.webview.html = html(
      this.graph,
      dark ? DARK_THEME : LIGHT_THEME,
      this.viewed,
      this.pulls,
      this.branch,
    );
  }
}

function html(
  graph: ChangeGraph | undefined,
  theme: Theme,
  viewed: ViewedStore,
  pulls: PullRequestSummary[] = [],
  branch = "",
): string {
  const body = graph
    ? header(graph, viewed) + renderTree(buildTree(graph.nodes), graph, 0, viewed)
    : picker(pulls, branch);

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
:root {
  --added: ${theme.change.added};
  --removed: ${theme.change.removed};
  --warning: ${theme.warning};
  --muted: ${theme.mutedText};
  --status-added: ${theme.status.added};
  --status-modified: ${theme.status.modified};
  --status-deleted: ${theme.status.deleted};
  --status-renamed: ${theme.status.renamed};
  --status-phantom: ${theme.status.phantom};
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 4px 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
}
/* The right padding is generous on purpose: the reviewed box sits at the end
   of the row, and the editor draws its scrollbar over the last few pixels of
   the view. Without the clearance the box ends up under it. */
.head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  padding: 6px 20px 6px 8px;
}
.head .bar {
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
  overflow: hidden;
}
.head .fill {
  height: 100%;
  background: var(--vscode-progressBar-background, #0a84ff);
  transition: width 160ms ease;
}
.head .stats {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 5px;
  font-size: 0.9em;
  color: var(--muted);
  white-space: nowrap;
}
.head .stats .spacer { flex: 1; }

/* The way back to the list of pull requests. Reviewing one is rarely the whole
   morning, and without this the only route to the next one is a command. */
.head .back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  align-self: center;
  width: 20px;
  height: 18px;
  margin: -2px 0 -2px -2px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground);
  opacity: 0.65;
  cursor: pointer;
}
.head .back:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
}
.head .progress { color: var(--muted); }
.head .progress .done {
  color: var(--vscode-progressBar-background, #0a84ff);
  font-weight: 600;
}
.head .pct { margin-left: 4px; }
.head .added { color: var(--added); }
.head .removed { color: var(--removed); }
.head .authors {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 20px 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}

/* Folders start open: the point of the grouping is to show the shape of the
   project, which a closed tree hides. */
.folder {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 20px 2px 8px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--muted);
  font-size: 0.92em;
}
.folder:hover { background: var(--vscode-list-hoverBackground); }
.folder .dir { overflow: hidden; text-overflow: ellipsis; }
.folder-body { display: block; }
.folder:not(.open) + .folder-body { display: none; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.twisty {
  width: 16px;
  height: 16px;
  color: var(--vscode-icon-foreground, var(--muted));
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.twisty.none { visibility: hidden; }
.twisty .chev { transition: transform 100ms ease; }
.row.open .twisty .chev,
.folder.open .twisty .chev { transform: rotate(90deg); }
/* A filled square with a mark in it, as GitHub Desktop draws them. */
.box {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
}
.status-added .box    { color: var(--status-added); background: color-mix(in srgb, var(--status-added) 16%, transparent); }
.status-modified .box { color: var(--status-modified); background: color-mix(in srgb, var(--status-modified) 16%, transparent); }
.status-deleted .box  { color: var(--status-deleted); background: color-mix(in srgb, var(--status-deleted) 16%, transparent); }
.status-renamed .box  { color: var(--status-renamed); background: color-mix(in srgb, var(--status-renamed) 16%, transparent); }
.status-phantom .box  { color: var(--status-phantom); background: transparent; }

/* Drawn rather than left to the platform: a native checkbox is stark white on
   a dark editor and drags the eye away from the file names, which are the
   point of the list. Colours come from the editor's own tokens, so this
   follows whatever theme is in use. */
input.seen {
  appearance: none;
  -webkit-appearance: none;
  flex: 0 0 auto;
  margin: 0 0 0 10px;
  width: 14px;
  height: 14px;
  border: 1px solid var(--vscode-checkbox-border, var(--vscode-contrastBorder, #6b6b6b));
  background: var(--vscode-checkbox-background, transparent);
  border-radius: 3px;
  position: relative;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 100ms ease, background-color 100ms ease, border-color 100ms ease;
}
.row:hover input.seen { opacity: 1; }

/* Set: filled with the theme's accent and a light tick, the way a selected
   control reads everywhere else, rather than an outline with a mark in it. */
input.seen:checked {
  opacity: 1;
  background: var(--vscode-button-background, #0a84ff);
  border-color: var(--vscode-button-background, #0a84ff);
}
/* Centred by the box model rather than by hand: inset plus auto margins
   places the mark, and rotating about its own centre keeps it there. The
   nudge up and left is optical — a tick's mass sits low and right of its
   bounding box, so squaring it to the box leaves it looking dropped. */
input.seen::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 3.5px;
  height: 7px;
  border: solid var(--vscode-button-foreground, #ffffff);
  border-width: 0 2px 2px 0;
  transform: translate(-0.5px, -1px) rotate(45deg) scale(0);
  transform-origin: center;
  transition: transform 90ms ease;
}
input.seen:checked::after {
  transform: translate(-0.5px, -1px) rotate(45deg) scale(1);
}
.row.seen-marked .name,
.row.seen-marked .counts { opacity: 0.45; }
.row.seen-marked .name { text-decoration: line-through; }

.name { overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
.row .seen { margin-left: auto; }
.status-phantom .name { color: var(--muted); }

.counts { flex: 0 0 auto; font-size: 0.9em; }
.counts .added { color: var(--added); }
.counts .removed { color: var(--removed); }
.counts .untouched { color: var(--muted); }

.note {
  flex: 0 0 auto;
  color: var(--warning);
  font-size: 0.85em;
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-radius: 4px;
  padding: 0 5px;
}

.refs { display: none; }
.row.open + .refs { display: block; }
.ref {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 20px 1px 8px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.95em;
}
.ref:hover { background: var(--vscode-list-hoverBackground); }
.ref .arrow { flex: 0 0 auto; }
.ref.added .arrow { color: var(--added); }
.ref.removed .arrow { color: var(--removed); }
.ref.unchanged .arrow { color: var(--muted); }
.ref .symbol { overflow: hidden; text-overflow: ellipsis; }
.ref .where { color: var(--muted); font-size: 0.9em; }

.empty { color: var(--muted); padding: 8px 12px; }
.empty.small { font-size: 0.9em; line-height: 1.5; }
.empty code { font-family: var(--vscode-editor-font-family); }

/* -------------------------------------------------------- choosing a review */

/* The list scrolls; the action does not. A primary button that walks off the
   bottom of a long list is a button nobody finds. */
html, body { height: 100%; }
.picker {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px 8px 0;
  box-sizing: border-box;
}
.picker .pulls {
  flex: 1 1 auto;
  overflow-y: auto;
  margin: 0 -8px;
  padding: 0 8px;
}
/* With nothing to list there is no scroller to take up the slack, so the last
   line of the explanation does it and the button stays where it always is. */
.picker .empty { flex: 0 0 auto; }
.picker .empty:last-of-type { margin-bottom: auto; }
.picker .footer {
  flex: 0 0 auto;
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}
.filter {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 3px;
  padding: 4px 8px;
  margin-bottom: 8px;
}
.filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.pull {
  padding: 5px 8px 5px 10px;
  border-left: 3px solid transparent;
  cursor: pointer;
  border-radius: 2px;
}
.pull:hover { background: var(--vscode-list-hoverBackground); }
/* The branch that is checked out, marked down the edge rather than by colour
   alone, so it survives being scrolled past at a glance. */
.pull.current {
  border-left-color: var(--vscode-button-background, #0a84ff);
  background: var(--vscode-list-inactiveSelectionBackground);
}
.pull.hidden { display: none; }

.pull .line { display: flex; align-items: baseline; gap: 6px; }
.pull .num { color: var(--muted); flex: 0 0 auto; }
.pull .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pull .meta { margin-top: 2px; font-size: 0.85em; color: var(--muted); }
.pull .author, .pull .when { white-space: nowrap; }

.tag {
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 6px;
  font-size: 0.9em;
}
.tag.open { color: var(--status-added); }
.tag.draft { color: var(--muted); }
.tag.ok { color: var(--status-added); }
.tag.warn { color: var(--warning); }
.tag.muted { color: var(--muted); }
button {
  margin: 0;
  font: inherit;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none;
  border-radius: 3px;
  padding: 4px 10px;
  cursor: pointer;
}
</style></head><body>
${body}
<script>
const vscodeApi = acquireVsCodeApi();

document.querySelectorAll(".folder").forEach((folder) => {
  folder.addEventListener("click", (event) => {
    if (event.target.closest(".seen")) return;
    folder.classList.toggle("open");
  });
});

function markRow(row, marked) {
  const box = row.querySelector(".seen");
  if (box) box.checked = marked;
  row.classList.toggle("seen-marked", marked);
}

/** Keeps the bar in step with the boxes, without redrawing the list. */
function refreshProgress() {
  const boxes = [...document.querySelectorAll(".row .seen")];
  const done = boxes.filter((b) => b.checked).length;
  const pct = boxes.length === 0 ? 0 : Math.round((done / boxes.length) * 100);

  const fill = document.querySelector(".head .fill");
  if (fill) fill.style.width = pct + "%";
  const doneEl = document.querySelector(".head .done");
  if (doneEl) doneEl.textContent = String(done);
  const total = document.querySelector(".head .total");
  if (total) total.textContent = String(boxes.length);
  const pctEl = document.querySelector(".head .pct");
  if (pctEl) pctEl.textContent = pct + "%";
}

function announce(paths, marked) {
  if (paths.length > 0) {
    vscodeApi.postMessage({ type: "viewed", paths: paths, viewed: marked });
  }
}

document.querySelectorAll(".row .seen").forEach((box) => {
  box.addEventListener("click", (event) => event.stopPropagation());
  box.addEventListener("change", () => {
    const row = box.closest(".row");
    markRow(row, box.checked);
    refreshProgress();
    announce([row.dataset.path], box.checked);
  });
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "setViewed") return;
  const wanted = new Set(message.paths || []);
  document.querySelectorAll(".row").forEach((row) => {
    if (wanted.has(row.dataset.path)) markRow(row, message.viewed === true);
  });
  refreshProgress();
});

document.querySelectorAll(".row").forEach((row) => {
  row.addEventListener("click", (event) => {
    // The twisty folds; anywhere else opens the file.
    if (event.target.closest(".twisty")) {
      row.classList.toggle("open");
      return;
    }
    vscodeApi.postMessage({ type: "open", path: row.dataset.path });
  });
});

document.querySelectorAll(".ref").forEach((ref) => {
  ref.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "follow", edgeId: ref.dataset.id });
  });
});

const review = document.getElementById("review");
if (review) review.addEventListener("click", () => vscodeApi.postMessage({ type: "review" }));

const chooser = document.getElementById("chooser");
if (chooser) chooser.addEventListener("click", () => vscodeApi.postMessage({ type: "chooser" }));

document.querySelectorAll(".pull").forEach((pull) => {
  pull.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "checkout", number: Number(pull.dataset.number) });
  });
});

const filter = document.getElementById("filter");
if (filter) {
  filter.addEventListener("input", () => {
    const needle = filter.value.trim().toLowerCase();
    document.querySelectorAll(".pull").forEach((pull) => {
      pull.classList.toggle("hidden", needle !== "" && !pull.dataset.search.includes(needle));
    });
  });
}
</script></body></html>`;
}

/**
 * What the sidebar shows before a graph exists: the open pull requests.
 *
 * Choosing what to review is the step before reviewing it, and doing that in
 * the browser and then finding the branch by hand is the part of the loop that
 * has nothing to do with reading code. Sorted by creation rather than by last
 * activity, because "what is in flight" holds still while "what was touched
 * last" reshuffles whenever anyone comments.
 */
function picker(pulls: PullRequestSummary[], branch: string): string {
  // Same frame either way, so the action sits in the same place whether there
  // are twenty pull requests, one, or none. A button that moves when the list
  // changes length is a button that has to be found again every time.
  const body = pulls.length === 0
    ? `<p class="empty">No open pull requests found.</p>
       <p class="empty small">Odin asks the <code>gh</code> command line, so this
       needs it installed and signed in. You can review the current branch
       regardless.</p>`
    : `<input id="filter" class="filter" type="search" placeholder="Filter pull requests" autocomplete="off">
       <div class="pulls">${pulls.map((pr) => pullRow(pr, branch)).join("")}</div>`;

  return `<div class="picker">
  ${body}
  <div class="footer"><button id="review">Review This Branch</button></div>
</div>`;
}

/** `APPROVED` and friends, said the way a reader would say them. */
const DECISION: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "approved", tone: "ok" },
  CHANGES_REQUESTED: { label: "changes requested", tone: "warn" },
  REVIEW_REQUIRED: { label: "review required", tone: "muted" },
};

function pullRow(pr: PullRequestSummary, branch: string): string {
  const current = pr.branch === branch;
  const decision = pr.reviewDecision ? DECISION[pr.reviewDecision] : undefined;

  return (
    `<div class="pull${current ? " current" : ""}" data-number="${pr.number}" ` +
    `data-search="${escapeHtml(`${pr.number} ${pr.title} ${pr.branch} ${pr.author}`.toLowerCase())}" ` +
    `title="${escapeHtml(pr.branch)}">` +
    `<div class="line">` +
    `<span class="num">#${pr.number}</span>` +
    `<span class="title">${escapeHtml(pr.title)}</span>` +
    `</div>` +
    `<div class="line meta">` +
    (pr.draft ? `<span class="tag draft">draft</span>` : `<span class="tag open">open</span>`) +
    (decision ? `<span class="tag ${decision.tone}">${decision.label}</span>` : "") +
    `<span class="author">${escapeHtml(pr.author)}</span>` +
    `<span class="when">${escapeHtml(ago(pr.createdAt))}</span>` +
    `</div></div>`
  );
}

/**
 * The band at the top of the list: how far through the change you are, how big
 * it is, and who wrote it.
 *
 * Sticky, because progress is the one thing worth seeing while scrolling a long
 * change, and a bar that scrolls away stops answering the question it was put
 * there for.
 */
function header(graph: ChangeGraph, viewed: ViewedStore): string {
  const p = progressOf(graph, (path) => viewed.has(path));

  return `<div class="head">
  <div class="bar"><div class="fill" style="width:${p.percent}%"></div></div>
  <div class="stats">
    <button id="chooser" class="back" title="Choose another pull request">${BACK}</button>
    <span class="progress"><b class="done">${p.done}</b>/<span class="total">${p.total}</span><span class="pct">${p.percent}%</span></span>
    <span class="spacer"></span>
    ${p.additions > 0 ? `<span class="added">+${p.additions}</span>` : ""}
    ${p.deletions > 0 ? `<span class="removed">−${p.deletions}</span>` : ""}
    ${p.authors ? `<span class="authors" title="${escapeHtml(p.authorsFull)}">${escapeHtml(p.authors)}</span>` : ""}
  </div>
</div>`;
}

function renderTree(
  folder: Folder,
  graph: ChangeGraph,
  depth: number,
  viewed: ViewedStore,
): string {
  const inner =
    folder.folders.map((f) => renderTree(f, graph, depth + 1, viewed)).join("") +
    folder.files.map((node) => fileRow(node, graph, depth, viewed)).join("");

  if (folder.label === "") return inner;

  const indent = depth * 10;
  // Folders carry no box of their own. One would have to show a partial state
  // whenever some of its files were read and some were not, and a checkbox
  // that means "some" is harder to read at a glance than the files themselves.
  return (
    `<div class="folder open" style="padding-left:${8 + indent}px">` +
    `<span class="twisty">${CHEVRON}</span>` +
    `<span class="dir">${escapeHtml(folder.label)}</span>` +
    `</div><div class="folder-body">${inner}</div>`
  );
}

function fileRow(
  node: FileNode,
  graph: ChangeGraph,
  depth = 0,
  viewed?: ViewedStore,
): string {
  const title = cardTitle(node);
  const outgoing = graph.edges.filter((e) => e.from.nodeId === node.id);

  const counts =
    node.status === "phantom"
      ? `<span class="untouched">untouched</span>`
      : [
          title.additions ? `<span class="added">${title.additions}</span>` : "",
          title.deletions ? `<span class="removed">${title.deletions}</span>` : "",
        ]
          .filter(Boolean)
          .join(" ");

  const note =
    node.resolution === "unsupported"
      ? `<span class="note" title="Odin has no ${escapeHtml(node.language)} resolver, so this file has no references">no ${escapeHtml(node.language)} resolver</span>`
      : "";

  return (
    `<div class="row status-${node.status}${viewed?.has(node.path) ? " seen-marked" : ""}" ` +
    `data-path="${escapeHtml(node.path)}" ` +
    `style="padding-left:${8 + (depth + 1) * 10}px" ` +
    `title="${escapeHtml(node.path)}">` +
    `<span class="twisty${outgoing.length ? "" : " none"}">${CHEVRON}</span>` +
    `<span class="box">${STATUS_GLYPH[node.status]}</span>` +
    `<span class="name">${escapeHtml(title.name)}</span>` +
    `<span class="counts">${counts}</span>` +
    note +
    // A file the diff never touched has nothing to review, so it gets no box.
    (node.status === "phantom"
      ? ""
      : `<input type="checkbox" class="seen"${viewed?.has(node.path) ? " checked" : ""} ` +
        `title="Mark as reviewed">`) +
    `</div>` +
    // References line up under the file they leave, not at a fixed indent:
    // a fixed one puts a deeply nested file's references out at the margin,
    // where they read as siblings of the folders rather than as its contents.
    `<div class="refs">${outgoing
      .map((e) => refRow(e, graph, depth))
      .join("")}</div>`
  );
}

function refRow(edge: Edge, graph: ChangeGraph, depth = 0): string {
  const target = graph.nodes.find((n) => n.id === edge.to.nodeId);
  const where = target
    ? `${basename(target.path)}:${edge.to.line}`
    : `line ${edge.to.line}`;

  return (
    `<div class="ref ${edge.change}" data-id="${escapeHtml(edge.id)}" ` +
    `style="padding-left:${8 + (depth + 1) * 10 + 22}px" ` +
    `title="${escapeHtml(edge.label ?? "")}">` +
    `<span class="arrow">→</span>` +
    `<span class="symbol">${escapeHtml(edge.to.symbolName ?? "reference")}</span>` +
    `<span class="where">${escapeHtml(where)}</span>` +
    `</div>`
  );
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
