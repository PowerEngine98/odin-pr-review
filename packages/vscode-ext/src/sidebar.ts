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

import { buildTree, type Folder } from "./tree-model.js";

const STATUS_LABEL: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  phantom: "~",
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

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };

    view.webview.onDidReceiveMessage((message: {
      type: string;
      path?: string;
      edgeId?: string;
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
      }
    });

    this.render();
  }

  setGraph(graph: ChangeGraph | undefined): void {
    this.graph = graph;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.view.webview.html = html(this.graph, dark ? DARK_THEME : LIGHT_THEME);
  }
}

function html(graph: ChangeGraph | undefined, theme: Theme): string {
  const body = graph
    ? renderTree(buildTree(graph.nodes), graph, 0)
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
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}

/* Folders start open: the point of the grouping is to show the shape of the
   project, which a closed tree hides. */
.folder {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px 2px 8px;
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
  width: 12px;
  color: var(--muted);
  flex: 0 0 auto;
  text-align: center;
}
.twisty.none { visibility: hidden; }
.badge {
  width: 13px;
  flex: 0 0 auto;
  text-align: center;
  font-weight: 600;
  font-size: 10px;
}
.status-added .badge    { color: var(--status-added); }
.status-modified .badge { color: var(--status-modified); }
.status-deleted .badge  { color: var(--status-deleted); }
.status-renamed .badge  { color: var(--status-renamed); }
.status-phantom .badge  { color: var(--status-phantom); }

.name { overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
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
  padding: 1px 10px 1px 34px;
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
  folder.addEventListener("click", () => {
    folder.classList.toggle("open");
    const twisty = folder.querySelector(".twisty");
    if (twisty) twisty.textContent = folder.classList.contains("open") ? "▾" : "▸";
  });
});

document.querySelectorAll(".row").forEach((row) => {
  row.addEventListener("click", (event) => {
    // The twisty folds; anywhere else opens the file.
    if (event.target.closest(".twisty")) {
      row.classList.toggle("open");
      const twisty = row.querySelector(".twisty");
      if (twisty) twisty.textContent = row.classList.contains("open") ? "▾" : "▸";
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

function renderTree(folder: Folder, graph: ChangeGraph, depth: number): string {
  const inner =
    folder.folders.map((f) => renderTree(f, graph, depth + 1)).join("") +
    folder.files.map((node) => fileRow(node, graph, depth)).join("");

  if (folder.label === "") return inner;

  const indent = depth * 10;
  return (
    `<div class="folder open" style="padding-left:${8 + indent}px">` +
    `<span class="twisty">▾</span>` +
    `<span class="dir">${escapeHtml(folder.label)}</span>` +
    `</div><div class="folder-body">${inner}</div>`
  );
}

function fileRow(node: FileNode, graph: ChangeGraph, depth = 0): string {
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
    `<div class="row status-${node.status}" data-path="${escapeHtml(node.path)}" ` +
    `style="padding-left:${8 + (depth + 1) * 10}px" ` +
    `title="${escapeHtml(node.path)}">` +
    `<span class="twisty${outgoing.length ? "" : " none"}">▸</span>` +
    `<span class="badge">${STATUS_LABEL[node.status]}</span>` +
    `<span class="name">${escapeHtml(title.name)}</span>` +
    `<span class="counts">${counts}</span>` +
    note +
    `</div>` +
    `<div class="refs">${outgoing.map((e) => refRow(e, graph)).join("")}</div>`
  );
}

function refRow(edge: Edge, graph: ChangeGraph): string {
  const target = graph.nodes.find((n) => n.id === edge.to.nodeId);
  const where = target
    ? `${basename(target.path)}:${edge.to.line}`
    : `line ${edge.to.line}`;

  return (
    `<div class="ref ${edge.change}" data-id="${escapeHtml(edge.id)}" ` +
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
