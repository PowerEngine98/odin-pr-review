import {
  DARK_THEME,
  inlineAvatar,
  inlineAvatars,
  readChecks,
  rerunCheck,
  LIGHT_THEME,
  currentUser,
  deleteComment,
  editComment,
  listReviewComments,
  readPullRequest,
  readMergeStatus,
  updateBranch,
  mergePullRequest,
  type MergeMethod,
  listReviewThreads,
  resolveThread,
  replyToComment,
  setDraft,
  toggleReaction,
  submitReview,
  type ChangeGraph,
  type DraftComment,
  type GraphLayout,
  type ReviewComment,
  type ReviewEvent,
} from "@odin/core";
import { loadHighlighter, type Highlighter } from "@odin/highlight";
import { ODIN_MARK, renderHtml } from "@odin/webview";
import * as vscode from "vscode";
import { SettingsStore } from "./settings.js";

import { baseUri } from "./baseContent.js";
import { waitingPage } from "./loading.js";
import { failedToPost } from "./posting.js";
import { activeTheme } from "./theme.js";
import { destinationFor, diffTargetsFor } from "./navigation.js";
import type { ViewedStore } from "./viewed.js";

/** What the webview sends back when a reviewer follows something. */
interface NavigateMessage {
  type: "navigate";
  payload: {
    toPath: string;
    toLine: number;
    toSide: "base" | "head";
    symbol?: string;
  };
}

interface OpenMessage {
  type: "open";
  payload: { path: string };
}

interface ViewedMessage {
  type: "viewed";
  payload: { path: string; viewed: boolean };
}

interface SubmitMessage {
  type: "submitReview";
  payload: { event: ReviewEvent; body: string; comments: DraftComment[] };
}

interface DraftMessage {
  type: "setDraft";
  payload: { draft: boolean };
}

/** A code block in a comment, asking to be coloured. */
interface HighlightMessage {
  type: "highlight";
  payload: { id: number; lang: string; code: string };
}

/** Acting on one remark in a thread. */
interface RemarkMessage {
  type: "react" | "reply" | "editComment" | "deleteComment";
  payload: { id: number; content?: string; body?: string };
}

/**
 * How the reader likes to read, on its way to being remembered.
 *
 * Opaque on purpose: the page owns what each setting means and what it falls
 * back to. A host that knew the names would have to be taught every new one.
 */
interface SettingsMessage {
  type: "settings";
  payload: Record<string, unknown>;
}

/** Asking the forge how the branch stands, now rather than on a timer. */
interface ChecksMessage {
  type: "refreshChecks";
  payload?: unknown;
}

/** Settling a conversation, or opening it again. */
interface ResolveMessage {
  type: "resolveThread";
  payload: { id: number; resolved: boolean };
}

/**
 * A file the drawing could not fly to.
 *
 * `known` says whether the change contains it at all: hidden behind a filter is
 * a different problem from absent, and only one of them is fixed by rebuilding.
 */
interface MissedMessage {
  type: "focusMissed";
  payload: { path: string; known: boolean };
}

/** Bringing the base branch's commits into this one. */
interface UpdateBranchMessage {
  type: "updateBranch";
  payload: { rebase?: boolean };
}

/** Merging the change, which is the one thing here that cannot be undone. */
interface MergeMessage {
  type: "mergePullRequest";
  payload: { method?: MergeMethod; admin?: boolean };
}

/** Asking the forge to run one check again. */
interface RerunMessage {
  type: "rerunCheck";
  payload: { url?: string; name?: string };
}

/** Which part of the change the reader has opened, or all of it. */
interface PartMessage {
  type: "part";
  payload: { paths: string[] | null };
}

type Message =
  | MissedMessage
  | UpdateBranchMessage
  | MergeMessage
  | ResolveMessage
  | ChecksMessage
  | RerunMessage
  | SettingsMessage
  | PartMessage
  | NavigateMessage
  | OpenMessage
  | ViewedMessage
  | SubmitMessage
  | DraftMessage
  | RemarkMessage
  | HighlightMessage;

export class GraphPanel {
  private static current: GraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private repo: string;
  private graph: ChangeGraph;

  static show(
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
    highlight?: Highlighter,
    alternate?: { layout: GraphLayout; withTests?: GraphLayout },
  ): GraphPanel {
    if (GraphPanel.current) {
      // Kept when none is offered. A hot reload does not reload the grammars —
      // nothing about saving a file changes them — and dropping the ones the
      // panel has would leave the code grey until the next full review.
      if (highlight) GraphPanel.current.highlight = remember(highlight);
      GraphPanel.current.alternate = alternate;
      GraphPanel.current.update(graph, layout, repo, withTests, viewed);
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      return GraphPanel.current;
    }

    // The panel a loader is already running in, if the reviewer has been
    // watching one: the graph belongs in the frame they have been looking at,
    // not in a second one beside it.
    const panel = GraphPanel.claimPending() ?? GraphPanel.frame();

    GraphPanel.current = new GraphPanel(
      panel, graph, layout, repo, withTests, viewed,
      highlight ? remember(highlight) : undefined, alternate,
    );
    return GraphPanel.current;
  }

  /** A webview panel of our own, titled and iconed, with nothing in it yet. */
  private static frame(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      "odin.graph",
      "Odin: Change Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        // Losing pan, zoom and selection every time the reviewer looks at a
        // file would defeat the point of the graph.
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    // The editor tints nothing here, so each theme gets the fill it needs.
    if (GraphPanel.assets) {
      panel.iconPath = {
        light: vscode.Uri.joinPath(GraphPanel.assets, "media", "odin-light.svg"),
        dark: vscode.Uri.joinPath(GraphPanel.assets, "media", "odin-dark.svg"),
      };
    }
    return panel;
  }

  /**
   * Takes over a panel the editor restored after a reload.
   *
   * A reloaded window hands back the frame — same tab, same position in the
   * tab strip, same group — with nothing in it, because the document that was
   * inside it is gone. Adopting it means the reader's tab does not move and
   * does not blink out of existence while the graph is rebuilt; they see the
   * mark and then their change, in the place they left it.
   *
   * Answers whether the frame was taken, because it is not always ours to
   * take. The editor restores a webview when its tab is first looked at, not
   * when the window comes back, so a graph tab left in the background arrives
   * here minutes later — by which time a review asked for in the meantime has
   * a frame of its own, and there is only ever one. Refusing the second frame
   * has to mean closing it: every page from here on goes to the frame that is
   * already held, and one nobody writes to is a black rectangle that stays
   * black for the whole rebuild, which is exactly what the reader is looking
   * at while the corner says references are being resolved.
   */
  static adopt(panel: vscode.WebviewPanel): boolean {
    const held = GraphPanel.current?.panel ?? GraphPanel.pending;
    if (held) {
      panel.dispose();
      // The graph is still open in the frame that has it; the tab that just
      // went away is replaced by the one the reader was actually asking for.
      held.reveal(vscode.ViewColumn.One);
      return false;
    }
    /*
     * A restored frame comes back without the permissions it was created with.
     *
     * The editor serialises the tab, not the webview's settings, so a panel
     * handed back here has whatever the defaults are — scripts off. Everything
     * this extension puts in a frame is a document that runs one: the loader
     * names what it is waiting for from a script, and the graph is an
     * application.
     *
     * Re-stated only when it is actually wrong. Assigning `options` is not a
     * property write — the editor rebuilds the underlying view to apply it — so
     * doing it unconditionally tears down the very frame the next statement
     * writes a page into, and that page lands on something that no longer
     * exists. That is the whole of the missing loader: the trace said the
     * document was written, the editor reported nothing, and the page never
     * ran. The graph, written eight seconds later into a frame that had settled
     * by then, always rendered.
     */
    const scripts = panel.webview.options?.enableScripts;
    if (!scripts) {
      panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    }

    GraphPanel.pending = panel;
    GraphPanel.waiting = true;
    panel.onDidDispose(() => {
      GraphPanel.pending = undefined;
      GraphPanel.waiting = false;
    });
    return true;
  }

  /** The waiting panel, handed over once and forgotten. */
  private static claimPending(): vscode.WebviewPanel | undefined {
    const panel = GraphPanel.pending;
    GraphPanel.pending = undefined;
    GraphPanel.waiting = false;
    return panel;
  }

  /** Frames a waiting page has already been written into. */
  private static painted = new WeakSet<vscode.WebviewPanel>();

  /** Open and empty, waiting on a graph that is still being built. */
  private static pending: vscode.WebviewPanel | undefined;
  /** Whether a loader is currently on screen, in whichever panel. */
  private static waiting = false;

  /**
   * The mark, pulsing, while there is nothing yet to show.
   *
   * Building a graph means reading a diff, resolving every reference in it and
   * laying the result out, which on a large change is several seconds of an
   * editor that looks like it did nothing. The notification says a number; this
   * says it in the place the reviewer is already looking.
   */
  static async showLoading(note: string): Promise<void> {
    let panel = GraphPanel.current?.panel ?? GraphPanel.pending;
    if (!panel) {
      panel = GraphPanel.frame();
      // Closed while it waits, and the wait is over: holding on to a disposed
      // panel would throw the moment the graph tried to move in.
      panel.onDidDispose(() => {
        GraphPanel.pending = undefined;
        GraphPanel.waiting = false;
      });
    }
    if (!GraphPanel.current) GraphPanel.pending = panel;

    /*
     * A wait already on screen is renamed rather than replaced.
     *
     * Restoring a window calls this twice within a fifth of a second — once for
     * the tab coming back and once for the review it starts. Each assignment to
     * `html` throws the document away and loads another, so the second landed
     * on a frame still parsing the first. The page has always been able to be
     * told what it is waiting for; that is what `note` is, and it is how every
     * step of the build already reports itself.
     */
    if (GraphPanel.waiting && GraphPanel.painted.has(panel)) {
      void panel.webview.postMessage({ type: "note", message: note });
      panel.reveal(vscode.ViewColumn.One, true);
      return;
    }

    GraphPanel.waiting = true;
    GraphPanel.painted.add(panel);

    /*
     * Written once, and once only.
     *
     * Two assignments to `html` in quick succession do not produce two pages:
     * the editor tears the frame's document down to install the first and the
     * second arrives before it is standing, and its own bootstrap throws
     * `Found unexpected null` swapping them. What the reader gets after that is
     * an empty frame — for the eight seconds the build takes, and with nothing
     * anywhere saying why.
     *
     * Restoring a window called this twice within a fifth of a second, once for
     * the tab coming back and once for the review it starts, which is exactly
     * the interval that breaks. The second caller now renames the wait through
     * the channel instead, which is what `note` has always been for.
     */
    const page = await waitingHtml(panel.webview, note, true);
    const frame = panel;

    /*
     * Listened for before it is written, because it answers immediately.
     *
     * The page says `waiting` once it is running. Nothing else can tell these
     * two apart from out here: a frame that took the document and a frame that
     * quietly dropped it both look like a successful assignment.
     */
    let arrived = false;
    const heard = frame.webview.onDidReceiveMessage((message: { type?: string }) => {
      // Every message, not only the one hoped for. A frame that talks at all is
      // a frame running a document, and that is the fact worth having: it tells
      // a page that was refused from a page that ran and said the wrong thing.
      if (message?.type !== "waiting") return;
      arrived = true;
      heard.dispose();
    });
    GraphPanel.listening?.dispose();
    GraphPanel.listening = heard;

    frame.webview.html = page;

    // Brought forward without stealing the cursor: the reviewer may well be
    // typing somewhere else while this builds.
    frame.reveal(vscode.ViewColumn.One, true);

    /*
     * Written a second time only when the first was demonstrably lost.
     *
     * Two writes in quick succession are what breaks a frame — the editor tears
     * the document down for the first and the second lands before it is
     * standing. But a frame that never ran the first has no document to tear
     * down, so there is nothing for a second to collide with, and an empty
     * rectangle for the length of a build is the worse of the two failures.
     *
     * The difference between the two is exactly what `waiting` reports, which
     * is why this waits to hear rather than writing again on a timer and hoping.
     */
    /*
     * Written again while it goes unheard.
     *
     * Two writes in quick succession are what breaks a frame — the editor tears
     * the document down for the first and the second lands before it is
     * standing. But a frame that never ran the first has no document to tear
     * down, so there is nothing for a second to collide with, and an empty
     * rectangle for the length of a build is the worse of the two failures. The
     * page's own report is exactly what tells those apart, which is why this
     * waits to hear rather than writing again on a timer and hoping.
     *
     * A handful of attempts rather than one, because what is being waited on is
     * a frame the editor is still assembling and nobody out here is told when
     * that is finished. They stop the moment the page speaks, and they stop
     * altogether once the graph has arrived to replace it.
     */
    const TRIES = [400, 900, 1800];
    for (const at of TRIES) {
      setTimeout(() => {
        if (arrived || !GraphPanel.waiting) return;
        if (GraphPanel.current?.panel !== frame && GraphPanel.pending !== frame) return;
        void (async () => {
          /*
           * A fresh page each time, because the same one is not a write.
           *
           * Assigning `html` a string identical to the one already there is a
           * no-op in the editor — nothing is torn down and nothing is loaded,
           * which is right for a property and useless for a retry. Every page
           * carries its own nonce, so asking for another gives a document that
           * differs and therefore lands.
           */
          const again = await waitingHtml(frame.webview, note, true);
          try {
            frame.webview.html = again;
          } catch {
            /* the frame went away while we waited, which answers the question */
          }
        })();
      }, at);
    }
  }

  /** The one loader page listening for its own arrival, if any is. */
  private static listening: vscode.Disposable | undefined;

  /**
   * Asks the forge what has become of this pull request, and says so.
   *
   * Cheap and narrow on purpose: the state, the draft flag and the review
   * decision, none of which need the graph rebuilt. A change merged overnight
   * has not moved a single line as far as this window is concerned — what has
   * changed is whether reviewing it still means anything.
   */
  async refreshPullRequest(): Promise<void> {
    const known = this.graph.meta.pullRequest;
    const branch = this.graph.meta.headRef;
    if (!known || !branch) return;

    const fresh = await readPullRequest(branch, {
      cwd: this.repo,
      timeoutMs: 8000,
    }).catch(() => undefined);
    if (!fresh) return;

    // The faces are already inlined on the copy in hand, and re-inlining them
    // is a round trip each. Kept unless the forge has news about who is asked.
    const reviewers = fresh.reviewers?.length ? fresh.reviewers : known.reviewers;
    if (reviewers && reviewers !== known.reviewers) {
      // A webview refuses a remote image, so each face travels inside the
      // document. Best-effort: one that will not load leaves a name, which is
      // the part that matters.
      await Promise.all(
        reviewers.map(async (who) => {
          if (!who.avatarUrl || who.avatarUrl.startsWith("data:")) return;
          const data = await inlineAvatar(who.avatarUrl).catch(() => undefined);
          if (data) who.avatarUrl = data;
          else delete who.avatarUrl;
        }),
      );
    }

    const pullRequest = { ...known, ...fresh, ...(reviewers ? { reviewers } : {}) };
    this.graph = {
      ...this.graph,
      meta: { ...this.graph.meta, pullRequest },
    };
    void this.panel.webview.postMessage({ type: "pullRequest", payload: pullRequest });
  }

  /** Everything about this review that the forge could have changed. */
  static async refreshStale(): Promise<void> {
    const panel = GraphPanel.current;
    if (!panel) return;
    await Promise.all([
      panel.refreshPullRequest(),
      panel.readChecks(),
      panel.readMerge(),
    ]);
  }

  /**
   * A row in the list that had nowhere to go.
   *
   * Never nothing. A row that answers a press with silence is the same, to a
   * reader, as one that is broken — and the two reasons it can happen have
   * different answers. A file the change does not contain is one the reading is
   * too old to know about, so the file itself is opened and the reading it
   * would appear in is offered. A file the drawing is merely hiding needs
   * saying so, because the fix is a filter the reader can see.
   */
  private async missed(what: { path: string; known: boolean }): Promise<void> {
    if (what.known) {
      vscode.window.setStatusBarMessage(
        `Odin: ${what.path} is hidden by the filters on this drawing`,
        4000,
      );
      return;
    }

    // Not in this reading at all. Open it, so the press did what a press on a
    // file name most nearly means.
    await this.openDiff(what.path).catch(() => undefined);
    if (this.graph.meta.worktree === true) return;

    const answer = await vscode.window.showInformationMessage(
      `Odin: ${what.path} is not in this reading — it has changed since.`,
      "Show local changes",
    );
    if (answer === "Show local changes") GraphPanel.onLocal?.();
  }

  /**
   * Asked for the live reading of what is on screen.
   *
   * The panel has no idea how a review is built; the extension wires the two
   * together, the way it does for the file list.
   */
  static onLocal: (() => void) | undefined;

  /**
   * How the change stands against being merged, and what may be done about it.
   *
   * Sent alongside the checks because it is the same question asked of the same
   * page: whether this is ready, and if not, what is in the way.
   */
  async readMerge(): Promise<void> {
    const branch = this.graph.meta.headRef;
    if (!branch || !this.graph.meta.pullRequest) return;
    const status = await readMergeStatus(branch, {
      cwd: this.repo,
      timeoutMs: 8000,
    }).catch(() => undefined);
    if (!status) return;
    this.merging = status;
    void this.panel.webview.postMessage({ type: "merging", payload: status });
  }

  /** The last answer, kept so a redraw does not lose it. */
  private merging: unknown;

  /**
   * Brings the base branch in, once the reader has said so twice.
   *
   * Not destructive, but it is a commit on their branch under their name and it
   * goes to the forge — so it is named rather than assumed, and the two ways of
   * doing it are told apart, because a rebase force-pushes and a merge does not.
   */
  private async update(rebase: boolean): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const how = rebase
      ? "Rebase this branch on the latest base? It will be force-pushed."
      : "Merge the latest base into this branch? The merge commit will be yours.";
    const confirmed = await vscode.window.showWarningMessage(
      how,
      { modal: true },
      "Update branch",
    );
    if (confirmed !== "Update branch") return;

    const done = await updateBranch(pull.number, { cwd: this.repo, rebase });
    vscode.window.setStatusBarMessage(
      done
        ? `Odin: #${pull.number} updated from ${this.graph.meta.baseRef}`
        : `Odin: could not update #${pull.number} — it may already be up to date`,
      5000,
    );
    if (done) await Promise.all([this.refreshPullRequest(), this.readMerge()]);
  }

  /**
   * Merges the change, once the reader has said so twice.
   *
   * The confirmation names the change, the method and — when rules are being
   * gone past — says so in as many words. This is the only action in the whole
   * tool that cannot be taken back from here.
   */
  private async merge(how: { method?: MergeMethod; admin?: boolean }): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const method = how.method ?? "squash";
    const named = method === "squash" ? "Squash and merge" : method === "rebase" ? "Rebase and merge" : "Merge";
    const confirmed = await vscode.window.showWarningMessage(
      how.admin
        ? `${named} #${pull.number} without waiting for its requirements to be met? This cannot be undone.`
        : `${named} #${pull.number}? This cannot be undone.`,
      { modal: true },
      named,
    );
    if (confirmed !== named) return;

    const done = await mergePullRequest(pull.number, {
      cwd: this.repo,
      method,
      ...(how.admin ? { admin: true } : {}),
    });
    if (!done) {
      vscode.window.showErrorMessage(
        `Odin: the forge refused to merge #${pull.number}. Its requirements may not be met.`,
      );
      return;
    }
    vscode.window.showInformationMessage(`Odin: #${pull.number} merged.`);
    await Promise.all([this.refreshPullRequest(), this.readMerge()]);
  }

  /** A line of progress, without restarting the animation. */
  static note(message: string): void {
    if (!GraphPanel.waiting) return;
    const panel = GraphPanel.current?.panel ?? GraphPanel.pending;
    void panel?.webview.postMessage({ type: "note", message });
  }

  /**
   * Ends the wait with words instead of a graph.
   *
   * Something has to replace the pulse when the build finds nothing or fails,
   * or the page goes on promising a picture that is not coming.
   */
  static async stopLoading(note: string): Promise<void> {
    if (!GraphPanel.waiting) return;
    const panel = GraphPanel.current?.panel ?? GraphPanel.pending;
    GraphPanel.waiting = false;
    if (!panel) return;
    panel.webview.html = await waitingHtml(panel.webview, note, false);
  }

  /**
   * Says that the picture is being rebuilt, without disturbing it.
   *
   * A message rather than a redraw, and deliberately not the pulsing mark the
   * loader uses: that replaces the document, which is exactly what a reader
   * carrying on reading through a rebuild does not want. This is a word and a
   * spinner in the corner of the bar, and everything underneath goes on
   * working while it is there.
   */
  static setRefreshing(on: boolean, note?: string): void {
    void GraphPanel.current?.panel.webview.postMessage({
      type: "refreshing",
      value: on,
      ...(note ? { note } : {}),
    });
  }

  /** Brings the existing graph back to the front, if there is one. */
  static revealCurrent(): void {
    GraphPanel.current
      ? GraphPanel.current.panel.reveal(vscode.ViewColumn.One)
      : vscode.commands.executeCommand("odin.review");
  }

  /** Opens a file as a diff, for the sidebar's file rows. */
  static async openPath(path: string): Promise<void> {
    await GraphPanel.current?.openDiff(path);
  }

  /**
   * Opens a file at a line, for the editor's own context menu.
   *
   * The menu is the editor's, so this does not come back through the webview
   * channel like the card's own buttons do — the command is handed the object
   * the page put on the element that was clicked, and this turns it into an
   * editor beside the graph.
   */
  static async openAt(where: {
    odinPath?: string;
    odinLine?: number;
    odinSide?: string;
  }): Promise<void> {
    const panel = GraphPanel.current;
    if (!panel || !where?.odinPath || !where.odinLine) return;
    await panel.reveal(
      where.odinPath,
      where.odinLine,
      where.odinSide === "base" ? "base" : "head",
    );
  }

  /** Brings a file's card to the middle of the canvas, without opening it. */
  static focusPath(path: string): void {
    void GraphPanel.current?.panel.webview.postMessage({ type: "focus", path });
  }

  /**
   * Follows a reference from the file list, on the canvas.
   *
   * The graph is the thing being read; a row in the list is a way around it,
   * not a way out of it. Opening an editor here took the whole screen away from
   * the picture — the card's own button is where opening a file is asked for.
   */
  static follow(target: {
    toPath: string;
    toLine: number;
    toSide: "base" | "head";
  }): void {
    if (!target.toPath) return;
    const panel = GraphPanel.current;
    if (!panel) return;
    panel.panel.reveal(vscode.ViewColumn.One, true);
    void panel.panel.webview.postMessage({
      type: "line",
      path: target.toPath,
      line: target.toLine,
      side: target.toSide,
    });
  }

  /**
   * Told when the reader opens one part of the change.
   *
   * The panel has no idea the file list exists; the extension wires the two
   * together, and either can be present without the other.
   */
  static onPart: ((paths: string[] | undefined) => void) | undefined;

  /**
   * Where the reader's own choices are kept between pages.
   *
   * Static because they belong to the reader rather than to any one review: a
   * panel opened tomorrow on a different repository is the same person, with
   * the same opinion about import arrows.
   */
  static settings: SettingsStore | undefined;

  /**
   * Where the extension's own files live.
   *
   * Needed for the tab icon, which is a file on disk rather than anything the
   * page can draw: the tab belongs to the editor, not to the webview.
   */
  static assets: vscode.Uri | undefined;

  private withTests: GraphLayout | undefined;
  /** The same graph in the other diff mode, for the page's own switch. */
  private alternate: { layout: GraphLayout; withTests?: GraphLayout } | undefined;
  private viewed: ViewedStore | undefined;
  private comments: ReviewComment[] = [];
  /** Loaded before the first paint, so the code is never briefly grey. */
  private highlight: Highlighter | undefined;
  /** Who the reader is, so only their own remarks offer edit and delete. */
  private viewer = "";
  /** The reader's own face, for the box they write in. */
  private viewerFace = "";

  /**
   * Keeps the forge's verdict on the branch up to date while the panel is open.
   *
   * Asked again every few seconds: checks finish while a review is being read,
   * and a stale "3/10 running" is worse than no number at all. The timer stops
   * with the panel, and each round is best-effort — a failed ask leaves the
   * last good answer on screen rather than blanking it.
   */
  /**
   * The branch these checks belong to, so they can be asked for again.
   *
   * Held rather than polled. A timer asking the forge every five seconds for
   * the whole life of a panel is a request every five seconds whether or not
   * anybody is looking — for hours, on a review left open over lunch, against a
   * rate limit shared with everything else `gh` does here. What it buys is a
   * tally that moves on its own, which is worth less than it costs: a reader
   * who wants to know whether CI has finished asks.
   */
  private checksOf: { branch: string; repo: string } | undefined;

  /**
   * The last answer, kept rather than only sent.
   *
   * A summary used to live nowhere but in the message that carried it, which
   * meant every redraw of the page lost it — a hot reload, a theme change,
   * comments arriving. Nothing noticed while the forge was being asked every
   * five seconds, because the next poll put it back within moments; the moment
   * that poll went, the panel simply vanished on the first rebuild.
   */
  private checks: unknown;

  /** Asks the forge how the branch stands, and tells the page. */
  async readChecks(): Promise<void> {
    const of = this.checksOf;
    if (!of) return;
    const summary = await readChecks(of.branch, { cwd: of.repo, timeoutMs: 8000 });
    if (!summary) return;
    this.checks = summary;
    void this.panel.webview.postMessage({ type: "checks", payload: summary });
  }

  /** The first answer, and everything needed to ask for another. */
  watchChecks(branch: string, repo: string): void {
    this.checksOf = { branch, repo };
    void this.readChecks();
    void this.readMerge();
  }

  /**
   * Asks the forge to run one check again, and says what came of it.
   *
   * Answered out loud because this is a thing the reader asked for rather than
   * something happening in the background: a button that quietly does nothing
   * is worse than one that says it could not. The forge takes a few seconds to
   * admit a rerun has begun, so the list is asked again after a pause rather
   * than immediately — reading it now would show the same failure and look like
   * the press had been ignored.
   */
  private async rerun(what: { url?: string; name?: string }): Promise<void> {
    const started = await rerunCheck(what.url, {
      cwd: this.repo,
      timeoutMs: 10_000,
    });
    if (!started) {
      void vscode.window.showWarningMessage(
        `Could not ask the forge to run ${what.name ?? "that check"} again.`,
      );
      return;
    }
    void vscode.window.setStatusBarMessage(
      `Odin: asked the forge to run ${what.name ?? "the check"} again`,
      4000,
    );
    setTimeout(() => void this.readChecks(), 4000);
  }

  /** Comments already on the pull request, shown against their lines. */
  setComments(comments: ReviewComment[]): void {
    this.comments = comments;
    // Asked for once, alongside the comments that need it.
    void currentUser({ cwd: this.repo })
      .then(async (login) => {
        if (!login || login === this.viewer) return;
        this.viewer = login;
        // Their own face, inlined like every other face here: a webview will
        // not fetch one, and a composer with everybody's picture but the
        // writer's own looks like it belongs to somebody else.
        this.viewerFace =
          (await inlineAvatar(`https://github.com/${login}.png?size=64`).catch(
            () => undefined,
          )) ?? "";
        this.render(this.layout);
      })
      .catch(() => undefined);
    this.render(this.layout);
  }

  /**
   * Sends a review, once the reviewer has said so a second time.
   *
   * A review is visible to everyone on the pull request and cannot be taken
   * back, so the confirmation names the verdict and counts the remarks rather
   * than asking a bare "are you sure" — the point is to catch a wrong verdict,
   * which a generic prompt does nothing about.
   */
  private async submit(payload: {
    event: ReviewEvent;
    body: string;
    comments: DraftComment[];
  }): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const verdict = {
      APPROVE: "Approve",
      COMMENT: "Comment on",
      REQUEST_CHANGES: "Request changes on",
    }[payload.event];

    const remarks =
      payload.comments.length === 1
        ? "1 line comment"
        : `${payload.comments.length} line comments`;

    const confirmed = await vscode.window.showWarningMessage(
      `${verdict} #${pull.number} with ${remarks}?`,
      { modal: true, detail: "This is posted to the pull request and cannot be undone from here." },
      "Submit review",
    );
    if (confirmed !== "Submit review") return;

    try {
      await submitReview(
        {
          number: pull.number,
          event: payload.event,
          body: payload.body,
          comments: payload.comments,
        },
        { cwd: this.repo },
      );
    } catch (error) {
      vscode.window.showErrorMessage(failedToPost(error, pull.number));
      return;
    }

    vscode.window.showInformationMessage(`Odin: review posted on #${pull.number}.`);
    const posted = await listReviewComments(pull.number, { cwd: this.repo });
    this.comments = await inlineAvatars(posted).catch(() => posted);
    void this.panel.webview.postMessage({
      type: "reviewSubmitted",
      comments: this.comments,
    });

    /*
     * And what the forge now thinks of the change.
     *
     * A review is the one thing here that changes a pull request's standing,
     * and it used to be the one thing that left the bar saying what it said
     * before. The reviewer who just approved is often not on the list at all —
     * they were never formally asked — so their verdict has nowhere to appear
     * until the forge is asked again, and it looks as though nothing was sent.
     */
    await this.refreshPullRequest();
  }

  /**
   * Colours a code block inside a comment.
   *
   * With the same grammars and the same theme the cards use, because a Kotlin
   * snippet in a remark should look like the Kotlin in the file above it. The
   * highlighter is loaded for the languages in the change; one named in a
   * comment that is not among them comes back plain, which is the honest
   * answer rather than a guess at the colours.
   */
  private async colour(request: {
    id: number;
    lang: string;
    code: string;
  }): Promise<void> {
    // A comment may name a language no file in the change is written in — a
    // reviewer quoting shell in a Kotlin review is ordinary — so the grammar is
    // fetched on demand rather than refused.
    const ready = this.highlight
      ? this.highlight.supports(request.lang) ||
        (await this.highlight.ensure(request.lang))
      : false;

    void this.panel.webview.postMessage({
      type: "highlighted",
      id: request.id,
      lines: ready && this.highlight
        ? this.highlight.tokenize(request.lang, request.code)
        : [],
    });
  }

  /**
   * Acting on one remark: an emoji, an answer, a rewrite, a removal.
   *
   * Every one of these changes what the team sees, so the comments are read
   * back from the forge afterwards rather than guessed at locally — the page
   * then shows what is actually there, including anything someone else wrote
   * in the meantime.
   */
  private async remark(message: RemarkMessage): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;
    const { id, content, body } = message.payload;

    // The one that cannot be taken back. The others can be edited or reacted
    // to again; a deleted remark is gone from the conversation for everyone.
    if (message.type === "deleteComment") {
      const confirmed = await vscode.window.showWarningMessage(
        "Delete this comment?",
        { modal: true, detail: "It is removed from the pull request for everyone." },
        "Delete",
      );
      if (confirmed !== "Delete") return;
    }

    try {
      if (message.type === "react" && content) {
        await toggleReaction(id, content, { cwd: this.repo });
      } else if (message.type === "reply" && body) {
        await replyToComment(pull.number, id, body, { cwd: this.repo });
      } else if (message.type === "editComment" && body) {
        await editComment(id, body, { cwd: this.repo });
      } else if (message.type === "deleteComment") {
        await deleteComment(id, { cwd: this.repo });
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const posted = await listReviewComments(pull.number, { cwd: this.repo });
    this.comments = await inlineAvatars(posted).catch(() => posted);
    void this.panel.webview.postMessage({
      type: "comments",
      comments: this.comments,
    });
  }

  /**
   * Takes the pull request out of draft, or puts it back.
   *
   * Leaving draft is the moment the team is asked to look — reviewers are
   * notified and the pull request joins their queue — so it is confirmed the
   * same way a review is, by a prompt that names what is about to happen.
   */
  private async setDraftState(draft: boolean): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const confirmed = await vscode.window.showWarningMessage(
      draft
        ? `Convert #${pull.number} back to a draft?`
        : `Mark #${pull.number} ready for review?`,
      {
        modal: true,
        detail: draft
          ? "It leaves the review queue until it is marked ready again."
          : "Reviewers are notified and the pull request joins their queue.",
      },
      draft ? "Convert to draft" : "Ready for review",
    );
    if (!confirmed) return;

    try {
      await setDraft(pull.number, draft, { cwd: this.repo });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: the state was not changed. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // The bar is drawn from the graph, so the graph is what has to change.
    this.graph = {
      ...this.graph,
      meta: { ...this.graph.meta, pullRequest: { ...pull, draft } },
    };
    vscode.window.showInformationMessage(
      draft
        ? `Odin: #${pull.number} is a draft again.`
        : `Odin: #${pull.number} is ready for review.`,
    );
    this.render(this.layout);
  }

  /**
   * A rebuilt graph, handed to the page that is already showing one.
   *
   * The difference between this and `show` is the difference between the
   * reader keeping their place and losing it. Assigning `webview.html` replaces
   * the document: the editor parses seven megabytes again, the application
   * boots again, seventy-odd cards mount again — and the camera, the scroll and
   * any open thread go with them, because the objects holding them no longer
   * exist. That is several seconds of a page going white and coming back
   * somewhere else, on every save.
   *
   * The page has always been able to take a new model over the wire; nothing
   * was sending it one. So the document is rendered exactly as before — same
   * builder, so there is no second description of a view model to keep in step
   * — and then the model is lifted back out of it and sent on its own. The page
   * assigns it and the components that read it redraw. Everything the reader
   * was doing survives, because nothing was thrown away to apply it.
   *
   * Answers whether the page took it. A frame that has never been given a
   * document has no application running in it to receive a message, so the
   * first paint must always be a document.
   */
  static reload(
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
    alternate?: { layout: GraphLayout; withTests?: GraphLayout },
    /** The cards this build actually redrew, when it knows. */
    redrawn?: readonly string[],
    /** Arrows the page must not draw until the next answer arrives. */
    withdrawn?: readonly string[],
  ): boolean {
    const panel = GraphPanel.current;
    if (!panel || !panel.painted) return false;

    panel.graph = graph;
    panel.repo = repo;
    panel.withTests = withTests;
    panel.viewed = viewed;
    panel.alternate = alternate;
    return panel.send(layout, redrawn, withdrawn);
  }

  /** Reflects a change made in the sidebar. */
  static applyViewed(paths: string[], marked: boolean): void {
    void GraphPanel.current?.panel.webview.postMessage({
      type: "setViewed",
      paths,
      viewed: marked,
    });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
    highlight?: Highlighter,
    alternate?: { layout: GraphLayout; withTests?: GraphLayout },
  ) {
    this.panel = panel;
    this.graph = graph;
    this.repo = repo;
    this.withTests = withTests;
    this.viewed = viewed;
    this.highlight = highlight;
    // Set before the first render: without it the page has one set of card
    // sizes for two ways of reading the change, and the unified cards are
    // capped by numbers measured for split ones.
    this.alternate = alternate;

    this.render(layout);

    this.panel.webview.onDidReceiveMessage(
      (message: Message) => void this.handle(message),
      undefined,
      this.disposables,
    );

    // The graph is themed from the editor, so it has to be redrawn when the
    // editor's theme flips between light and dark.
    // A new theme means new token colours as well as new chrome, and the
    // grammars are loaded against a theme. Re-reading it is a moment's work
    // and the alternative is a page in one theme's colours and another's.
    vscode.window.onDidChangeActiveColorTheme(
      () => void this.recolour(),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private layout!: GraphLayout;

  update(
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
  ): void {
    this.graph = graph;
    this.repo = repo;
    this.withTests = withTests;
    this.viewed = viewed;
    this.render(layout);
  }

  /** Reloads the highlighter against the theme now in use, then redraws. */
  private async recolour(): Promise<void> {
    const languages = this.graph.nodes.map((n) => n.language ?? "plaintext");
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    try {
      const theme = await activeTheme();
      this.highlight = await loadHighlighter(languages, {
        dark,
        ...(theme ? { theme } : {}),
      });
    } catch {
      // Keep whatever colours we had rather than losing them to a bad theme.
    }
    this.render(this.layout);
  }

  /** Whether a document has ever been put in this frame. */
  private painted = false;

  /**
   * The page's own view of the change, without a page around it.
   *
   * Rendered through the same function that builds the document, because the
   * view model is a large and fiddly description of the drawing and a second
   * copy of it here would drift from the first the day either changed. The
   * markup that comes back is thrown away; the model inside it is the point.
   */
  private built(layout: GraphLayout): { html: string; model: PageModel | undefined } {
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    const html = renderHtml(this.graph, layout, {
      theme: dark ? DARK_THEME : LIGHT_THEME,
      csp: { nonce: nonce(), source: this.panel.webview.cspSource },
      ...(this.withTests ? { withTests: this.withTests } : {}),
      ...(this.alternate ? { alternate: this.alternate } : {}),
      ...(this.highlight ? { highlight: this.highlight } : {}),
      comments: this.comments,
      canReview: Boolean(this.graph.meta.pullRequest),
      ...(this.viewer ? { viewer: this.viewer } : {}),
      ...(this.viewerFace ? { viewerFace: this.viewerFace } : {}),
      // Written into the document rather than sent after it, so the page never
      // draws itself once the reader's way and then again the other way.
      ...(GraphPanel.settings?.read()
        ? { settings: GraphPanel.settings.read() }
        : {}),
      // Written into the document, so a redraw does not lose what the forge
      // said. The message channel is for news; this is for what is already
      // known when the page is built.
      ...(this.checks ? { checks: this.checks } : {}),
      ...(this.merging ? { merging: this.merging } : {}),
    });
    return { html, model: modelIn(html) };
  }

  /**
   * Sends the rebuilt change to a page that is already showing one.
   *
   * Two sizes of message, because they disturb different amounts of the page.
   * When the build knows which cards it redrew — and it does whenever the
   * shortcut was taken — only those cards' rows travel, and every other object
   * in the page is left alone. That matters beyond the bytes: the map in the
   * corner is drawn from the cards, and swapping the whole model replaces all
   * of them, so a map that has nothing to say about a comment being edited
   * redraws anyway. Patching the two or three rows that moved leaves it
   * untouched, because nothing it reads has changed.
   *
   * Anything structural — a file joining the change, an arrow appearing —
   * swaps the model whole, which is still far cheaper than a document and
   * still keeps the reader's camera.
   */
  private send(
    layout: GraphLayout,
    redrawn?: readonly string[],
    withdrawn?: readonly string[],
  ): boolean {
    const { model } = this.built(layout);
    if (!model) return false;
    this.layout = layout;

    if (redrawn && redrawn.length > 0) {
      const wanted = new Set(redrawn);
      const nodes = model.nodes.filter((node) => wanted.has(node.id));
      // Every card named has to be in the page for the patch to be complete.
      // One missing means the drawing is not the shape this thinks it is, and
      // a partial patch would leave the reader looking at a mixture.
      if (nodes.length === wanted.size) {
        void this.panel.webview.postMessage({
          type: "rows",
          nodes,
          ...(withdrawn && withdrawn.length > 0 ? { withdraw: withdrawn } : {}),
        });
        return true;
      }
    }

    void this.panel.webview.postMessage({ type: "model", payload: model });
    return true;
  }

  private render(layout: GraphLayout): void {
    this.layout = layout;
    // Whatever was being waited for has arrived.
    GraphPanel.waiting = false;
    // The pull request's title names the tab; the branch pair is in the
    // toolbar, and a tab strip has room for one of them, not both.
    const pull = this.graph.meta.pullRequest;
    this.panel.title = pull
      ? `#${pull.number} ${pull.title}`
      : `Odin: ${this.graph.meta.baseRef} → ${this.graph.meta.headRef}`;

    // Marks made in an earlier session are restored once the page is up.
    const marked = this.viewed?.all() ?? [];
    if (marked.length > 0) {
      setTimeout(() => {
        void this.panel.webview.postMessage({
          type: "setViewed",
          paths: marked,
          viewed: true,
        });
      }, 0);
    }
    this.panel.webview.html = this.built(layout).html;
    this.painted = true;
  }

  /**
   * Opens whatever an arrow points at.
   *
   * The editor is revealed beside the graph and never takes focus: following a
   * reference should show you the destination without evicting you from the
   * picture you are reading.
   */
  private async handle(message: Message): Promise<void> {
    try {
      if (message.type === "part") {
        GraphPanel.onPart?.(message.payload.paths ?? undefined);
        return;
      }
      if (message.type === "navigate") {
        await this.reveal(
          message.payload.toPath,
          message.payload.toLine,
          message.payload.toSide,
        );
        return;
      }
      if (message.type === "open") {
        await this.openDiff(message.payload.path);
        return;
      }
      if (message.type === "focusMissed") {
        await this.missed(message.payload);
        return;
      }
      if (message.type === "updateBranch") {
        await this.update(message.payload.rebase === true);
        return;
      }
      if (message.type === "mergePullRequest") {
        await this.merge(message.payload);
        return;
      }
      if (message.type === "resolveThread") {
        await this.resolve(message.payload);
        return;
      }
      if (message.type === "refreshChecks") {
        await this.readChecks();
        return;
      }
      if (message.type === "rerunCheck") {
        await this.rerun(message.payload);
        return;
      }
      if (message.type === "settings") {
        await GraphPanel.settings?.write(message.payload);
        return;
      }
      if (message.type === "viewed") {
        this.viewed?.set([message.payload.path], message.payload.viewed);
        return;
      }
      if (message.type === "submitReview") {
        await this.submit(message.payload);
        return;
      }
      if (message.type === "setDraft") {
        await this.setDraftState(message.payload.draft);
        return;
      }
      if (message.type === "highlight") {
        await this.colour(message.payload);
        return;
      }
      if (
        message.type === "react" ||
        message.type === "reply" ||
        message.type === "editComment" ||
        message.type === "deleteComment"
      ) {
        await this.remark(message);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async reveal(
    path: string,
    line: number,
    side: "base" | "head",
  ): Promise<void> {
    const destination = destinationFor(this.graph, this.repo, path, line, side);
    const uri =
      destination.kind === "base"
        ? baseUri(this.repo, destination.sha!, destination.path)
        : vscode.Uri.file(destination.path);

    const document = await vscode.workspace.openTextDocument(uri);
    const target = new vscode.Position(Math.max(0, line - 1), 0);

    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      // Its own tab: a preview tab is replaced by whatever is opened next.
      preview: false,
      selection: new vscode.Selection(target, target),
    });
  }

  /**
   * Shows a file the way a reviewer expects: as a diff against the base.
   *
   * Its own tab, kept: a preview tab is replaced by the next thing opened, so
   * reading three files in a row left one. And never focused — the graph is
   * what the reader is in, and the file is opened to be glanced at beside it,
   * with the canvas exactly where they left it.
   */
  private async openDiff(path: string): Promise<void> {
    const targets = diffTargetsFor(this.graph, this.repo, path);
    const options = {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: false,
    };

    if (!targets.base) {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(targets.head!),
      );
      await vscode.window.showTextDocument(document, options);
      return;
    }

    const base = baseUri(this.repo, targets.base.sha, targets.base.path);
    if (!targets.head) {
      // Deleted: there is no head side to compare against, so show what was
      // removed rather than an empty pane.
      const document = await vscode.workspace.openTextDocument(base);
      await vscode.window.showTextDocument(document, options);
      return;
    }

    await vscode.commands.executeCommand(
      "vscode.diff",
      base,
      vscode.Uri.file(targets.head),
      targets.title,
      options,
    );
  }

  dispose(): void {
    GraphPanel.current = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}


/** As much of the page's model as this side has any business knowing. */
interface PageModel {
  nodes: { id: string }[];
}

/** Where the model sits in a rendered document, and where it stops. */
const OPENS = "window.__ODIN__=";
const CLOSES = ";</script>";

/**
 * The model back out of the document it travels in.
 *
 * A redraw needs the model without the page around it, and the only thing that
 * builds one is `renderHtml`, which builds it as part of building a document.
 * Rather than keep a second description of the view model here — a hundred and
 * fifty lines of card geometry, arrow anchors and pull request facts that would
 * be wrong the day either copy changed — the document is rendered and the model
 * lifted out of it.
 *
 * The markup thrown away is a tenth of a second; the document it saves the
 * editor from parsing is seven megabytes. Undefined when the page turns out not
 * to carry one, which sends the caller back to replacing the document — the
 * answer that always works.
 */
function modelIn(html: string): PageModel | undefined {
  const opens = html.indexOf(OPENS);
  if (opens < 0) return undefined;
  const from = opens + OPENS.length;
  const to = html.indexOf(CLOSES, from);
  if (to < 0) return undefined;

  try {
    const model = JSON.parse(html.slice(from, to)) as PageModel;
    return Array.isArray(model?.nodes) ? model : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The same highlighter, answering a question it has already answered for free.
 *
 * Colouring is by far the most expensive part of building a page: running the
 * grammars over every row of every card is a second of a seventy-file change,
 * against a tenth of a second for the markup around it. And on a redraw
 * provoked by a save, all but one of those cards holds byte-for-byte the code
 * it held a moment ago.
 *
 * Keyed on the text rather than on the card, because that is what makes the
 * answer reusable: rows move between cards when a hunk grows, and the same
 * lines come back under a different arrangement. Bounded so that a long session
 * of edits cannot grow it without limit — the oldest entries are dropped, which
 * costs a re-tokenize and nothing else.
 */
function remember(highlight: Highlighter): Highlighter {
  const seen = new Map<string, ReturnType<Highlighter["tokenize"]>>();
  const LIMIT = 4000;

  return {
    supports: (language) => highlight.supports(language),
    ensure: (language) => highlight.ensure(language),
    get missing() {
      return highlight.missing;
    },
    tokenize(language: string, code: string) {
      const key = `${language}\u0000${code}`;
      const had = seen.get(key);
      if (had) return had;

      const lines = highlight.tokenize(language, code);
      if (seen.size >= LIMIT) {
        for (const oldest of seen.keys()) {
          seen.delete(oldest);
          if (seen.size < LIMIT) break;
        }
      }
      seen.set(key, lines);
      return lines;
    },
  };
}

/** The waiting page, with the panel's own policy and the mark inlined. */
async function waitingHtml(
  webview: vscode.Webview,
  note: string,
  pulsing: boolean,
): Promise<string> {
  // The same drawing the map's own loader uses, carried as markup rather than
  // read off disk: this panel is granted no local resources at all.
  return waitingPage({
    mark: ODIN_MARK,
    note,
    pulsing,
    nonce: nonce(),
    cspSource: webview.cspSource,
  });
}

function nonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
