import {
  cardTitle,
  DARK_THEME,
  LIGHT_THEME,
  type ChangeGraph,
  type Edge,
  type FileNode,
  type FileStatus,
  type Theme,
} from "@odin/core";
import * as vscode from "vscode";

import { buildTree, progressOf, type Folder } from "./tree-model.js";
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
      }
    });

    this.render();
  }

  setGraph(graph: ChangeGraph | undefined): void {
    this.graph = graph;
    this.render();
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
    );
  }
}

function html(
  graph: ChangeGraph | undefined,
  theme: Theme,
  viewed: ViewedStore,
): string {
  const body = graph
    ? header(graph, viewed) + renderTree(buildTree(graph.nodes), graph, 0, viewed)
    : `<p class="empty">Review this branch to see its files here.</p>
       <button id="review">Review Pull Request</button>`;

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
   point of the list. Colours come from the editor's own checkbox tokens, so
   this follows whatever theme is in use. */
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
  transition: opacity 100ms ease;
}
.row:hover input.seen,
.folder:hover input.seen,
input.seen:checked { opacity: 1; }

input.seen:checked {
  border-color: var(--vscode-focusBorder, currentColor);
}
input.seen::after {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 1;
  color: var(--vscode-checkbox-foreground, var(--vscode-foreground));
}
input.seen:checked::after { content: "✓"; }
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
button {
  margin: 0 12px;
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
</script></body></html>`;
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
