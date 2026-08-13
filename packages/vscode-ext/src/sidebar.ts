import {
  cardTitle,
  DARK_THEME,
  differs,
  LIGHT_THEME,
  type ChangeGraph,
  type Edge,
  type FileNode,
  type LocalBranch,
  type PullRequestSummary,
} from "@odin/core";
import {
  renderSidebar,
  type ChangeView,
  type FileView,
  type FolderView,
  type PickerView,
  type PullView,
  type Query,
  type RefView,
  type SidebarModel,
} from "@odin/webview";
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
 * What the list is asking the forge for.
 *
 * Declared beside the components that draw the question, and re-exported here
 * because the extension asks it: the command that fetches pull requests takes
 * one of these, and it should be the same type the view sends.
 */
export type { Query };

/**
 * The change as a list, rendered as a webview rather than a tree.
 *
 * A tree item's description is plain text: the editor gives no way to colour
 * part of a row, and a file decoration can only tint the whole row one colour.
 * That is not enough here — the counts need the diff's green and red, and a
 * file nothing could read needs a warning beside counts that are not warnings.
 * A webview gives up the native tree's affordances to get that, and in exchange
 * the sidebar and the canvas end up drawn from the same palette.
 *
 * What this class does *not* do any more is build markup. It reads the
 * repository, answers what the view asks of the editor, and hands the view
 * everything it needs as one object; the drawing is the same Svelte components
 * the panel is built from, rendered here to text and woken up over there.
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
  /** Whether the forge answered at all, as opposed to answering with nothing. */
  private reached = true;
  /** Something is being fetched, and the view says so rather than sitting blank. */
  private loading = false;
  /** The part of the change the panel is showing, when it is showing one. */
  private part: Set<string> | undefined;
  /** Whether the list of pull requests is showing over the change list. */
  private chooser = false;
  /**
   * What this machine has for each branch the list mentions.
   *
   * Empty until the first refresh answers, which is the honest default: with
   * nothing known, every row offers the plain checkout it always did rather
   * than a fold that might be lying about what is underneath it.
   */
  private local = new Map<string, LocalBranch>();

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
      where?: string;
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
      // One of the two readings of a change whose local copy has moved. Neither
      // switches branches: reading is not the same act as taking the work over,
      // and a list press should not move a working tree.
      if (message.type === "read" && typeof message.number === "number") {
        void vscode.commands.executeCommand(
          message.where === "origin" ? "odin.readOrigin" : "odin.readLocal",
          message.number,
        );
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
    reached = true,
    local: Map<string, LocalBranch> = new Map(),
  ): void {
    this.local = local;
    this.reached = reached;
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

  /** Everything the view is drawn from, as one object it can be handed. */
  private model(): SidebarModel {
    const graph = this.showing();
    return {
      loading: this.loading,
      ...(graph ? { change: changeView(graph, (path) => this.viewed.has(path)) } : {}),
      picker: pickerView(
        this.pulls,
        this.branch,
        (pr) => this.seen?.movedOn(this.repo, pr.number, pr.headSha) === true,
        this.viewer,
        this.asked,
        this.reached,
        (pr) => this.local.get(pr.branch),
      ),
    };
  }

  private render(): void {
    if (!this.view) return;
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.view.webview.html = renderSidebar(
      this.model(),
      dark ? DARK_THEME : LIGHT_THEME,
    );
  }
}

/**
 * The change, as something the view can draw without asking any more questions.
 *
 * Everything that needs the repository, the graph or this machine is settled
 * here; what crosses into the webview is plain data. What is deliberately *not*
 * settled is the reader's progress — the view counts the marks it is showing,
 * so the bar cannot disagree with the boxes under it.
 */
export function changeView(
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
): ChangeView {
  const totals = progressOf(graph, isViewed);

  return {
    tree: folderView(buildTree(graph.nodes), graph, isViewed),
    totals: {
      additions: totals.additions,
      deletions: totals.deletions,
      authors: totals.authors,
      authorsFull: totals.authorsFull,
    },
  };
}

function folderView(
  folder: Folder,
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
): FolderView {
  return {
    label: folder.label,
    folders: folder.folders.map((child) => folderView(child, graph, isViewed)),
    files: folder.files.map((node) => fileView(node, graph, isViewed)),
  };
}

function fileView(
  node: FileNode,
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
): FileView {
  const title = cardTitle(node);

  return {
    path: node.path,
    name: title.name,
    status: node.status,
    viewed: isViewed(node.path),
    additions: title.additions,
    deletions: title.deletions,
    search: rowSearchText(title),
    // Said out loud rather than left as a file that quietly points nowhere: a
    // file with no arrows otherwise looks like a file that references nothing.
    ...(node.resolution === "unsupported"
      ? { note: `no ${node.language} resolver`, language: node.language }
      : {}),
    refs: graph.edges
      .filter((e) => e.from.nodeId === node.id)
      .map((edge) => refView(edge, graph)),
  };
}

function refView(edge: Edge, graph: ChangeGraph): RefView {
  const target = graph.nodes.find((n) => n.id === edge.to.nodeId);
  const where = target
    ? `${basename(target.path)}:${edge.to.line}`
    : `line ${edge.to.line}`;

  return {
    id: edge.id,
    symbol: edge.to.symbolName ?? "reference",
    where,
    change: edge.change,
    label: edge.label ?? "",
    search: `${edge.to.symbolName ?? ""} ${where} ${edge.label ?? ""}`.toLowerCase(),
  };
}

/**
 * The pull requests to choose from, before a graph has been built.
 *
 * Choosing what to review is the step before reviewing it, and doing that in
 * the browser and then finding the branch by hand is the part of the loop that
 * has nothing to do with reading code. What the forge is waiting on this reader
 * for goes first and under its own heading: everything else is context, and
 * this is the queue.
 */
export function pickerView(
  pulls: PullRequestSummary[],
  branch: string,
  moved: (pr: PullRequestSummary) => boolean,
  viewer = "",
  asked: Query = { state: "open", author: "" },
  reached = true,
  local: (pr: PullRequestSummary) => LocalBranch | undefined = () => undefined,
): PickerView {
  const mine = viewer
    ? pulls.filter((pr) => (pr.requestedFrom ?? []).includes(viewer))
    : [];
  const rest = pulls.filter((pr) => !mine.includes(pr));
  const row = (pr: PullRequestSummary) => pullView(pr, branch, moved(pr), local(pr));

  return {
    mine: mine.map(row),
    everythingElse: rest.map(row),
    asked,
    viewer,
    reached,
  };
}

function pullView(
  pr: PullRequestSummary,
  branch: string,
  moved: boolean,
  local: LocalBranch | undefined,
): PullView {
  /*
   * Whether this machine's copy is a second reading of the change.
   *
   * A change that has already landed has no branch to be ahead of anything, and
   * is read where it lies rather than checked out — whatever a stale local copy
   * of its branch says is not a choice worth offering. Settled here rather than
   * in the row, so the row has one fact to draw from rather than two rules to
   * apply.
   */
  const open = pr.state === undefined || pr.state === "open";
  const drifted = open && differs(local);

  return {
    pr,
    ...(drifted && local ? { local } : {}),
    current: pr.branch === branch,
    moved,
    when: ago(pr.updatedAt ?? pr.createdAt),
    opened: ago(pr.createdAt),
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
