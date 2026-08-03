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

import {
  ago,
  buildTree,
  partOf,
  progressOf,
  rowSearchText,
  type Folder,
} from "./tree-model.js";
import type { SeenStore } from "./seen.js";
import type { ViewedStore } from "./viewed.js";

/**
 * The editor's own chevron.
 *
 * Drawn from the codicon path rather than a typographic triangle so the
 * sidebar folds look like every other tree in VS Code. Inlined instead of
 * loading the codicon font, which a webview would have to be granted access to
 * and ship a copy of.
 */
/** The funnel the forge query hides behind. */
const FUNNEL =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M1.5 2.5h13a.5.5 0 0 1 .38.83L10 9v4.2a.5.5 0 0 1-.72.45l-2.5-1.25A.5.5 0 0 1 6.5 12V9L1.12 3.33a.5.5 0 0 1 .38-.83Z"/>' +
  "</svg>";

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
const mark = (body: string): string =>
  `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">${body}</svg>`;

const STATUS_GLYPH: Record<FileStatus, string> = {
  // Drawn rather than typed. A glyph is centred on its font's baseline and side
  // bearings, not on its box, so a plus, a bullet and an arrow each sat a
  // different distance from the middle of the same square. These are centred on
  // the box because the box is what they are drawn in.
  added: mark(
    `<rect x="4.2" y="1.4" width="1.6" height="7.2" rx="0.6" fill="currentColor"/>` +
    `<rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor"/>`,
  ),
  modified: mark(`<circle cx="5" cy="5" r="2.4" fill="currentColor"/>`),
  deleted: mark(
    `<rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor"/>`,
  ),
  renamed: mark(
    `<path d="M1.6 5h6M5.4 2.6 8.2 5 5.4 7.4" fill="none" stroke="currentColor" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  phantom: mark(`<circle cx="5" cy="5" r="1.5" fill="currentColor"/>`),
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
  /** Which repository the list belongs to, for looking up what was read. */
  private repo = "";
  /** Who is reading, so the list can lead with what is waiting on them. */
  private viewer = "";
  /** What the list last asked the forge for. */
  private asked: Query = { state: "open", author: "" };
  /** Something is being fetched, and the view says so rather than sitting blank. */
  private loading = false;
  /** The part of the change the panel is showing, when it is showing one. */
  private part: Set<string> | undefined;
  /** Whether the list of pull requests is showing over the change list. */
  private chooser = false;

  constructor(
    private readonly viewed: ViewedStore,
    private readonly seen?: SeenStore,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // Said once at the start too, so the title bar is right before anything
    // has been opened rather than only after the first switch.
    this.announce();
    view.webview.options = { enableScripts: true, localResourceRoots: [] };

    view.webview.onDidReceiveMessage((message: {
      type: string;
      path?: string;
      edgeId?: string;
      paths?: string[];
      viewed?: boolean;
      number?: number;
      state?: string;
      author?: string;
    }) => {
      if (message.type === "open" && message.path) {
        void vscode.commands.executeCommand("odin.openFile", message.path);
        return;
      }
      if (message.type === "focus" && message.path) {
        void vscode.commands.executeCommand("odin.focusFile", message.path);
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
      if (message.type === "ready") {
        void this.view?.webview.postMessage({ type: "loading", value: this.loading });
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
      // A different question for the forge, rather than a search of the answer.
      if (message.type === "asked") {
        this.asked = {
          state: (message.state ?? this.asked.state) as Query["state"],
          author: message.author ?? this.asked.author,
        };
        this.render();
        void vscode.commands.executeCommand("odin.askForPulls", this.asked);
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
        this.showChooser();
      }
    });

    this.render();
  }

  /**
   * Narrows the list to one part of the change.
   *
   * The panel splits a large change into the pieces that do not reach each
   * other, and a list showing forty files while the drawing shows five is two
   * answers to the same question. Undefined means all of it again.
   */
  setPart(paths: string[] | undefined): void {
    this.part = paths ? new Set(paths) : undefined;
    if (this.graph) this.render();
  }

  setGraph(graph: ChangeGraph | undefined): void {
    this.graph = graph;
    // A new graph is a new set of parts, so whatever was open is gone.
    this.part = undefined;
    // A graph that has just arrived is the thing to look at.
    if (graph) this.chooser = false;
    this.announce();
    this.render();
  }

  /**
   * Back to the list of pull requests, from the view's own title bar.
   *
   * The change list is set aside rather than thrown away: stepping over to see
   * what else is open should not cost the reading it took to get here, and the
   * way back is one press.
   */
  showChooser(): void {
    this.chooser = true;
    this.announce();
    this.render();
  }

  /** And back again, to the change list that is still there. */
  showChanges(): void {
    if (!this.graph) return;
    this.chooser = false;
    this.announce();
    this.render();
  }

  /**
   * What the title bar is allowed to offer.
   *
   * Two facts, because the bar needs both: whether there is a change list to
   * go back to at all, and whether the reader is currently looking at it.
   */
  private announce(): void {
    void vscode.commands.executeCommand(
      "setContext", "odin.hasGraph", Boolean(this.graph),
    );
    void vscode.commands.executeCommand(
      "setContext", "odin.onChooser", this.chooser || !this.graph,
    );
  }

  /** The pull requests to choose from before a graph has been built. */
  setPullRequests(
    pulls: PullRequestSummary[],
    branch: string,
    repo = "",
    viewer = "",
  ): void {
    this.pulls = pulls;
    this.branch = branch;
    this.repo = repo;
    this.viewer = viewer;
    if (!this.graph || this.chooser) this.render();
  }

  /**
   * Whether a fetch is in flight.
   *
   * Sent as a message rather than redrawn: the list under it is still the last
   * good one, and replacing the document would lose the reader's scroll and
   * whatever they had typed in the filter. Kept on the instance too, so a view
   * resolved mid-fetch comes up with the bar already running.
   */
  setLoading(on: boolean): void {
    this.loading = on;
    void this.view?.webview.postMessage({ type: "loading", value: on });
  }

  /** Reflects a change made elsewhere, without redrawing the list. */
  apply(paths: string[], viewed: boolean): void {
    void this.view?.webview.postMessage({ type: "setViewed", paths, viewed });
  }

  /**
   * The change as the list should show it: all of it, or one part.
   *
   * An edge is kept only when both of its ends are in the part, so the
   * references under a file are the ones the reader can actually follow from
   * where they are.
   */
  private showing(): ChangeGraph | undefined {
    if (!this.graph || this.chooser) return undefined;
    return partOf(this.graph, this.part ? [...this.part] : undefined);
  }

  private render(): void {
    if (!this.view) return;
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.view.webview.html = html(
      this.loading,
      this.showing(),
      dark ? DARK_THEME : LIGHT_THEME,
      this.viewed,
      this.pulls,
      this.branch,
      (pr) => this.seen?.movedOn(this.repo, pr.number, pr.headSha) === true,
      this.viewer,
      this.asked,
    );
  }
}

function html(
  loading: boolean,
  graph: ChangeGraph | undefined,
  theme: Theme,
  viewed: ViewedStore,
  pulls: PullRequestSummary[] = [],
  branch = "",
  moved: (pr: PullRequestSummary) => boolean = () => false,
  viewer = "",
  asked: Query = { state: "open", author: "" },
): string {
  const body = graph
    ? header(graph, viewed) + renderTree(buildTree(graph.nodes), graph, 0, viewed)
    : picker(pulls, branch, moved, viewer, asked);

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
  /* The forge's own colour for a change that landed. Nothing in the diff
     palette is purple — a renamed file is blue — and "merged" is a state of the
     pull request rather than of a file, so it gets its own. */
  --merged: #a371f7;
}
* { box-sizing: border-box; }

/* Beats any display a class sets, so something the script has hidden stays
   hidden rather than reappearing because a rule further down set a display. */
[hidden] { display: none !important; }

/* Something is running. Indeterminate, because asking the forge how far along
   it is costs another round trip -- the same reason the editor's own
   notifications draw it this way. */
.loading {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  height: 2px;
  overflow: hidden;
  background: transparent;
}
.loading span {
  display: block;
  width: 40%;
  height: 100%;
  background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground));
  animation: odin-progress 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes odin-progress {
  from { transform: translateX(-100%); }
  to { transform: translateX(350%); }
}
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
.head .filter { margin-top: 6px; }
/* Filtered rows are removed from the flow rather than dimmed: a list with the
   misses still in it, greyed, is longer than the list you started with. */
.filtered-out { display: none !important; }

/* The editor's own colour for a search hit in a list, so a match here looks
   like a match anywhere else in the window. */
.hit {
  color: var(--vscode-list-highlightForeground, #2aaaff);
  font-weight: 600;
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
  line-height: 0;
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
/* Dashed, like the canvas draws it: a file the change never touched is here
   because something points at it, and the broken border says the box stands
   for something outside the change rather than part of it. */
.status-phantom .box  {
  color: var(--status-phantom);
  background: transparent;
  border-style: dashed;
}

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
/* The counts line up down the right rather than trailing each filename. Ragged
   against names of every length they were a column that could not be read as
   one; against the edge they can be compared without reading a single name. */
.counts { margin-left: auto; }
.row .seen { margin-left: 10px; }
.status-phantom .name { color: var(--muted); }

.counts { flex: 0 0 auto; font-size: 0.9em; font-variant-numeric: tabular-nums; }
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
/* Pushed to since this reader last opened it. Filled rather than outlined like
   the others: it is the one thing in the row that is news. */
.tag.fresh {
  color: var(--vscode-editor-background);
  background: var(--warning);
  border-color: var(--warning);
  font-weight: 600;
}
.tag.draft { color: var(--muted); }
.tag.ok { color: var(--status-added); }
.tag.warn { color: var(--warning); }
.tag.muted { color: var(--muted); }
.tag.merged { color: var(--merged); }
.tag.closed { color: var(--status-deleted); }
/* The search box and the question behind it, on one line. */
.find { display: flex; align-items: center; gap: 6px; }
.find .filter { flex: 1 1 auto; }
.funnel {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}
.funnel:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
.funnel.on { color: var(--status-modified); border-color: var(--status-modified); }
/* What the list asks the forge for, as opposed to what the box searches. */
.asked {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 2px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  border-radius: 6px;
}
.asked[hidden] { display: none; }
.asked-group {
  font-size: 0.9em;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 2px; }
.chip {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
  border-radius: 999px;
  font: inherit;
  font-size: 0.9em;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}
.chip:hover { color: var(--vscode-foreground); border-color: currentColor; }
/* Chosen, in the state's own colour and outlined — the same pill the row wears
   when it is in that state, so the question and the answer are drawn alike.
   The colours are the forge's: green open, purple merged, red closed. */
.chip.on {
  color: var(--vscode-foreground);
  border-color: currentColor;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.chip.on[data-state="open"]   { color: var(--status-added); }
.chip.on[data-state="merged"] { color: var(--merged); }
.chip.on[data-state="closed"] { color: var(--status-deleted); }
.section.hidden { display: none; }
/* The queue, and then everything else. Quiet enough not to compete with the
   rows under it, present enough to say the list is in two parts. */
.section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 4px;
  font-size: 0.9em;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--muted);
}
.section-head .count {
  padding: 0 5px;
  border-radius: 999px;
  font-size: 0.95em;
  color: var(--vscode-editor-background);
  background: var(--status-modified);
}
.face {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  object-fit: cover;
  margin-right: -2px;
}
.face.letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75em;
  font-weight: 700;
  color: var(--muted);
  background: color-mix(in srgb, currentColor 18%, transparent);
}
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
<div class="loading" ${loading ? "" : "hidden"}><span></span></div>
${body}
<script>
const vscodeApi = acquireVsCodeApi();

window.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "loading") return;
  const bar = document.querySelector(".loading");
  if (bar) bar.hidden = message.value !== true;
});

// A message sent while this document was still loading is dropped, so the
// document asks rather than waiting to be told. Without it a fetch that
// finished during a redraw left the bar running with nothing behind it.
vscodeApi.postMessage({ type: "ready" });

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

  // Nothing read yet is not progress, and "0/43 0%" is three ways of saying
  // the review has not started -- printed where the amount left to do goes.
  const bar = document.querySelector(".head .bar");
  if (bar) bar.hidden = done === 0;
  const progress = document.querySelector(".head .progress");
  if (progress) progress.hidden = done === 0;

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
    // The twisty folds; anywhere else brings the file's card to the middle of
    // the canvas. Opening the file is the card's own button — choosing a file
    // to look at and opening an editor on it are different intentions, and
    // doing both on one click means one of them was never asked for.
    if (event.target.closest(".twisty")) {
      row.classList.toggle("open");
      return;
    }
    vscodeApi.postMessage({ type: "focus", path: row.dataset.path });
  });
});

document.querySelectorAll(".ref").forEach((ref) => {
  ref.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "follow", edgeId: ref.dataset.id });
  });
});

const review = document.getElementById("review");
if (review) review.addEventListener("click", () => vscodeApi.postMessage({ type: "review" }));

document.querySelectorAll(".pull").forEach((pull) => {
  pull.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "checkout", number: Number(pull.dataset.number) });
  });
});

const funnel = document.getElementById("funnel");
const asked = document.querySelector(".asked");
if (funnel && asked) {
  // Re-opened after a redraw, since changing the question rebuilds the list and
  // a panel that shut on every press would be unusable.
  try {
    if (sessionStorage.getItem("odin.asked-open") === "1") {
      asked.hidden = false;
      funnel.classList.add("on");
    }
  } catch (e) {}
  funnel.addEventListener("click", () => {
    asked.hidden = !asked.hidden;
    funnel.classList.toggle("on", !asked.hidden);
    try {
      sessionStorage.setItem("odin.asked-open", asked.hidden ? "0" : "1");
    } catch (e) {}
  });
}

/** Asks the host for a different set of pull requests. */
function ask(change) {
  vscodeApi.postMessage({ type: "asked", ...change });
}

document.querySelectorAll(".asked .chip[data-state]").forEach((chip) => {
  chip.addEventListener("click", () => ask({ state: chip.dataset.state }));
});
document.querySelectorAll(".asked .chip[data-author]").forEach((chip) => {
  chip.addEventListener("click", () => ask({ author: chip.dataset.author }));
});

const author = document.getElementById("author");
if (author) {
  author.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    ask({ author: author.value.trim() });
  });
}

const filter = document.getElementById("filter");
if (filter) {
  filter.addEventListener("input", () => {
    const needle = filter.value.trim().toLowerCase();
    document.querySelectorAll(".pull").forEach((pull) => {
      pull.classList.toggle("hidden", needle !== "" && !pull.dataset.search.includes(needle));
    });
    // A heading over nothing is a heading that has to be read and discounted.
    document.querySelectorAll(".section").forEach((section) => {
      const left = section.querySelectorAll(".pull:not(.hidden)").length;
      section.classList.toggle("hidden", left === 0);
    });
  });
}

/*
 * Filtering the change.
 *
 * A file matches on its own name, a reference on the symbol it resolves to and the
 * file and line it lands in — so searching for a function name finds both the
 * files that call it and the calls themselves. A file whose references match
 * stays, with its list opened: hiding a file whose contents matched would be
 * the opposite of what was asked for.
 *
 * Folders follow their contents. An empty one is not a result.
 */
const treeFilter = document.getElementById("tree-filter");

/**
 * Marks the part of a label that matched.
 *
 * The original text is kept on the element the first time it is touched, so
 * clearing the box restores exactly what was there rather than whatever the
 * last search left behind. Every occurrence is marked, not just the first: a
 * path can carry the same word twice and marking one of them reads as an
 * accident.
 */
function markMatch(el, needle) {
  if (!el) return;
  if (el.dataset.text === undefined) el.dataset.text = el.textContent;
  const text = el.dataset.text;

  if (!needle) { el.textContent = text; return; }

  const lower = text.toLowerCase();
  let out = "";
  let at = 0;
  for (;;) {
    const found = lower.indexOf(needle, at);
    if (found < 0) break;
    out += escapeText(text.slice(at, found)) +
      '<span class="hit">' + escapeText(text.slice(found, found + needle.length)) + "</span>";
    at = found + needle.length;
  }
  if (at === 0) { el.textContent = text; return; }
  el.innerHTML = out + escapeText(text.slice(at));
}

/* The text is a path or a symbol from the repository, not from a person, but
   it is being written as markup — so it is escaped anyway. */
function escapeText(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

if (treeFilter) {
  treeFilter.addEventListener("input", () => {
    const needle = treeFilter.value.trim().toLowerCase();
    const searching = needle !== "";

    document.querySelectorAll(".row").forEach((row) => {
      const refs = row.nextElementSibling;
      const matchingRefs = refs && refs.classList.contains("refs")
        ? [...refs.querySelectorAll(".ref")].filter(
            (ref) => !searching || ref.dataset.search.includes(needle),
          )
        : [];

      const self = !searching || row.dataset.search.includes(needle);
      const keep = self || matchingRefs.length > 0;
      row.classList.toggle("filtered-out", !keep);
      markMatch(row.querySelector(".name"), searching ? needle : "");

      if (refs && refs.classList.contains("refs")) {
        refs.querySelectorAll(".ref").forEach((ref) => {
          // With the file itself matching, its references are all shown; it is
          // the file that was asked for, not a subset of what it points at.
          const show = !searching || self || ref.dataset.search.includes(needle);
          ref.classList.toggle("filtered-out", !show);
          markMatch(ref.querySelector(".symbol"), searching ? needle : "");
          markMatch(ref.querySelector(".where"), searching ? needle : "");
        });
        // Opened while searching so a match inside is not hidden behind a
        // twisty the reader would have to guess at.
        row.classList.toggle("open", searching ? !self && matchingRefs.length > 0 : row.classList.contains("open"));
      }
    });

    // A folder is worth showing when something under it is.
    const folders = [...document.querySelectorAll(".folder")].reverse();
    folders.forEach((folder) => {
      const body = folder.nextElementSibling;
      const alive = body
        ? body.querySelector(".row:not(.filtered-out), .folder:not(.filtered-out)")
        : null;
      folder.classList.toggle("filtered-out", searching && !alive);
      if (body) body.classList.toggle("filtered-out", searching && !alive);
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
export function picker(
  pulls: PullRequestSummary[],
  branch: string,
  moved: (pr: PullRequestSummary) => boolean,
  viewer = "",
  asked: Query = { state: "open", author: "" },
): string {
  // What the forge is waiting on this reader for, first and under its own
  // heading. Everything else is context; this is the queue.
  const mine = viewer
    ? pulls.filter((pr) => (pr.requestedFrom ?? []).includes(viewer))
    : [];
  const rest = pulls.filter((pr) => !mine.includes(pr));
  const rows = (list: PullRequestSummary[]) =>
    list.map((pr) => pullRow(pr, branch, moved(pr))).join("");
  // Same frame either way, so the action sits in the same place whether there
  // are twenty pull requests, one, or none. A button that moves when the list
  // changes length is a button that has to be found again every time.
  //
  // The question stays on screen when the answer is empty, which is exactly
  // when it needs changing: "nothing is open" is the moment a reader wants to
  // ask for what was merged.
  const find =
    `<div class="find">` +
    `<input id="filter" class="filter" type="search" ` +
    `placeholder="Filter pull requests" autocomplete="off">` +
    `<button id="funnel" class="funnel" title="What the list asks the forge for" ` +
    `aria-label="Filters">${FUNNEL}</button>` +
    `</div>` +
    filterPanel(asked, viewer);

  const found = pulls.length === 0
    ? `<p class="empty">No ${asked.state === "all" ? "" : `${asked.state} `}pull ` +
      `requests${asked.author ? ` by ${escapeHtml(asked.author)}` : ""} found.</p>` +
      `<p class="empty small">Odin asks the <code>gh</code> command line, so this ` +
      `needs it installed and signed in. You can review the current branch ` +
      `regardless.</p>`
    : mine.length > 0
      ? `<div class="section"><div class="section-head">Waiting on you` +
        `<span class="count">${mine.length}</span></div>` +
        `<div class="pulls">${rows(mine)}</div></div>` +
        `<div class="section"><div class="section-head">Everything else</div>` +
        `<div class="pulls">${rows(rest)}</div></div>`
      : `<div class="pulls">${rows(rest)}</div>`;

  const body = find + found;

  return `<div class="picker">
  ${body}
  <div class="footer"><button id="review">Review This Branch</button></div>
</div>`;
}

/**
 * The author, as a picture.
 *
 * A face is recognised before a name is read, and the question this list
 * answers most often is "whose is this". Inlined by the caller, because a
 * webview will not fetch a remote image; a login with no picture keeps its
 * initial, which is still faster to scan than a word.
 */
function face(pr: PullRequestSummary): string {
  const who = escapeHtml(pr.author || "?");
  if (pr.avatarUrl) {
    return `<img class="face" src="${escapeHtml(pr.avatarUrl)}" alt="${who}">`;
  }
  return `<span class="face letter">${escapeHtml((pr.author || "?").slice(0, 1).toUpperCase())}</span>`;
}

/**
 * What the list is asking the forge for.
 *
 * Separate from the text box above it, which searches what has already
 * arrived. This changes the question: a merged change is not in the answer to
 * "what is open", however hard the box is searched.
 */
export interface Query {
  state: "open" | "merged" | "closed" | "all";
  /** A login, or empty for anyone. */
  author: string;
}

const STATES: { value: Query["state"]; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function filterPanel(asked: Query, viewer: string): string {
  const chip = (state: { value: Query["state"]; label: string }) =>
    `<button class="chip${asked.state === state.value ? " on" : ""}" ` +
    `data-state="${state.value}">${state.label}</button>`;

  return `<div class="asked" hidden>
  <div class="asked-group">State</div>
  <div class="chips">${STATES.map(chip).join("")}</div>
  <div class="asked-group">Author</div>
  <div class="chips">` +
    `<button class="chip${asked.author === "" ? " on" : ""}" data-author="">Anyone</button>` +
    (viewer
      ? `<button class="chip${asked.author === viewer ? " on" : ""}" ` +
        `data-author="${escapeHtml(viewer)}">Mine</button>`
      : "") +
    `</div>
  <input id="author" class="filter" type="search" autocomplete="off"
         placeholder="Any other login" value="${escapeHtml(
           asked.author && asked.author !== viewer ? asked.author : "",
         )}">
</div>`;
}

/** `APPROVED` and friends, said the way a reader would say them. */
const DECISION: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "approved", tone: "ok" },
  CHANGES_REQUESTED: { label: "changes requested", tone: "warn" },
  REVIEW_REQUIRED: { label: "review required", tone: "muted" },
};

function pullRow(
  pr: PullRequestSummary,
  branch: string,
  moved: boolean,
): string {
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
    (pr.state === "merged"
      ? `<span class="tag merged">merged</span>`
      : pr.state === "closed"
        ? `<span class="tag closed">closed</span>`
        : pr.draft
          ? `<span class="tag draft">draft</span>`
          : `<span class="tag open">open</span>`) +
    (decision ? `<span class="tag ${decision.tone}">${decision.label}</span>` : "") +
    // Pushed to since this reviewer last opened it. The forge goes on showing
    // the verdict they left on a commit that is no longer the head, and this is
    // the only thing in the list that says so.
    (moved ? `<span class="tag fresh">new commits</span>` : "") +
    face(pr) +
    `<span class="author">${escapeHtml(pr.author)}</span>` +
    // When it last moved, not when it was opened: the list is ordered by
    // activity, and a column that disagreed with the order would read as a
    // sorting bug.
    `<span class="when" title="${escapeHtml(`opened ${ago(pr.createdAt)}`)}">` +
    `${escapeHtml(ago(pr.updatedAt ?? pr.createdAt))}</span>` +
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
  <div class="bar"${p.done === 0 ? " hidden" : ""}><div class="fill" style="width:${p.percent}%"></div></div>
  <div class="stats">
    <span class="progress"${p.done === 0 ? " hidden" : ""}><b class="done">${p.done}</b>/<span class="total">${p.total}</span><span class="pct">${p.percent}%</span></span>
    <span class="spacer"></span>
    ${p.additions > 0 ? `<span class="added">+${p.additions}</span>` : ""}
    ${p.deletions > 0 ? `<span class="removed">−${p.deletions}</span>` : ""}
    ${p.authors ? `<span class="authors" title="${escapeHtml(p.authorsFull)}">${escapeHtml(p.authors)}</span>` : ""}
  </div>
  <input id="tree-filter" class="filter" type="search" autocomplete="off"
         placeholder="Filter files and references">
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
    // The name on the row, and the name it had before a rename -- not the whole
    // path. Searching the path meant a word appearing in a directory dragged in
    // every file beneath it: "page" under pages/app returned the entire tree,
    // most of it with no "page" anywhere a reader could see.
    `data-search="${escapeHtml(rowSearchText(title))}" ` +
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
    `data-search="${escapeHtml(`${edge.to.symbolName ?? ""} ${where} ${edge.label ?? ""}`.toLowerCase())}" ` +
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
