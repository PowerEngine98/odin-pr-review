import {
  DARK_THEME,
  inlineAvatar,
  inlineAvatars,
  readChecks,
  rerunCheck,
  discoverAgents,
  forgeEnv,
  LIGHT_THEME,
  currentUser,
  deleteComment,
  editComment,
  listReviewComments,
  listReviewThreads,
  readPullRequest,
  readMergeStatus,
  updateBranch,
  mergePullRequest,
  type Agency,
  type MergeMethod,
  resolveThread,
  stampThreads,
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
import { rmSync } from "node:fs";
import * as vscode from "vscode";
import { SettingsStore } from "./settings.js";

import { baseUri } from "./baseContent.js";
import { imageFolder, keepPasted, readImage, withImages } from "./images.js";
import { waitingPage } from "./loading.js";
import { failedToPost } from "./posting.js";
import { activeTheme } from "./theme.js";
import { keyOf } from "./session.js";
import { PairingSession, PLACEHOLDER } from "./pairing.js";
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

/**
 * A message from the reader to whichever agent is free.
 *
 * Carries where it was written as well as what was written: an agent is being
 * asked about a passage, and a prompt with no file and no lines in it is a
 * question about the repository in general.
 */
interface AskMessage {
  type: "askAgents";
  payload: {
    /** Absent for a question about the change rather than about a line. */
    path?: string;
    line?: number;
    startLine?: number;
    side?: "LEFT" | "RIGHT";
    body: string;
    inReplyTo?: number;
    /** The agent whose terminal it was written in, if it was written in one. */
    to?: string;
    /** Pictures pasted into the box, as data URIs the page could draw. */
    images?: { name?: string; data: string }[];
  };
}

/**
 * Asking for everything an agent has printed, not merely what comes next.
 *
 * A terminal opened halfway through a turn, or after a window reload, would
 * otherwise start at whatever happens to be printed after it opened — the
 * session it exists to show having already scrolled past.
 */
interface TranscriptMessage {
  type: "agentTranscript";
  payload: { agent: string };
}

/**
 * Something the page wants on the clipboard.
 *
 * Through the editor rather than the page's own clipboard, which webviews
 * refuse often enough — and silently enough — that a button doing nothing would
 * be the common case rather than the odd one.
 */
interface CopyMessage {
  type: "copyText";
  payload: { text: string; said?: string };
}

/** Ending one agent's turn, because the reader asked for it to end. */
interface StopMessage {
  type: "stopAgent";
  payload: { agent: string };
}

/**
 * A picture named in a remark, wanted as something the page can draw.
 *
 * The page cannot open a file on this machine, so it asks. What comes back is
 * the bytes or nothing at all — see `readImage` for how far that door opens.
 */
interface ShowImageMessage {
  type: "showImage";
  payload: { path: string };
}

/** Taking a message back before any agent has started on it. */
interface CancelMessage {
  type: "cancelAsk";
  payload: { id: number | string };
}

/** Asking which coding agents this machine can actually run. */
interface DiscoverMessage {
  type: "discoverAgents";
  /** `again` when the reader pressed refresh, rather than a page asking anew. */
  payload?: { again?: boolean };
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
  | ApprovalMessage
  | LocalRemarkMessage
  | ConversationMessage
  | ForgetMessage
  | TranscriptMessage
  | StopMessage
  | CancelMessage
  | ShowImageMessage
  | CopyMessage
  | AskMessage
  | DiscoverMessage
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

/**
 * What makes two readings the same reading.
 *
 * The repository, what the change is measured against, what it is a change to,
 * and whether it is being read from the files on disk. The last is not
 * pedantry: the same branch read live and read as committed are different
 * pictures — one follows the reader's typing and the other does not — and a
 * reviewer who asks for both means to have both.
 */
function readingKey(graph: ChangeGraph, repo: string): string {
  return keyOf({
    repo,
    ...(graph.meta.baseRef ? { baseRef: graph.meta.baseRef } : {}),
    ...(graph.meta.headRef ? { headRef: graph.meta.headRef } : {}),
    ...(graph.meta.worktree === true ? { worktree: true } : {}),
  });
}

export class GraphPanel {
  /**
   * Every reading on screen, by what it is a reading of.
   *
   * There used to be one panel and one only. That was not a simplification so
   * much as a consequence of opening a change meaning checking it out: two
   * readings needed two working trees, and a working tree cannot be in two
   * states at once. Reading no longer moves anything, so the limit has nothing
   * left holding it up — and a reviewer comparing two changes, or reading one
   * while their own is building, wants both.
   */
  private static readonly open = new Map<string, GraphPanel>();

  /**
   * The one the reader is looking at.
   *
   * Everything that acts on "the graph" — opening a file from the list, flying
   * to a reference, saying a rebuild has started — means this one. Followed
   * from the editor rather than remembered on our side, because which tab has
   * focus is the editor's fact and it changes without asking us.
   */
  private static active: GraphPanel | undefined;

  /** What this panel is a reading of, and what makes it that one. */
  private key = "";

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
    /**
     * Which reading this is, as the caller asked for it.
     *
     * A change is drawn in two passes — the cards as soon as the diff is read,
     * the arrows once they are resolved — and both come here. Which tab a pass
     * lands in was worked out from the graph it carries, and a graph says what
     * its refs turned out to be rather than what was asked for. Those are not
     * the same thing while a build is happening: opening a remote pull request
     * fetches, and may check the branch out or add a worktree, in between the
     * two passes, so the second pass named the reading differently, found no
     * tab under that name, and opened another.
     *
     * The caller holds the one name that does not move — it made the request
     * both passes are built from — so it says, and the graph is only asked when
     * nobody has. That is the whole of the fix, and it is a fix for the class
     * rather than for a field: head, base, and whatever is re-derived next.
     */
    where?: string,
  ): GraphPanel {
    const key = where ?? readingKey(graph, repo);
    const already = GraphPanel.open.get(key);
    if (already) {
      // Kept when none is offered. A hot reload does not reload the grammars —
      // nothing about saving a file changes them — and dropping the ones the
      // panel has would leave the code grey until the next full review.
      if (highlight) already.highlight = remember(highlight);
      already.alternate = alternate;
      already.update(graph, layout, repo, withTests, viewed);
      already.panel.reveal(vscode.ViewColumn.One);
      GraphPanel.active = already;
      GraphPanel.closePromoted(key);
      return already;
    }

    // The panel a loader is already running in, if the reviewer has been
    // watching one: the graph belongs in the frame they have been looking at,
    // not in a second one beside it.
    const panel = GraphPanel.claimPending() ?? GraphPanel.frame();

    const made = new GraphPanel(
      panel, graph, layout, repo, withTests, viewed,
      highlight ? remember(highlight) : undefined, alternate,
    );
    made.key = key;
    GraphPanel.open.set(key, made);
    GraphPanel.active = made;
    GraphPanel.closePromoted(key);
    return made;
  }

  /**
   * The tab a promotion replaced, closed now its replacement is drawn.
   *
   * After rather than before: closing the old one first would leave the reader
   * looking at nothing for the seconds a build takes, and at nothing at all if
   * it failed.
   */
  private static closePromoted(arrived: string): void {
    const going = GraphPanel.promoting;
    GraphPanel.promoting = undefined;
    if (!going || going === arrived) return;
    GraphPanel.open.get(going)?.dispose();
  }

  /** Every reading on screen, oldest first. */
  static readings(): GraphPanel[] {
    return [...GraphPanel.open.values()];
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
        /*
         * The extension's own folder, and nothing else.
         *
         * Empty until there was something to fetch — the page inlines
         * everything it draws with. The diagram renderer is the exception: it
         * is three and a half megabytes that most readings never use, so it
         * ships as a file beside the extension and is fetched the first time an
         * agent actually draws something.
         */
        localResourceRoots: GraphPanel.assets ? [GraphPanel.assets] : [],
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
  static async adopt(panel: vscode.WebviewPanel, key?: string): Promise<boolean> {
    /*
     * With a key, a frame can be told apart from every other frame.
     *
     * That is the whole difference between bringing one reading back and
     * bringing all of them back. Without one there is no way to know whether
     * the frame being handed over is the change already on screen or a second
     * change beside it, so the only safe answer was to hold one and close the
     * rest — which is what a reader with two tabs open experienced as one of
     * them silently not coming back.
     */
    if (key) {
      const already = GraphPanel.open.get(key);
      if (already) {
        // That reading survived — the reader is looking at it. This frame is a
        // second tab onto the same picture, which is not a thing to have.
        panel.dispose();
        already.panel.reveal(vscode.ViewColumn.One);
        return false;
      }
      // Queued, or being rebuilt right now. Either way a frame for it is
      // already held, and this one is a second tab onto the same picture.
      if (GraphPanel.restored.has(key) || GraphPanel.restoring === key) {
        panel.dispose();
        return false;
      }
    } else {
      const held = GraphPanel.pending ?? GraphPanel.active?.panel;
      if (held) {
        panel.dispose();
        // The graph is still open in the frame that has it; the tab that just
        // went away is replaced by the one the reader was actually asking for.
        held.reveal(vscode.ViewColumn.One);
        return false;
      }
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
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: GraphPanel.assets ? [GraphPanel.assets] : [],
      };
    }

    if (!key) {
      GraphPanel.pending = panel;
      GraphPanel.waiting = true;
      panel.onDidDispose(() => {
        GraphPanel.pending = undefined;
        GraphPanel.waiting = false;
      });
      return true;
    }

    /*
     * Queued, and marked as waiting straight away.
     *
     * The editor hands every restored tab back at once, and the graphs behind
     * them cannot be built at once: each is a diff read and a repository walked,
     * against one working copy. So they are built in turn — but a frame whose
     * turn has not come is still a tab the reader can click on, and an empty
     * one is a black rectangle with nothing saying why. Each gets the mark now
     * and the graph when the queue reaches it.
     */
    GraphPanel.restored.set(key, panel);
    panel.onDidDispose(() => {
      if (GraphPanel.restored.get(key) === panel) GraphPanel.restored.delete(key);
      if (GraphPanel.pending === panel) {
        GraphPanel.pending = undefined;
        GraphPanel.waiting = false;
      }
    });
    GraphPanel.painted.add(panel);
    await GraphPanel.paint(panel, "Reopening");
    return true;
  }

  /**
   * The reading whose turn it is, moved from the queue into the one slot
   * everything about a build in progress already aims at.
   *
   * Answers whether there was a frame to move, because the reader may have
   * closed that tab in the seconds since the window came back.
   */
  static beginRestore(key: string): boolean {
    const panel = GraphPanel.restored.get(key);
    if (!panel) return false;
    GraphPanel.restored.delete(key);
    GraphPanel.restoring = key;
    GraphPanel.pending = panel;
    GraphPanel.waiting = true;
    return true;
  }

  /**
   * That reading's turn is over, however it went.
   *
   * Held for the length of the rebuild so a duplicate frame arriving mid-build
   * can be told from a reading nobody has yet, and released afterwards so a
   * build that failed does not lock the reader out of asking again.
   */
  static endRestore(key: string): void {
    if (GraphPanel.restoring === key) GraphPanel.restoring = undefined;
  }

  /** The reading whose graph is being rebuilt into a restored frame. */
  private static restoring: string | undefined;

  /** Frames handed back by a reload, each waiting on the reading it held. */
  private static readonly restored = new Map<string, vscode.WebviewPanel>();

  /** The waiting panel, handed over once and forgotten. */
  private static claimPending(): vscode.WebviewPanel | undefined {
    const panel = GraphPanel.pending;
    GraphPanel.pending = undefined;
    GraphPanel.waiting = false;
    return panel;
  }

  /** Frames a waiting page has already been written into. */
  private static painted = new WeakSet<vscode.WebviewPanel>();

  /**
   * Frames that now hold something other than a loader.
   *
   * A waiting page is written again while it goes unheard, and the only thing
   * that should stop it is the frame no longer waiting on anything. That used
   * to be read off "is this the one panel being built" — true of exactly one
   * frame, which was fine when there was exactly one.
   */
  private static readonly settled = new WeakSet<vscode.WebviewPanel>();

  /** Open and empty, waiting on a graph that is still being built. */
  private static pending: vscode.WebviewPanel | undefined;
  /** Whether a loader is currently on screen, in whichever panel. */
  private static waiting = false;

  /**
   * The frame everything about the build in progress is aimed at.
   *
   * The waiting frame first, and only then whatever the reader is looking at.
   * The other way round was right while a window held one reading — a panel
   * pending and a panel showing were never both true. Restoring several makes
   * them both true constantly: the first graph is up and on screen while the
   * second is still being built, and progress about the second belongs in the
   * frame that is waiting for it, not on top of the one already finished.
   */
  private static target(): vscode.WebviewPanel | undefined {
    return GraphPanel.pending ?? GraphPanel.active?.panel;
  }

  /**
   * The mark, pulsing, while there is nothing yet to show.
   *
   * Building a graph means reading a diff, resolving every reference in it and
   * laying the result out, which on a large change is several seconds of an
   * editor that looks like it did nothing. The notification says a number; this
   * says it in the place the reviewer is already looking.
   */
  static async showLoading(note: string, where?: string): Promise<void> {
    /*
     * The frame this reading is already in, if it has one.
     *
     * Without this the loader goes to whichever panel is in front, which is not
     * where the change being built lives. The reader turns from one review to
     * another, something starts a build of the first, and the second's document
     * is replaced by a pulsing mark: a change that had loaded minutes ago
     * sitting on "Laying out…" for a layout that finished long since — and
     * nothing ever comes to take it away, because the graph it is waiting for
     * belongs to another tab.
     */
    const own = where ? GraphPanel.open.get(where) : undefined;
    if (own) {
      /*
       * Already showing its graph, so it is told rather than replaced. Writing
       * a waiting document over a drawn one throws the drawing away — the
       * reader's cards, their camera, their open conversation — to say
       * something a line in the corner of the bar says without taking anything.
       */
      if (own.painted) {
        void own.panel.webview.postMessage({ type: "note", message: note });
        return;
      }
      GraphPanel.pending = own.panel;
    }

    /*
     * A reading with no frame of its own takes a fresh one, never the one in
     * front.
     *
     * This is the other half of the same fault, and the one a reader meets by
     * following the tool's own offer: reading the forge's copy of a change,
     * pressing "show local changes", and turning back afterwards to find the
     * first tab pulsing forever. The live reading had no frame, so the loader
     * took the frame that was there — the committed reading's, drawing and all
     * — and when the live graph arrived it went into a frame of its own. What
     * was left behind was a tab waiting for a graph that had already been
     * delivered somewhere else.
     */
    const front = GraphPanel.target();
    const taken =
      where !== undefined &&
      !own &&
      front !== undefined &&
      GraphPanel.readings().some((held) => held.panel === front && held.painted);

    let panel = own?.panel ?? (taken ? undefined : front);
    if (!panel) {
      panel = GraphPanel.frame();
      // Closed while it waits, and the wait is over: holding on to a disposed
      // panel would throw the moment the graph tried to move in.
      panel.onDidDispose(() => {
        GraphPanel.pending = undefined;
        GraphPanel.waiting = false;
      });
    }
    /*
     * The frame the graph will move into, said out loud.
     *
     * `pending` is how the loader hands its frame to the build that replaces
     * it. Setting it only when nothing was on screen was right while a loader
     * could only ever be the first thing in a window — and wrong the moment one
     * is opened for a second reading beside a first: the frame made here went
     * unclaimed, the graph opened a frame of its own, and what the reader got
     * was their change plus an abandoned tab called "Odin: Change Graph" still
     * saying "Reading the change".
     */
    if (taken || !own || !GraphPanel.active) GraphPanel.pending = panel;

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
    await GraphPanel.paint(panel, note);
  }

  /**
   * Puts a waiting page into a frame and keeps at it until the frame runs it.
   *
   * Lifted out of `showLoading` because a queued frame needs exactly this and
   * none of the rest: it is not the build in progress, has no progress to be
   * told about, and must not become the one slot that everything else aims at.
   * What it does need is the part that was hard to get right — a document that
   * actually lands.
   */
  private static async paint(
    frame: vscode.WebviewPanel,
    note: string,
  ): Promise<void> {
    const page = await waitingHtml(frame.webview, note, true);

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
    // Per frame, not one for the window. Several frames are painted in a row
    // while a reload comes back, and a single slot meant each one disposed the
    // listener belonging to the one before it — so those frames never heard
    // their own page arrive and rewrote it three times over a document that
    // was already running.
    frame.onDidDispose(() => heard.dispose());

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
        // Per frame, not "is this the panel being built". Several frames wait
        // at once now, and the one thing that should stop a retry is that
        // particular frame having got something better than a loader.
        if (arrived || GraphPanel.settled.has(frame)) return;
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
    // Nothing left to hear once the last attempt has been and gone.
    setTimeout(() => heard.dispose(), TRIES[TRIES.length - 1]! + 2000);
  }

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
    if (!known) return;

    /*
     * Asked for by number, because the number is what this is.
     *
     * It used to ask by the branch the reading was built from, which is only
     * sometimes a name the forge answers to. A reading of the forge's own copy
     * is built from `origin/luis/lab-147` — a tracking ref, not a branch — and
     * `gh pr view` given one of those finds nothing. Nothing came back, nothing
     * was updated, and nothing said so: a reviewer who had just approved from
     * inside Odin watched the bar go on saying what it said before and the
     * reviewers panel go on showing them as pending.
     *
     * The pull request is already on screen, so its number is already known,
     * and a number is unambiguous in a way no ref is.
     */
    const fresh = await readPullRequest(String(known.number), {
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

  /**
   * Everything the forge could have changed, for every reading on screen.
   *
   * All of them rather than the one in front: a reader who comes back to a
   * window with three changes open is coming back to three stale pictures, and
   * the two behind the front one are the ones they are least likely to think to
   * refresh by hand.
   */
  static async refreshStale(): Promise<void> {
    await Promise.all(
      GraphPanel.readings().map((panel) =>
        Promise.all([
          panel.refreshPullRequest(),
          panel.readChecks(),
          panel.readMerge(),
        ]),
      ),
    );
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
    if (answer === "Show local changes") {
      // Promoted rather than opened beside: see `promoting`.
      GraphPanel.promoting = this.key;
      GraphPanel.onLocal?.();
    }
  }

  /**
   * The reading being replaced by its live counterpart, while that is happening.
   *
   * Asking for the local version of a change already on screen is not asking
   * for a second tab. It is the same change read the other way, and what the
   * reader wants at the end of it is the live one — so the tab it was promoted
   * from is closed once its replacement is up. Left open, a reader promoting
   * twice ends the afternoon with four tabs of one change and no way to tell
   * which of them follows their typing.
   *
   * Only for a promotion. Opening both deliberately is a thing people do — that
   * is why both exist — so nothing here closes a tab the reader did not just
   * ask to be replaced.
   */
  static promoting: string | undefined;

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
  /*
   * Named apart from the redraw that shares this class.
   *
   * Both were called `update`, and a class body cannot hold two: the later
   * definition simply replaced this one, so pressing "Update branch" called
   * the redraw with `graph = true` and the branch was never updated. Nothing
   * reported it — the redraw took the argument, made nothing of it, and
   * returned.
   */
  private async updateBranch(rebase: boolean): Promise<void> {
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
  /**
   * The pull request's comments again, with its conversations on them.
   *
   * Two requests rather than one, because the forge answers them separately:
   * the list of comments knows nothing about which of them are one thread or
   * whether anybody has settled it, and the query that does knows nothing about
   * bodies. Every place that reloads comments goes through here, so a tick
   * cannot be right on one path and missing on another.
   */
  private async reloadComments(): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const posted = await listReviewComments(pull.number, { cwd: this.repo });
    const threads = await listReviewThreads(pull.number, { cwd: this.repo }).catch(
      () => new Map<number, { threadId: string; resolved: boolean }>(),
    );
    const joined = stampThreads(posted, threads);
    this.comments = await inlineAvatars(joined).catch(() => joined);
    void this.panel.webview.postMessage({
      type: "comments",
      comments: this.comments,
    });
  }

  /**
   * Settling a conversation, or opening it again, because the reader said so.
   *
   * Thin on purpose. The store is the one place that records it and the one
   * place that tells the forge, so that a conversation settled by an agent's
   * answer and one settled by somebody pressing a button go the same way and
   * cannot disagree.
   */
  private async resolve(what: { id: number; resolved: boolean }): Promise<void> {
    this.pairing().settle(what.id, what.resolved);
  }

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

  /**
   * Which coding agents this machine can run, sent to the page that asked.
   *
   * Answered even when the answer is none: an empty list is what tells the
   * panel it has been looked for, which is a different thing to draw from
   * not having asked yet. Failure is the same as none — the reader is being
   * offered a convenience, and a stack trace is not one.
   */
  private async findAgents(again = false): Promise<void> {
    let agents: { id: string; name: string; version: string }[] = [];
    try {
      const found = await this.pairing().look(again);
      agents = found.map((agent) => ({
        id: agent.id,
        name: agent.name,
        version: agent.version_,
      }));
    } catch {
      /* none, which is what the panel will say */
    }
    // Whatever the reader had switched on last time, now that there is a list
    // to match it against. Without this a message written before the panel is
    // opened waits for an order nobody has set.
    const held = GraphPanel.settings?.read();
    this.pairing().setOrder(readOrder(held));
    this.pairing().setAgency(readAgency(held));
    void this.panel.webview.postMessage({ type: "agents", payload: agents });
    /*
     * And everything that hangs off knowing which agents exist.
     *
     * The rungs each tool offers, what the reader calls its conversation, which
     * agents are carrying one — none of it can be worked out before this, and
     * none of it was being sent afterwards. A restored terminal showed a single
     * "Ask" button because the page had never been told what else the tool
     * could do.
     */
    this.sendComments();
  }

  /**
   * The conversation with the agents, for this reading.
   *
   * Made on first use rather than in the constructor: most readings never ask
   * for one, and building it reads the editor's storage.
   */
  private pairing(): PairingSession {
    if (!this.paired) {
      this.paired = new PairingSession(
        GraphPanel.store!,
        this.key || readingKey(this.graph, this.repo),
        this.repo,
        () => this.sendComments(),
      );
      /*
       * A conversation the store has settled, settled on the forge as well.
       *
       * An agent answering closes the thread, and asking again opens it — both
       * happen inside the store, which knows nothing about pull requests. This
       * carries the same decision outward for the threads that have somewhere
       * outward to go, so a reader on the forge sees what a reader here sees.
       */
      this.paired.onSettle = (rootId, resolved) => {
        // Local ids are negative and name no thread the forge has heard of. The
        // store is the whole of the answer for those.
        if (rootId < 0) return;
        const comment = this.comments.find((one) => Number(one.id) === rootId);
        if (!comment?.threadId) return;
        void resolveThread(comment.threadId, resolved, { cwd: this.repo }).then(
          (took) => {
            if (took) {
              void this.reloadComments();
              return;
            }
            // Put back, rather than left showing a state the pull request does
            // not agree with. Written straight into the store so that undoing
            // it does not try to tell the forge again.
            this.paired?.unsettle(rootId, !resolved);
            vscode.window.showErrorMessage(
              resolved
                ? "Odin: the forge would not mark that conversation resolved."
                : "Odin: the forge would not reopen that conversation.",
            );
          },
        );
      };
      this.paired.printed = (agent, chunk) => {
        void this.panel.webview.postMessage({
          type: "agentOutput",
          payload: { agent, chunk },
        });
      };
    }
    return this.paired;
  }

  private paired: PairingSession | undefined;

  /**
   * Where this reading keeps pictures pasted into a conversation.
   *
   * Made on first use rather than on every panel: most readings never paste
   * anything, and a directory per tab whether or not it is used is litter in
   * somebody's temp folder for the sake of a field.
   */
  private images: string | undefined;

  /**
   * Where the reader's own workspace notes are kept.
   *
   * Set once at activation, like the settings store. A session cannot make one
   * for itself — a `Memento` comes from the extension context and there is no
   * way to ask for one from here.
   */
  static store: vscode.Memento | undefined;

  /**
   * Both kinds of comment, as one list.
   *
   * The forge's and this machine's, in the order they were written. The page
   * draws them the same way on purpose: a conversation about a passage is one
   * conversation, whether or not anybody has decided to publish it yet. What
   * marks the local ones is the badge and the absence of a link, not a
   * separate list they live in.
   */
  private everything(): ReviewComment[] {
    /*
     * Asked for rather than read if it happens to exist.
     *
     * This runs while the document is being built, which after a window reload
     * is before anything else has touched the pairing session — so a reading
     * with a conversation stored against it was rendered with the forge's
     * comments and none of its own. The remarks were on disk, loaded into
     * memory a moment later by the panel asking what agents were installed,
     * and never sent anywhere. What the reader saw was every local
     * conversation gone.
     */
    const local = this.pairing().local();
    /*
     * What the store knows about a conversation beats what the forge last said.
     *
     * An agent answering settles the thread here and tells the forge after, and
     * the forge's answer only comes back on the next fetch. Between the two the
     * comments in hand still say the conversation is open — so the tick would
     * appear, vanish, and come back a second later once the round trip landed.
     */
    const settled = this.pairing().settledThreads();
    const posted = this.comments.map((comment) => {
      const known = settled[String(comment.id)];
      return known === undefined ? comment : { ...comment, resolved: known };
    });
    if (local.length === 0) return posted;
    return [...posted, ...local].sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt)),
    );
  }

  /** The page's copy of the conversation, brought level with ours. */
  private sendComments(): void {
    void this.panel.webview.postMessage({
      type: "comments",
      comments: this.everything(),
      busy: this.paired?.busy() ?? [],
      // Who has claimed which conversation. Worked out on this side because
      // the rule is the same one the queue decides by, and two spellings of it
      // would eventually disagree — with the thread saying one agent owns it
      // while the messages go to another.
      owners: this.paired?.owners() ?? {},
      // Which agents have a conversation about this reading to carry on from.
      // Worth saying: an agent that remembers the last hour of this change
      // behaves differently from one meeting it for the first time, and there
      // is otherwise nothing on screen that distinguishes them.
      carrying: this.paired?.carrying() ?? [],
      // What the reader has been asked and not yet answered.
      pending: this.paired?.pending() ?? [],
      // And what they have asked that nobody has started on. The queue is only
      // visible in the margins otherwise, which is not where somebody watching
      // an agent work is looking.
      queued: this.paired?.queued() ?? [],
      // What the reader calls each conversation, and which rungs each tool
      // actually offers — a level a tool has no word for would be a control
      // that silently does nothing.
      labels: this.paired?.labelled() ?? {},
      rungs: this.paired?.rungs() ?? {},
      sessions: Object.fromEntries(
        (this.paired?.carrying() ?? []).map((id) => [id, this.paired!.session(id) ?? ""]),
      ),
    });
  }

  /** A line of progress, without restarting the animation. */
  static note(message: string, percent?: number): void {
    if (!GraphPanel.waiting) return;
    const panel = GraphPanel.target();
    void panel?.webview.postMessage({
      type: "note",
      message,
      ...(percent === undefined ? {} : { percent }),
    });
  }

  /**
   * Ends the wait with words instead of a graph.
   *
   * Something has to replace the pulse when the build finds nothing or fails,
   * or the page goes on promising a picture that is not coming.
   */
  static async stopLoading(note: string): Promise<void> {
    if (!GraphPanel.waiting) return;
    const panel = GraphPanel.target();
    GraphPanel.waiting = false;
    if (!panel) return;
    // Words are not a loader, so the retries have nothing left to replace.
    GraphPanel.settled.add(panel);
    panel.webview.html = await waitingHtml(panel.webview, note, false);
  }

  /**
   * Gives up on a reading, and takes its tab with it.
   *
   * For the one failure nothing can be done about: the change is of a ref that
   * is not here and cannot be fetched, because the branch has been deleted from
   * the forge and there is no pull request left to reach its head through. No
   * retry helps, so the frame would sit on a git error until somebody closed
   * it — a tab that looks like a review, opens like a review, and can never be
   * one.
   *
   * Only a frame with nothing in it. A reading that has drawn is a reading that
   * worked; whatever has just failed, throwing that away would be taking a
   * picture off the reader to report a problem with a different one.
   */
  static abandon(key?: string): void {
    const waiting = GraphPanel.pending;
    if (waiting) {
      GraphPanel.pending = undefined;
      GraphPanel.waiting = false;
      waiting.dispose();
      return;
    }

    const held = key ? GraphPanel.open.get(key) : undefined;
    if (held && !held.painted) held.dispose();
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
  static setRefreshing(
    on: boolean,
    note?: string,
    /**
     * The first build of this reading, still finishing.
     *
     * The cards go up as soon as the diff is read and the arrows arrive when
     * they are known — so for the seconds in between there is a picture that
     * looks finished and is not. A corner badge is the right size for a
     * rebuild nobody asked for; it is far too quiet for a drawing whose
     * arrows, parts and colours are all still on their way, and a reader who
     * starts reviewing during it is reading something that is about to move.
     */
    settling?: { percent?: number },
  ): void {
    void GraphPanel.active?.panel.webview.postMessage({
      type: "refreshing",
      value: on,
      ...(note ? { note } : {}),
      ...(settling
        ? { settling: true, ...(settling.percent === undefined ? {} : { percent: settling.percent }) }
        : { settling: false }),
    });
  }

  /**
   * The tab's own mark while its change is being worked out.
   *
   * A rebuild takes seconds on a large change, and until now the only sign of
   * one was inside the page: a reader who has turned to their editor has no way
   * to tell a graph that is up to date from one that is three saves behind. The
   * tab is where they are looking, so the tab says it.
   *
   * A pulse rather than a colour, because a colour is a state and this is a
   * process — and because the editor gives no other way to animate a tab: an
   * icon is a file, so two files alternating is what a pulse is made of here.
   * Slow on purpose. This runs for the length of every rebuild and sits at the
   * edge of the reader's eye while they work.
   */
  private static readonly PULSE = 620;

  private beat: ReturnType<typeof setInterval> | undefined;

  private mark(working: boolean): void {
    if (!GraphPanel.assets) return;
    const at = (name: string) =>
      vscode.Uri.joinPath(GraphPanel.assets!, "media", name);

    if (!working) {
      if (this.beat) clearInterval(this.beat);
      this.beat = undefined;
      /*
       * Green for a reading of the files on disk.
       *
       * The tab strip is where a reader picks between the two readings of one
       * change, and a tab's title is plain text — the icon is the only thing
       * there that can carry a colour. The word stays in the title beside it:
       * a colour nobody can name says nothing to somebody who does not already
       * know the convention.
       */
      const live = this.graph.meta.worktree === true;
      this.panel.iconPath = live
        ? { light: at("odin-live-light.svg"), dark: at("odin-live.svg") }
        : { light: at("odin-light.svg"), dark: at("odin-dark.svg") };
      return;
    }

    if (this.beat) return;
    let lit = true;
    const show = () => {
      lit = !lit;
      this.panel.iconPath = lit
        ? { light: at("odin-working-light.svg"), dark: at("odin-working.svg") }
        : {
            light: at("odin-working-light-dim.svg"),
            dark: at("odin-working-dim.svg"),
          };
    };
    show();
    this.beat = setInterval(show, GraphPanel.PULSE);
  }

  /**
   * The same, said to the reading it is about rather than to the one in front.
   *
   * A watcher belongs to a reading, and so does everything it has to say. Told
   * to whichever panel was active, a rebuild of a change the reader had left
   * put "Rebuilding — 1 file changed" over the change they had turned to — and
   * took it away again in whichever panel happened to be active a second later,
   * so a frame could be left spinning over a rebuild that had already finished
   * somewhere else.
   */
  static setRefreshingIn(
    graph: ChangeGraph,
    repo: string,
    on: boolean,
    note?: string,
  ): void {
    const panel = GraphPanel.open.get(readingKey(graph, repo));
    if (!panel) return;
    panel.mark(on);
    void panel.panel.webview.postMessage({
      type: "refreshing",
      value: on,
      ...(note ? { note } : {}),
    });
  }

  /** Brings the existing graph back to the front, if there is one. */
  static revealCurrent(): void {
    GraphPanel.active
      ? GraphPanel.active.panel.reveal(vscode.ViewColumn.One)
      : vscode.commands.executeCommand("odin.review");
  }

  /** Opens a file as a diff, for the sidebar's file rows. */
  static async openPath(path: string): Promise<void> {
    await GraphPanel.active?.openDiff(path);
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
    const panel = GraphPanel.active;
    if (!panel || !where?.odinPath || !where.odinLine) return;
    await panel.reveal(
      where.odinPath,
      where.odinLine,
      where.odinSide === "base" ? "base" : "head",
    );
  }

  /** Brings a file's card to the middle of the canvas, without opening it. */
  static focusPath(path: string): void {
    void GraphPanel.active?.panel.webview.postMessage({ type: "focus", path });
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
    const panel = GraphPanel.active;
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

  /**
   * Who is reading, and their face, asked of the forge once.
   *
   * It used to be asked only while the pull request's comments were being
   * fetched — which never happens on a change with no comments on it yet, and
   * that is exactly the change somebody is most likely to be writing the first
   * one on. Anything wanting to know who was speaking got an empty string, and
   * the reader's own remarks went into the thread signed "you" beside
   * everybody else's real name and picture.
   *
   * Memoised on the promise rather than on the answer, so two things asking at
   * once ask the forge once between them.
   */
  private identity: Promise<{ login: string; face: string }> | undefined;

  private whoAmI(): Promise<{ login: string; face: string }> {
    this.identity ??= (async () => {
      const login = await currentUser({ cwd: this.repo }).catch(() => undefined);
      if (!login) {
        // Not remembered as an answer: `gh` may be signed out now and signed in
        // a minute from now, and caching "nobody" would outlast that.
        this.identity = undefined;
        return { login: "", face: "" };
      }
      // Their own face, inlined like every other face here: a webview will not
      // fetch one, and a composer with everybody's picture but the writer's
      // own looks like it belongs to somebody else.
      const face =
        (await inlineAvatar(`https://github.com/${login}.png?size=64`).catch(
          () => undefined,
        )) ?? "";
      return { login, face };
    })();
    return this.identity;
  }

  /** Learns who is reading, and signs anything already written as nobody. */
  private async learnViewer(): Promise<{ login: string; face: string }> {
    const me = await this.whoAmI();
    if (!me.login || me.login === this.viewer) return me;

    this.viewer = me.login;
    this.viewerFace = me.face;
    // Remarks written before the forge answered are still this reader's. They
    // are signed properly rather than left as the placeholder for ever.
    if (this.paired?.identify(me.login, me.face)) this.sendComments();
    this.render(this.layout);
    return me;
  }

  /** Comments already on the pull request, shown against their lines. */
  setComments(comments: ReviewComment[]): void {
    this.comments = comments;
    void this.learnViewer().catch(() => undefined);
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
    const threads = await listReviewThreads(pull.number, { cwd: this.repo }).catch(
      () => new Map<number, { threadId: string; resolved: boolean }>(),
    );
    const joined = stampThreads(posted, threads);
    this.comments = await inlineAvatars(joined).catch(() => joined);
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
    const { id, content, body } = message.payload;

    /*
     * A remark the forge never issued an id for.
     *
     * Local ids are negative and the forge's are not, so this is not a guess.
     * Without it a reply in a local conversation went to `gh` carrying an id
     * of ours, and came back "Parent comment not found (HTTP 404)" — after the
     * reader had written the reply and pressed the button.
     *
     * The page routes these to their own messages now. This stays because the
     * page is a document that can be a version behind: a graph left open
     * across an upgrade still sends the old message, and it should do nothing
     * rather than something wrong.
     */
    if (id < 0) {
      if (message.type === "editComment" && body) this.paired?.edit(id, body);
      else if (message.type === "deleteComment") this.paired?.remove(id);
      return;
    }

    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

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

    await this.reloadComments();
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
    /** The reading this rebuild belongs to, as its watcher knows it. */
    where?: string,
  ): boolean {
    /*
     * The panel holding *this* reading, rather than whichever is in front.
     *
     * Every reading of a working tree has a watcher of its own, and a rebuild
     * belongs to the reading that provoked it. Delivered to the active panel it
     * went wherever the reader happened to be looking: open a live change, turn
     * to another tab, and the first change's next rebuild arrived in the second
     * one's frame — the reader watching a change they had left come back over
     * the one they were reading, or the page sitting on a model that is not a
     * model of what it is showing.
     *
     * The registry is keyed by what a reading *is*, which is exactly the
     * question being asked here.
     */
    /*
     * Two names for one reading, and both have to be tried.
     *
     * A panel restored from a reload is registered under the reading the page
     * wrote down, which holds the base as the reader asked for it — `HEAD~1`.
     * A rebuild arrives carrying a graph whose base has since been resolved to
     * what it actually is — `main`. Same reading, two spellings, and a lookup
     * by either alone misses half the time: measured, the first rebuild after a
     * restore wanted `main…main…live` while the registry held
     * `HEAD~1…main…live`.
     *
     * So the caller's own name for it is tried first — the watcher was armed
     * under it — and the graph's after. What is deliberately not tried is
     * "whichever panel is in front", which is what this used to do and what
     * delivered one reading's rebuild into another reading's frame.
     */
    const panel =
      (where ? GraphPanel.open.get(where) : undefined) ??
      GraphPanel.open.get(readingKey(graph, repo));
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
    void GraphPanel.active?.panel.webview.postMessage({
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

    /*
     * Which reading the reader is looking at.
     *
     * Followed rather than remembered when we hand a panel over: a reader
     * switching tabs tells the editor, not us, and everything that acts on
     * "the graph" — opening a file from the list, flying to a reference — has
     * to mean the one in front of them.
     */
    // Guarded, like every other event this constructor subscribes to. All of it
    // runs before the panel is usable, so a host that does not offer one of
    // them takes the whole review down — and the failure reads as a broken
    // build rather than as a missing API.
    if (typeof this.panel.onDidChangeViewState === "function") {
      this.panel.onDidChangeViewState(
      () => {
        if (!this.panel.active || GraphPanel.active === this) return;
        GraphPanel.active = this;
        // The file list, the viewed marks and the refresh button all mean "the
        // change in front of me", and which one that is has just changed.
        GraphPanel.onActive?.(this.graph, this.repo);
        /*
         * And which part of it, which only the page knows.
         *
         * Taking the list over resets it to the whole change — a different
         * reading has a different set of parts, and nothing here can tell that
         * one of them is the part this page still has open. So the page is
         * asked, and answers with the files it is actually showing.
         */
        void this.panel.webview.postMessage({ type: "sayPart" });
      },
      undefined,
      this.disposables,
      );
    }

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
      /*
       * The diagram renderer, named but not loaded.
       *
       * The page fetches it the first time an agent draws something and never
       * otherwise, so what travels in the document is a URI rather than three
       * and a half megabytes of renderer.
       */
      ...(this.diagramRenderer() ? { mermaid: this.diagramRenderer()! } : {}),
      ...(this.withTests ? { withTests: this.withTests } : {}),
      ...(this.alternate ? { alternate: this.alternate } : {}),
      ...(this.highlight ? { highlight: this.highlight } : {}),
      comments: this.everything(),
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
  /**
   * What the tab is called, and the mark beside it.
   *
   * Said from the graph every time one arrives, and that is the point: a live
   * reading is of a checkout rather than of a branch, so switching branch under
   * one makes it a reading of something else. The rebuild follows — a checkout
   * rewrites the files, which is what the watcher is watching — but only a
   * whole new document used to re-title the tab, and a rebuild applied in place
   * is not one. What that left was a tab still naming the branch the reader had
   * left, over a drawing of the branch they had moved to, with the bar inside
   * the page already saying the new one.
   */
  private name(): void {
    const pull = this.graph.meta.pullRequest;
    const named = pull
      ? `#${pull.number} ${pull.title}`
      : `Odin: ${this.graph.meta.baseRef} → ${this.graph.meta.headRef}`;
    this.panel.title = this.graph.meta.worktree === true ? `LIVE ${named}` : named;
    // The mark that goes with it, now there is a graph to ask which reading
    // this is. The frame was given the plain one before anything was known.
    this.mark(false);
  }

  private send(
    layout: GraphLayout,
    redrawn?: readonly string[],
    withdrawn?: readonly string[],
  ): boolean {
    const { model } = this.built(layout);
    if (!model) return false;
    this.layout = layout;
    this.name();

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

  /**
   * Where the page can fetch the diagram renderer, if this host can say.
   *
   * Guarded, and the guard is the point. This is one optional extra on a page
   * whose job is to draw a change: an editor that cannot form a webview URI —
   * an older API, a frame without the method, a test double — must lose the
   * diagrams and nothing else. Left unguarded it threw while the document was
   * being built, which took the whole graph with it: sixteen tests sat on a
   * loading page until they timed out, and the failure said "unexpected token
   * '<'" rather than anything about a URI.
   */
  private diagramRenderer(): string | undefined {
    if (!GraphPanel.assets) return undefined;
    try {
      return this.panel.webview
        .asWebviewUri(
          vscode.Uri.joinPath(GraphPanel.assets, "dist", "media", "mermaid.min.js"),
        )
        .toString();
    } catch {
      return undefined;
    }
  }

  private render(layout: GraphLayout): void {
    this.layout = layout;
    // Whatever was being waited for has arrived.
    GraphPanel.waiting = false;
    // In this frame, specifically. Another may still be waiting on its own
    // graph, and the retries that keep a loader alive are per frame.
    GraphPanel.settled.add(this.panel);
    /*
     * The pull request's title names the tab; the branch pair is in the
     * toolbar, and a tab strip has room for one of them, not both.
     *
     * A reading of the files on disk says so, because the two are the same
     * change under two names and the tab strip is where a reader picks between
     * them. Which is which mattered the moment both could be open at once, and
     * a title that does not say it leaves them to tell two identical tabs apart
     * by clicking one.
     */
    this.name();

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

    /*
     * The frame is told what it is a reading of, and remembers it for us.
     *
     * A webview can hold a little state of its own that survives the window
     * going away, and it is the only thing about a restored frame that comes
     * back with it. Without this the editor hands over N identical empty
     * panels after a reload and there is nothing to say which change each one
     * held — which is why only ever one of them could be brought back.
     *
     * Sent after the page rather than embedded in it: this is not something
     * the page draws, and the file `odin view` writes has no host to remember
     * anything for it.
     */
    setTimeout(() => {
      void this.panel.webview.postMessage({
        type: "reading",
        payload: this.describe(),
      });
    }, 0);
  }

  /** The question this reading answers, in the form a reload can replay. */
  private describe(): {
    repo: string;
    baseRef?: string;
    headRef?: string;
    worktree?: boolean;
    number?: number;
  } {
    const meta = this.graph.meta;
    return {
      repo: this.repo,
      ...(meta.baseRef ? { baseRef: meta.baseRef } : {}),
      ...(meta.headRef ? { headRef: meta.headRef } : {}),
      ...(meta.worktree === true ? { worktree: true } : {}),
      ...(meta.pullRequest ? { number: meta.pullRequest.number } : {}),
    };
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
        await this.updateBranch(message.payload.rebase === true);
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
      if (message.type === "discoverAgents") {
        // The refresh button says the answer has changed; a rebuilt page
        // asking again does not, and re-probing for it was the whole cost.
        await this.findAgents(message.payload?.again === true);
        return;
      }
      if (message.type === "renameSession") {
        this.paired?.rename(message.payload.agent, message.payload.name ?? "");
        return;
      }
      if (message.type === "copySession") {
        const id = this.paired?.session(message.payload.agent);
        if (!id) return;
        // Through the editor rather than the page: a webview's clipboard is
        // refused often enough — and silently enough — that a button doing
        // nothing would be the common case rather than the odd one.
        await vscode.env.clipboard.writeText(id);
        void vscode.window.setStatusBarMessage(`Odin: copied ${id}`, 3000);
        return;
      }
      if (message.type === "editLocal") {
        if (this.paired?.edit(message.payload.id, message.payload.body ?? "")) return;
        return;
      }
      if (message.type === "deleteLocal") {
        const gone = await vscode.window.showWarningMessage(
          "Delete this remark?",
          {
            modal: true,
            detail:
              "It is on this machine only, so nobody else loses anything — but nothing here keeps a copy.",
          },
          "Delete",
        );
        if (gone === "Delete") this.paired?.remove(message.payload.id);
        return;
      }
      if (message.type === "answerApproval") {
        this.paired?.answer(message.payload.id, message.payload.allow === true);
        return;
      }
      if (message.type === "forgetSessions") {
        this.paired?.forgetSessions();
        this.sendComments();
        return;
      }
      if (message.type === "copyText") {
        const text = message.payload?.text;
        if (typeof text !== "string" || !text) return;
        await vscode.env.clipboard.writeText(text);
        void vscode.window.setStatusBarMessage(
          `Odin: ${message.payload.said ?? "copied"}`,
          3000,
        );
        return;
      }
      if (message.type === "showImage") {
        const path = String(message.payload.path ?? "");
        /*
         * Only the two places a picture in this conversation can honestly have
         * come from: the folder pasted screenshots land in, and the repository
         * being read. Anything else is a page asking the host to read a file
         * for it, which is not a thing this page has any reason to do.
         */
        const within = [this.repo, ...(this.images ? [this.images] : [])];
        void this.panel.webview.postMessage({
          type: "imageShown",
          path,
          data: readImage(path, within) ?? "",
        });
        return;
      }
      if (message.type === "cancelAsk") {
        this.paired?.cancel(Number(message.payload.id));
        return;
      }
      if (message.type === "stopAgent") {
        this.paired?.stop(message.payload.agent);
        return;
      }
      if (message.type === "agentTranscript") {
        void this.panel.webview.postMessage({
          type: "agentTranscript",
          payload: {
            agent: message.payload.agent,
            text: this.paired?.transcript(message.payload.agent) ?? "",
          },
        });
        return;
      }
      if (message.type === "askAgents") {
        // Started before the forge is asked who this is, so the remark appears
        // the moment it is written. The name arrives a beat later and is
        // written onto it — a message that waits on the network to show up at
        // all reads as a message that was not sent.
        const paired = this.pairing();
        /*
         * Pictures become files before the message is written down.
         *
         * An agent takes a path, so the remark has to carry one — and it has to
         * carry it in the remark itself rather than in something handed to the
         * tool alongside, because the thread is the record. Somebody reading
         * this conversation next week should be able to see that a screenshot
         * was part of the question.
         */
        const { images, ...asked } = message.payload;
        const paths = images?.length
          ? keepPasted(images, (this.images ??= imageFolder()))
          : [];
        paired.ask({
          ...asked,
          body: withImages(asked.body, paths),
          author: this.viewer || PLACEHOLDER,
          ...(this.viewerFace ? { avatarUrl: this.viewerFace } : {}),
        });
        void this.learnViewer().catch(() => undefined);
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
        // The order is the priority rule, so a reorder is not merely a
        // preference to file: a message waiting on a busy agent may now have
        // somebody above it who is free.
        this.paired?.setOrder(readOrder(message.payload));
        this.paired?.setAgency(readAgency(message.payload));
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
    GraphPanel.open.delete(this.key);
    if (GraphPanel.active === this) {
      // Whatever is left, so the next press has somewhere to land. The editor
      // will correct this the moment the reader looks at a tab.
      GraphPanel.active = GraphPanel.open.values().next().value;
    }
    // The pulse is a timer, and a timer outliving its tab is a timer writing an
    // icon onto a panel that has been thrown away.
    if (this.beat) clearInterval(this.beat);
    this.beat = undefined;
    // Turns in flight belong to this reading, and there is nowhere left for
    // them to write. What they have already said is on disk.
    this.paired?.dispose();
    // Pictures pasted into this reading's conversations. They were copies of
    // something the reader already had, kept only so an agent could open them.
    if (this.images) {
      try {
        rmSync(this.images, { recursive: true, force: true });
      } catch {
        // A temp directory that will not go is the operating system's problem.
      }
      this.images = undefined;
    }
    GraphPanel.onClosed?.(this.key);
    this.panel.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  /**
   * A reading has gone.
   *
   * The panel has no idea what a watcher is; the extension wires the two
   * together, and a reading nobody is looking at should not go on being
   * rebuilt.
   */
  static onClosed: ((key: string) => void) | undefined;

  /**
   * The reader has turned to another reading.
   *
   * Everything outside this panel that says "the change" — the file list, the
   * marks against it — has to follow, and none of it is the panel's to move.
   */
  static onActive: ((graph: ChangeGraph, repo: string) => void) | undefined;

  /** What this panel is a reading of, for whoever is keeping track. */
  get reading(): string {
    return this.key;
  }

  /**
   * The question that produced the reading in front of the reader.
   *
   * Asked of the panel rather than remembered beside it. There is one of these
   * per tab now, and a module-level "the last review" answers for whichever was
   * opened most recently — which is the wrong tab as soon as the reader looks
   * at another one.
   */
  static current():
    | { repo: string; baseRef?: string; headRef?: string; worktree?: boolean }
    | undefined {
    const panel = GraphPanel.active;
    if (!panel) return undefined;
    const meta = panel.graph.meta;
    return {
      repo: panel.repo,
      ...(meta.baseRef ? { baseRef: meta.baseRef } : {}),
      ...(meta.headRef ? { headRef: meta.headRef } : {}),
      ...(meta.worktree === true ? { worktree: true } : {}),
    };
  }
}


/**
 * The agents the reader switched on, in their order, out of stored settings.
 *
 * Read defensively because settings are whatever the page last sent: a build
 * one version behind wrote no such field, and there is no schema between the
 * two sides — the page owns what a setting means, which is what makes adding
 * one cost nothing here.
 */
function readOrder(settings: unknown): string[] {
  if (!settings || typeof settings !== "object") return [];
  const held = (settings as Record<string, unknown>).pairing;
  if (!Array.isArray(held)) return [];
  return held.filter((id): id is string => typeof id === "string");
}

/**
 * How much rope each agent has been given, out of stored settings.
 *
 * Read defensively, like the order beside it: settings are whatever the page
 * last sent, and a build one version behind wrote no such field.
 */
function readAgency(settings: unknown): Record<string, Agency> {
  if (!settings || typeof settings !== "object") return {};
  const held = (settings as Record<string, unknown>).agency;
  if (!held || typeof held !== "object") return {};
  const out: Record<string, Agency> = {};
  for (const [id, level] of Object.entries(held as Record<string, unknown>)) {
    if (level === "read" || level === "ask" || level === "edits" || level === "full") {
      out[id] = level;
    }
  }
  return out;
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
