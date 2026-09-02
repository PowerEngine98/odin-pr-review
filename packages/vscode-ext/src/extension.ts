import {
  currentBranch,
  forgeEnv,
  git,
  currentUser,
  listPullRequests,
  type PullRequestSummary,
  listRefs,
  inlineAvatar,
  inlineAvatars,
  listReviewComments,
  listReviewThreads,
  stampThreads,
  localBranches,
  readableCheckout,
  worktreeFor,
  serializeGraph,
  uncommittedCount,
  describeDelta,
  type LocalBranch,
} from "@odin/core";
import { loadHighlighter } from "@odin/highlight";
import { execFile } from "node:child_process";

import * as vscode from "vscode";

import { BASE_SCHEME, BaseContentProvider } from "./baseContent.js";
import { buildGraphForRepo, forgetBase, stageGraphForRepo } from "./graph.js";
import { LiveGraph } from "./live.js";
import { GraphPanel } from "./panel.js";
import { paintRows } from "@odin/webview";

import { PairingSession } from "./pairing.js";
import { Progress } from "./progress.js";
import { ChangeSidebar } from "./sidebar.js";
import { activeTheme } from "./theme.js";
import { SeenStore } from "./seen.js";
import { BaseStore } from "./base.js";
import { keyOf, SessionStore, type Session } from "./session.js";
import { SettingsStore } from "./settings.js";
import { ViewedStore } from "./viewed.js";

/** The editor's own theme, which the grammars' colours have to match. */
function isDark(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return (
    kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast
  );
}


/** Which files the reviewer has marked off, shared by both views. */
let viewed: ViewedStore;

/** The sidebar's view of the most recent review. */
let sidebar: ChangeSidebar;

/** Which commit of each pull request this reviewer has already read. */
let seen: SeenStore;

/** What was on screen when the window last went away. */
let session: SessionStore;

/** A base this reader picked for this repository, kept off the repository. */
let chosenBase: BaseStore;

/**
 * The whole question the last review answered, so it can be asked again.
 *
 * All of it, not just the base. `odin.refresh` replays this, and while it kept
 * only the repository and the base it silently replayed a *different* question:
 * a reader who had asked for the local reading — the files on disk, uncommitted
 * work included — got the last commit back instead. The card reverted to
 * committed text, and because `armLive` watches nothing but a working-tree
 * reading, the live updating stopped with it. Both looked like the watcher
 * being broken; neither was.
 */
let last:
  | { repo: string; baseRef?: string; headRef?: string; worktree?: boolean }
  | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // The graph's tab wears the extension's own mark, which is a file on disk:
  // the tab belongs to the editor rather than to the page inside it.
  GraphPanel.assets = context.extensionUri;

  viewed = new ViewedStore(context.workspaceState);
  seen = new SeenStore(context.workspaceState);
  session = new SessionStore(context.workspaceState);
  chosenBase = new BaseStore(context.workspaceState);
  // Global rather than per-workspace: which files somebody has read is about
  // this change, but whether they want to see import arrows is about them.
  GraphPanel.settings = new SettingsStore(context.globalState);
  // Per workspace, unlike the settings above: a conversation with an agent is
  // about this repository's code and belongs nowhere else.
  GraphPanel.store = context.workspaceState;
  // Where the stub Claude spawns lives. A path rather than anything imported:
  // it runs as a child of a tool we do not control, in that tool's environment.
  // Guarded, like every other call here that reaches for an editor API during
  // activation: everything in this function is one `push`, and a host missing
  // one method would take the whole extension down over a path. Without it,
  // pairing simply has nowhere for an agent to ask, which it already handles.
  try {
    PairingSession.stub = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "approve.mjs",
    ).fsPath;
  } catch {
    PairingSession.stub = "";
  }
  // The live reading of whatever is on screen, for the places that can only ask
  // for it: a file the current reading is too old to contain.
  GraphPanel.onLocal = () => {
    const here = GraphPanel.current() ?? last;
    if (here) void review(here.baseRef, here.headRef, true);
  };

  // The list belongs to whichever reading is in front. Its marks are stored per
  // review, so pointing the store at the new one is what makes the ticks in the
  // list the ticks of the change being looked at rather than of the last one
  // opened.
  GraphPanel.onActive = (graph, repo) => {
    viewed.open(repo, graph.meta.baseRef, graph.meta.headRef);
    sidebar.setGraph(graph);
  };

  // A reading nobody is looking at should not go on being rebuilt.
  GraphPanel.onClosed = (key) => {
    live.get(key)?.dispose();
    live.delete(key);
    localWatch.get(key)?.dispose();
    localWatch.delete(key);
    // Closed on purpose is not the same as lost to a reload, and the next one
    // should not bring it back.
    session.forget(key);
  };
  sidebar = new ChangeSidebar(viewed, seen);

  // Populated in the background so activation is not held up by the network.
  void refreshPullRequests();

  // Both views show the same marks, so each follows what the other does.
  context.subscriptions.push(
    viewed.onDidChange((paths, marked) => {
      sidebar.apply(paths, marked);
      GraphPanel.applyViewed(paths, marked);
    }),
    vscode.window.registerWebviewViewProvider(ChangeSidebar.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("odin.showGraph", () => GraphPanel.revealCurrent()),
    // The graph is the width it is given, and this list is most of what it is
    // not being given. Folding the bar away is the one thing its own title bar
    // can do for the picture beside it.
    // The list replaces the explorer in the same bar, and going back to the
    // files is otherwise a hunt through the activity bar for the icon that was
    // there a moment ago.
    vscode.commands.registerCommand("odin.showExplorer", () =>
      vscode.commands.executeCommand("workbench.view.explorer"),
    ),
    vscode.commands.registerCommand("odin.hideSidebar", () =>
      vscode.commands.executeCommand("workbench.action.closeSidebar"),
    ),
    vscode.commands.registerCommand("odin.chooser", () => sidebar.showChooser()),
    // And the way back in. The change list is still there behind the list of
    // pull requests, so returning to it costs nothing and rebuilds nothing.
    vscode.commands.registerCommand("odin.showChanges", () => sidebar.showChanges()),
    // A different question for the forge: which pull requests, and whose.
    vscode.commands.registerCommand(
      "odin.askForPulls",
      (query: { state: typeof asked.state; author: string }) => {
        asked = query;
        return refreshPullRequests();
      },
    ),
    // Both halves of what the bar is showing, because the button sits on the
    // list's own title bar and the list is what a reader is looking at when
    // they press it. A forge that did not answer leaves nothing to rebuild and
    // a list that is wrong; asking again is the whole point of the press.
    //
    // The list first and awaited, so a graph that takes seconds does not hold
    // back the answer the reader can already see coming. A reading that was
    // never opened has nothing to replay, and saying so beats rebuilding a
    // review of whatever happens to be checked out.
    vscode.commands.registerCommand("odin.refresh", async () => {
      await refreshPullRequests();
      // The reading in front of the reader, asked of the panel showing it.
      // "The last review" is the wrong tab the moment there is more than one.
      const here = GraphPanel.current() ?? last;
      if (here) {
        await review(
          here.baseRef,
          here.headRef,
          here.worktree === true,
          undefined,
          here.number,
        );
      }
    }),
    vscode.commands.registerCommand("odin.openFile", (path: string) =>
      GraphPanel.openPath(path),
    ),
    // Contributed to the webview's own context menu rather than the palette:
    // it is a question about a line, and there is no line without a right
    // click to have named one.
    vscode.commands.registerCommand(
      "odin.openAtLine",
      (where: { odinPath?: string; odinLine?: number; odinSide?: string }) =>
        GraphPanel.openAt(where),
    ),
    vscode.commands.registerCommand("odin.focusFile", (path: string) =>
      GraphPanel.focusPath(path),
    ),
    vscode.commands.registerCommand(
      "odin.followEdge",
      (target: { toPath: string; toLine: number; toSide: "base" | "head" }) =>
        GraphPanel.follow(target),
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      BASE_SCHEME,
      new BaseContentProvider(),
    ),
    vscode.commands.registerCommand("odin.review", () => review()),
    vscode.commands.registerCommand("odin.reviewFromUri", (base?: string) =>
      review(base),
    ),
    vscode.window.registerUriHandler({
      handleUri: (uri) => void handleUri(uri),
    }),
    /*
     * Coming back to the window, which is when what is on screen is oldest.
     *
     * Everything here is the forge's answer to a question asked once, and the
     * forge goes on without this window: a change approved last night is merged
     * by somebody else this morning, checks that were running have finished, a
     * pull request has been closed. A reader who returns to a review is looking
     * at yesterday's answers with no way to tell.
     *
     * Focus is the signal, because it is the moment before they read it. Not
     * the only one — a tab brought forward asks too — but the one that catches
     * the case that matters, which is a window left open overnight.
     */
    // Guarded, like the save listener: every registration here is inside one
    // `push`, so a host that does not offer this event would take the whole of
    // activation down with it — and the failure would look like the extension
    // being broken rather than like a missing API.
    typeof vscode.window.onDidChangeWindowState === "function"
      ? vscode.window.onDidChangeWindowState((window) => {
          if (window.focused) void refreshStale();
        })
      : new vscode.Disposable(() => {}),
    vscode.commands.registerCommand("odin.reviewAgainst", () => reviewAgainst()),
    vscode.commands.registerCommand("odin.exportGraph", () => exportGraph()),
    vscode.commands.registerCommand("odin.checkout", (number: number) =>
      checkout(number),
    ),
    // The two readings of a change whose local copy has moved. Both read;
    // neither moves the working tree.
    vscode.commands.registerCommand("odin.readLocal", (number: number) =>
      readLocal(number),
    ),
    vscode.commands.registerCommand("odin.readOrigin", (number: number) =>
      readOrigin(number),
    ),
    /*
     * From reading a change to working on it.
     *
     * Opening one no longer moves the working tree — that is what lets a
     * reviewer read a change while another is in progress. This is the step
     * that does move it, asked for once and on purpose, and it ends in the
     * reading that follows the files on disk: having gone to the trouble of
     * fetching the branch, what the reader wants next is their own edits
     * showing up in the picture.
     */
    vscode.commands.registerCommand("odin.checkoutLocal", (number: number) =>
      checkoutLocal(number),
    ),
    /*
     * Reopening what was on screen when the window went away.
     *
     * The editor keeps the tab across a reload and hands the empty frame back
     * here; without this it would come back as a blank panel, because the
     * document that filled it is gone. The graph is not stored and could not
     * usefully be — it is derived from the repository, and would be a picture
     * of the change as it was rather than as it is. What is stored is the
     * question that produced it, which is still true.
     */
    vscode.window.registerWebviewPanelSerializer("odin.graph", {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
        /*
         * What this particular frame held, asked of the frame itself.
         *
         * The editor hands back one empty panel per tab and says nothing about
         * which is which. The page wrote down its own reading while it was
         * alive, and that comes back attached to the frame — so a reader with
         * three changes open gets those three changes, in those three tabs,
         * rather than the most recent one and two closed tabs.
         *
         * Falling back to the last reading covers the frame written by a build
         * that predates this, which has no state of its own to offer.
         */
        const previous = readingIn(state) ?? session.last();
        if (!previous) {
          // Nothing worth reopening, and an empty frame says less than no
          // frame at all.
          panel.dispose();
          return;
        }
        // A frame the panel would not take is a duplicate of one already on
        // screen, and rebuilding the same review into it would redraw the graph
        // the reader is reading. It has been closed; there is nothing to reopen.
        const key = readingIn(state) ? keyOf(previous) : undefined;
        const took = await GraphPanel.adopt(panel, key);
        if (!took) return;

        if (key) {
          // Queued rather than started. Each of these is a diff read and every
          // reference in it followed, against one working copy — three at once
          // is three times the work and none of it finishing sooner. The frame
          // already carries the mark; the queue reaches it in a moment.
          reopen(previous, key);
          return;
        }

        await GraphPanel.showLoading(
          previous.number ? `Reopening #${previous.number}` : "Reopening the change",
        );

        /*
         * Not awaited, and that is the whole of the missing loader.
         *
         * The editor does not present a restored webview until this method's
         * promise settles — restoring is finished when the extension says it is
         * finished. Awaiting the build meant nine seconds of holding the frame
         * back, and every page written during them was written into something
         * the reader could not yet see. The loader was assigned, and reassigned
         * three times over, and never once painted; the graph appeared the
         * instant this returned, because it was simply the last page written.
         *
         * Every reading of the code said the loader was written, and every one
         * of them was right. What none of them could say was that nothing
         * written here goes on screen until this returns.
         *
         * So the frame is handed back now, with the mark already in it, and the
         * build carries on behind it. Its failures are the same failures they
         * were — `review` reports them itself — and there is nobody here left
         * to report them to.
         */
        void review(previous.baseRef, previous.headRef, previous.worktree === true);
      },
    }),
  );
}

/**
 * The reading a restored frame remembered, if it remembered one.
 *
 * Whatever the editor kept for a webview is whatever that webview last wrote,
 * so this is untrusted in the same way any stored value is: an older build
 * wrote something else here, and a corrupted one writes nothing at all. It is
 * checked rather than cast, and a frame that fails the check falls back to the
 * single remembered session — which is what every frame did before.
 */
function readingIn(state: unknown): Session | undefined {
  if (!state || typeof state !== "object") return undefined;
  /*
   * Under its own name in a slot it shares with the camera.
   *
   * The flat shape is what a page one version behind writes — the two used to
   * take turns overwriting each other in the same slot — and a frame that
   * carries it is still a frame that knows which reading it held.
   */
  const outer = state as Record<string, unknown>;
  const held =
    outer.reading && typeof outer.reading === "object"
      ? (outer.reading as Record<string, unknown>)
      : outer;
  if (typeof held.repo !== "string" || held.repo.length === 0) return undefined;

  const named = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  return {
    repo: held.repo,
    ...(named(held.baseRef) ? { baseRef: named(held.baseRef)! } : {}),
    ...(named(held.headRef) ? { headRef: named(held.headRef)! } : {}),
    ...(held.worktree === true ? { worktree: true } : {}),
    ...(typeof held.number === "number" ? { number: held.number } : {}),
    at: new Date().toISOString(),
  };
}

/**
 * Readings waiting to be rebuilt into the frames the editor handed back.
 *
 * One at a time and in the order the tabs arrived. Building them together
 * would mean several `git` reads of one repository racing each other for no
 * gain — the machine is the bottleneck, not the waiting — and the reader is
 * looking at exactly one of these tabs while the rest fill in behind it.
 */
const queued: { reading: Session; key: string }[] = [];
let reopening = false;

function reopen(reading: Session, key: string): void {
  queued.push({ reading, key });
  if (reopening) return;
  reopening = true;
  void (async () => {
    try {
      while (queued.length > 0) {
        const next = queued.shift()!;
        // The tab may have been closed in the seconds since the window came
        // back, which is an answer: there is nothing left to rebuild into.
        if (!GraphPanel.beginRestore(next.key)) continue;
        await GraphPanel.showLoading(
          next.reading.number
            ? `Reopening #${next.reading.number}`
            : "Reopening the change",
        );
        try {
          await review(
            next.reading.baseRef,
            next.reading.headRef,
            next.reading.worktree === true,
            undefined,
            next.reading.number,
          );
        } finally {
          GraphPanel.endRestore(next.key);
        }
      }
    } finally {
      reopening = false;
    }
  })();
}

/**
 * Opens a review from a link, e.g. `vscode://odin.odin-pr-review/review?base=main`.
 *
 * Useful for triggering a review from outside the editor — a script, a chat
 * message, a code-review checklist — without hunting through the palette.
 */
async function handleUri(uri: vscode.Uri): Promise<void> {
  if (!uri.path.startsWith("/review")) return;
  const base = new URLSearchParams(uri.query).get("base") ?? undefined;
  await review(base);
}

/**
 * What the list asks the forge for, which the reader can change.
 *
 * Open by default, because reviewing is what this is for. A change that has
 * already landed is read for a different reason — to see how something came to
 * be the way it is — and that is a question worth being able to ask.
 */
let asked: { state: "open" | "merged" | "closed" | "all"; author: string } = {
  state: "open",
  author: "",
};

/**
 * Fills the sidebar's chooser with whatever the forge answers.
 *
 * Best-effort and silent on failure: `gh` may be missing or signed out, and the
 * ability to review the branch you are on does not depend on it.
 */
async function refreshPullRequests(): Promise<void> {
  const repo = await repositoryRoot(true);
  if (!repo) return;

  sidebar.setLoading(true);
  try {
    const [answer, branch, me] = await Promise.all([
      listPullRequests({
        cwd: repo,
        state: asked.state,
        ...(asked.author ? { author: asked.author } : {}),
      }),
      currentBranch({ cwd: repo }),
      // Who is reading, so the list can lead with what is waiting on them.
      // Asked once per refresh and cached by the forge client.
      currentUser({ cwd: repo }).catch(() => undefined),
    ]);
    // Nothing at all is not the same as nothing matching: a forge that could not
    // be reached, or gave up, would otherwise be reported as "there are none".
    const pulls = answer ?? [];

    // What this machine has for those branches, so a change the reader has
    // work sitting on says so rather than offering to check out a copy that is
    // behind their own. Best-effort: the list is still a list without it.
    const local = await localBranches({
      cwd: repo,
      branches: pulls.map((pr) => pr.branch),
    }).catch(() => new Map<string, LocalBranch>());
    known.clear();
    for (const pull of pulls) known.set(pull.number, pull);
    localState = local;

    // A webview will not fetch a remote image, so each author's picture travels
    // inside the document. Best-effort and in parallel: a face that will not
    // load leaves an initial, and nothing waits on the network for long.
    await Promise.all(
      pulls.map(async (pr) => {
        if (!pr.avatarUrl) return;
        const data = await inlineAvatar(pr.avatarUrl).catch(() => undefined);
        if (data) pr.avatarUrl = data;
        else delete pr.avatarUrl;
      }),
    );
    sidebar.setPullRequests(
      pulls, branch ?? "", repo, me ?? "", answer !== undefined, local,
    );
  } finally {
    // Whatever happened, the bar stops: a progress bar that never ends says
    // the tool is still trying when it has given up.
    sidebar.setLoading(false);
  }
}

/**
 * Switches to a pull request's branch.
 *
 * Refuses outright when the working tree is dirty. `gh pr checkout` would
 * either fail halfway or carry the changes onto another branch, and neither is
 * something to do to someone's work without asking — the reviewer is better
 * placed to decide whether to commit or stash.
 */
/** Checkouts already running, so a second press does not start a second one. */
const switching = new Set<number>();

/**
 * The pull requests the list last fetched, by number.
 *
 * Kept so that pressing a row can act on what the forge said about it — whether
 * it is still open, which branch it targeted, where its head commit is — without
 * asking again and without the sidebar having to send it all back.
 */
const known = new Map<number, PullRequestSummary>();

/**
 * What this machine has for each branch the list mentions.
 *
 * Refreshed alongside the pull requests and kept here for the same reason they
 * are: pressing a row has to know whether the local copy is ahead without
 * asking git again while the reader waits.
 */
let localState = new Map<string, LocalBranch>();

/**
 * Reads a change as it is on this machine, without moving the working tree.
 *
 * The branch this checkout holds is read from the files on disk, so work that
 * has not been committed is part of the picture — which is the whole reason to
 * offer this reading rather than the forge's. A branch held somewhere else, or
 * nowhere, is read at its tip instead: there is no working tree here to take
 * uncommitted work from, and going and getting it would mean moving the reader
 * to another folder for what they asked to be a look.
 */
async function readLocal(number: number): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const pull = known.get(number);
  if (!pull) return;

  const local = localState.get(pull.branch);
  const here = local?.worktree === repo;
  if (here) {
    // The reader is on it. This checkout is the live reading of that branch.
    await review(pull.baseRef, undefined, true);
    return;
  }

  /*
   * A branch that is not the one this checkout holds, read live anyway.
   *
   * A live reading is of a working tree and a working tree holds one branch, so
   * the only honest way to have two at once is to have two working trees — and
   * that is a thing git does. A linked worktree is a second checkout of the
   * same repository with its own HEAD, and git refuses to put one branch in two
   * of them, which is what keeps several live readings from contradicting each
   * other.
   *
   * It costs a checkout of the branch on disk, so the reader is asked. Reading
   * the commits is the answer that costs nothing and is still a true picture of
   * what the forge has; the offer is for when what they want is the work in
   * progress.
   */
  const already = local?.worktree;
  const asked = await vscode.window.showInformationMessage(
    already
      ? `Odin: ${pull.branch} is checked out at ${already}.`
      : `Odin: ${pull.branch} is not checked out here.`,
    {
      modal: false,
      detail: already
        ? "Its uncommitted work lives there. Odin can read it from that checkout."
        : "Odin can add a checkout of it under .worktrees and read that, live.",
    },
    already ? "Read it there" : "Add a checkout",
    "Show its commits",
  );

  if (asked === "Show its commits" || asked === undefined) {
    await review(pull.baseRef, pull.branch, false, undefined, pull.number);
    return;
  }

  try {
    const checkout = await withProgressOn(
      `Preparing a checkout of ${pull.branch}`,
      () => readableCheckout(pull.branch, { cwd: repo }),
    );
    await review(pull.baseRef, undefined, true, checkout.path, pull.number);
  } catch (error) {
    /*
     * Every way this fails is worth saying rather than driving through: the
     * path is in the way, the repository is mid-rebase, the branch moved. None
     * of them is a reason to force a checkout over somebody's working tree.
     */
    vscode.window.showWarningMessage(
      `Odin: could not prepare a checkout of ${pull.branch} — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await review(pull.baseRef, pull.branch, false, undefined, pull.number);
  }
}

/** Runs something slow with the editor's own progress, and hands back its answer. */
async function withProgressOn<T>(title: string, run: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Odin: ${title}` },
    () => run(),
  );
}

/**
 * Reads a change as the forge has it, whatever this machine has done since.
 *
 * Fetched rather than checked out. The point of offering this next to the
 * local reading is to see what everyone else can see, and switching branches to
 * do it would mean the reader's own work had to be stashed for the privilege of
 * looking at someone else's — which is exactly the trade this avoids.
 */
async function readOrigin(number: number): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const pull = known.get(number);
  if (!pull) return;

  await GraphPanel.showLoading(`Fetching #${number}`);
  await git(["fetch", "--quiet", "origin", pull.branch], { cwd: repo })
    .catch(() => "");

  // The tracking ref by name rather than by commit, so the window, the viewed
  // marks and the page's title all say `origin/topic` instead of a hex string
  // nobody asked to read. The commit the forge named is the fallback, and may
  // already be here from an earlier fetch even when this one failed.
  const tracking = `origin/${pull.branch}`;
  const head = (await revision(repo, `refs/remotes/${tracking}`))
    ? tracking
    : pull.headSha && (await revision(repo, pull.headSha))
      ? pull.headSha
      : undefined;

  if (!head) {
    await GraphPanel.stopLoading(
      `Could not find origin/${pull.branch}. The forge may be unreachable.`,
    );
    vscode.window.showErrorMessage(
      `Odin: could not fetch origin/${pull.branch} for #${number}.`,
    );
    return;
  }

  await review(pull.baseRef, head, false, undefined, pull.number);
}

async function checkout(number: number): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  // A change that has already landed is read, not checked out: there is nothing
  // to work on, usually no branch left to work on it with, and switching the
  // working tree to look at history is a large price for a look.
  const finished = known.get(number);
  if (finished && finished.state && finished.state !== "open") {
    await readFinished(finished);
    return;
  }

  // Pressing twice is easy: the list does not change until the switch is done,
  // so the row still looks unvisited while git is halfway through moving.
  if (switching.has(number)) return;

  const dirty = (await git(["status", "--porcelain"], { cwd: repo })).trim();
  if (dirty) {
    const count = dirty.split("\n").length;
    vscode.window.showWarningMessage(
      `Odin: ${count} uncommitted change${count === 1 ? "" : "s"} in this ` +
        `worktree. Commit or stash before switching to #${number}.`,
    );
    return;
  }

  // A branch cannot be checked out twice, and a repository with worktrees very
  // often has this one open elsewhere. Git says so in a sentence about locks
  // and exit codes; the useful answer is where it is, and an offer to go there.
  const open = (await listPullRequests({ cwd: repo }).catch(() => [])) ?? [];
  const pull = open.find((p) => p.number === number);

  // Already here. Switching to the branch you are on is a no-op that still
  // costs a fetch and a working-tree check, and saying nothing about it makes
  // the button look broken.
  const here = await currentBranch({ cwd: repo }).catch(() => undefined);
  if (pull && here && here === pull.branch) {
    vscode.window.showInformationMessage(
      `Odin: already on ${pull.branch} — showing #${number}.`,
    );
    await review();
    return;
  }

  const elsewhere = pull ? await worktreeFor(pull.branch, { cwd: repo }) : undefined;
  if (elsewhere && elsewhere !== repo) {
    const go = "Open That Folder";
    const answer = await vscode.window.showWarningMessage(
      `Odin: #${number} is already checked out at ${elsewhere}.`,
      { modal: false, detail: "A branch can only be checked out once." },
      go,
    );
    if (answer === go) {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(elsewhere),
        { forceNewWindow: true },
      );
    }
    return;
  }

  switching.add(number);
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Odin: checking out #${number}` },
      async () => {
        // The graph on screen belongs to the branch being left, so it goes now
        // rather than sitting there looking current while git moves under it.
        await GraphPanel.showLoading(`Checking out #${number}`);
        try {
          await gh(["pr", "checkout", String(number)], repo);
        } catch (error) {
          const said = error instanceof Error ? error.message : String(error);
          const branch = known.get(number)?.branch ?? pull?.branch;

          // The common failure is not a broken repository: it is a local branch
          // that has moved somewhere the forge's copy has not. `gh` switches to
          // it, cannot fast-forward, and stops — leaving the reader on a branch
          // that is not the change they asked to see.
          const diverged =
            /not possible to fast-forward|diverging branches|non-fast-forward/i.test(said);
          if (!branch || !diverged || !(await reconcile(repo, number, branch))) {
            vscode.window.showErrorMessage(
              `Odin: could not check out #${number}. ${said}`,
            );
            await GraphPanel.stopLoading(`Could not check out #${number}.`);
            return;
          }
        }
        await refreshPullRequests();
        await review();
      },
    );
  } finally {
    switching.delete(number);
  }
}

/**
 * Reads a pull request that is no longer being worked on.
 *
 * A merged or closed change has usually lost its branch, so there is nothing to
 * check out and nothing to check out *to* — the reader is not going to push to
 * it. The forge keeps the head commit reachable under `refs/pull/<n>/head`
 * whatever happened to the branch, so it is fetched and read where it lies,
 * against the point it forked from. The working tree is never touched.
 */
/**
 * Brings a change onto this machine and then follows it.
 *
 * `checkout` does the moving and everything that has to be said about it: a
 * dirty tree, a branch some other checkout holds, a local copy that has
 * wandered from the forge's. What it does not do is decide what to read
 * afterwards, and after a deliberate checkout the answer is the files on disk.
 */
async function checkoutLocal(number: number): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const before = await currentBranch({ cwd: repo }).catch(() => undefined);
  await checkout(number);

  // Only if it actually moved. `checkout` reports its own failures, and reading
  // the working tree of a branch the reader was refused is reading the wrong
  // change with no sign that anything went wrong.
  const now = await currentBranch({ cwd: repo }).catch(() => undefined);
  const wanted = known.get(number)?.branch;
  if (!now || (wanted && now !== wanted) || (!wanted && now === before)) return;

  await review(undefined, undefined, true);
}

async function readFinished(pull: PullRequestSummary): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  await GraphPanel.showLoading(`Fetching #${pull.number}`);
  try {
    await git(["fetch", "--quiet", "origin", `refs/pull/${pull.number}/head`], {
      cwd: repo,
    });
  } catch {
    // Older forges and some mirrors do not publish that ref. The head commit
    // may still be here from when the branch was.
  }

  const head = pull.headSha ?? (await revision(repo, "FETCH_HEAD"));
  if (!head) {
    await GraphPanel.stopLoading(
      `Could not find the commits for #${pull.number}. The forge may not publish ` +
        `them any more.`,
    );
    return;
  }

  // Where it forked from, so the diff is what this change did rather than
  // everything that has happened on the base branch since.
  const base = pull.baseRef
    ? await revision(repo, `origin/${pull.baseRef}`) ?? pull.baseRef
    : undefined;
  const forked = base ? await mergeBase(repo, base, head) : undefined;

  await review(forked ?? base, head);
}

/** A ref's commit, or nothing when this checkout has never heard of it. */
async function revision(repo: string, ref: string): Promise<string | undefined> {
  const sha = (await git(["rev-parse", "--verify", "--quiet", ref], { cwd: repo })
    .catch(() => "")).trim();
  return sha || undefined;
}

async function mergeBase(
  repo: string,
  base: string,
  head: string,
): Promise<string | undefined> {
  const sha = (await git(["merge-base", base, head], { cwd: repo })
    .catch(() => "")).trim();
  return sha || undefined;
}

/**
 * A local branch that has wandered away from the forge's copy of it.
 *
 * `gh pr checkout` switches to the branch and then refuses to fast-forward,
 * which leaves the reader standing on a branch that is not the change they
 * asked for and a message about merge strategies they did not ask about. The
 * repository is not broken; the two copies simply disagree.
 *
 * What to do about it is the reader's decision and nobody else's, because the
 * cheap answer throws away commits. So this says exactly what is on each side
 * and offers to make the local copy match the forge — with the option of
 * parking what is here on a branch of its own first, which costs nothing and
 * makes the discarding undoable.
 *
 * Returns whether the branch now matches the forge.
 */
async function reconcile(
  repo: string,
  number: number,
  branch: string,
): Promise<boolean> {
  const remote = `origin/${branch}`;
  // `gh` has already fetched, but it may have failed before doing so.
  await git(["fetch", "--quiet", "origin", branch], { cwd: repo }).catch(() => "");

  const counts = (await git(
    ["rev-list", "--left-right", "--count", `${remote}...HEAD`],
    { cwd: repo },
  ).catch(() => "")).trim().split(/\s+/);
  const behind = Number(counts[0] ?? 0);
  const ahead = Number(counts[1] ?? 0);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead) || ahead + behind === 0) {
    return false;
  }

  // Anything uncommitted would go with the reset, and losing that is a
  // different and much worse thing than losing a commit.
  const dirty = (await git(["status", "--porcelain"], { cwd: repo })).trim();
  if (dirty) {
    vscode.window.showWarningMessage(
      `Odin: ${branch} has diverged from the forge, and this worktree has ` +
        `uncommitted changes. Commit or stash them first.`,
    );
    return false;
  }

  const mine = `${ahead} commit${ahead === 1 ? "" : "s"} here that the forge does not have`;
  const theirs = `${behind} commit${behind === 1 ? "" : "s"} on the forge that this branch does not`;
  const keep = "Back Up, Then Reset";
  const reset = "Reset to the Forge";

  const answer = await vscode.window.showWarningMessage(
    `Odin: ${branch} has diverged from ${remote}.`,
    {
      modal: true,
      detail:
        `There ${ahead === 1 ? "is" : "are"} ${mine}, and ${theirs}.\n\n` +
        `Resetting makes this branch exactly what the forge has, which is what ` +
        `#${number} shows. The ${ahead === 1 ? "commit" : "commits"} here would ` +
        `be left behind — backing up first keeps ${ahead === 1 ? "it" : "them"} ` +
        `on a branch of their own.`,
    },
    keep,
    reset,
  );
  if (answer !== keep && answer !== reset) return false;

  if (answer === keep) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
    const parked = `odin-backup/${branch}-${stamp}`;
    try {
      await git(["branch", parked], { cwd: repo });
      vscode.window.showInformationMessage(`Odin: kept your commits on ${parked}.`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: could not create ${parked}, so nothing was reset. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  try {
    // The branch `gh` left us on is the one to reset; if it left us elsewhere,
    // go there first rather than resetting whatever happens to be checked out.
    const here = await currentBranch({ cwd: repo }).catch(() => undefined);
    if (here !== branch) await git(["switch", branch], { cwd: repo });
    await git(["reset", "--hard", remote], { cwd: repo });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Odin: could not reset ${branch}. ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }

  return true;
}

function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      // The editor's PATH is not a shell's; see forgeEnv.
      { cwd, env: forgeEnv(), encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export function deactivate(): void {
  // Temporary checkouts are removed as they are used. The watchers are the one
  // thing here that outlives a command, so they are what there is to put away.
  for (const watcher of live.values()) watcher.dispose();
  live.clear();
  for (const watcher of localWatch.values()) watcher.dispose();
  localWatch.clear();
  forgetBase();
}

/**
 * Builds a graph and shows it.
 *
 * `worktree` reads the change from the files on disk rather than from the last
 * commit, which is only meaningful for the branch this checkout holds — it is
 * ignored alongside a `headRef` naming anything else.
 */
async function review(
  baseRef?: string,
  headRef?: string,
  worktree = false,
  /**
   * Which checkout to read, when it is not the one the window is open on.
   *
   * A live reading is of a working tree, so reading a second branch live means
   * reading a second working tree — a linked worktree, with its own HEAD. It is
   * a repository root like any other from here down: its own reading, its own
   * watcher, its own tab.
   */
  at?: string,
  /**
   * Which pull request this is, when the caller already knows.
   *
   * Only used when a ref cannot be found. A branch is deleted the moment its
   * change merges, so a reading of one asks for a ref the forge no longer has —
   * and the forge still keeps the head it merged, under `refs/pull/<n>/head`.
   * Reaching that needs the number, and the number is on the reading rather
   * than in anything a signed-out `gh` could tell us.
   */
  is?: number,
): Promise<void> {
  const repo = at ?? (await repositoryRoot());
  if (!repo) return;

  const settings = vscode.workspace.getConfiguration("odin");
  // Asked for, as opposed to merely configured. Only the first overrules what
  // the forge says this change is a change to.
  const base = baseRef ?? undefined;
  // This reader's own answer first, then the workspace's stored preference.
  // Neither overrules the pull request; both beat guessing.
  const fallback =
    chosenBase.read() ?? settings.get<string>("baseRef") ?? undefined;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Odin" },
    async (progress) => {
      /*
       * Reading a diff, resolving its references and laying them out is several
       * seconds on a large change. The mark says so in the panel the reviewer
       * is watching, not only in a notification in the corner.
       *
       * Named, so it says it in the panel this reading is in. Unnamed it went
       * to whichever was in front, which put a loader over a review that had
       * finished loading — and left it there, because the graph that would have
       * replaced it belonged to a different tab.
       */
      await GraphPanel.showLoading(
        "Reading the change",
        keyOf({
          repo,
          ...(base ? { baseRef: base } : {}),
          ...(headRef ? { headRef } : {}),
          ...(worktree ? { worktree: true } : {}),
        }),
      );
      try {
        /*
         * Which surface the progress belongs on.
         *
         * Before there is anything to look at, it is the waiting page's own
         * line — that is what the mark is for. Once the cards are up the loader
         * is gone and `note` speaks to nobody, so the same words go to the
         * badge in the corner instead, which is where the reader is already
         * being told the picture is still being worked out.
         */
        let drawn = false;
        /*
         * One number for the whole build, rather than a note per phase.
         *
         * Every phase said what it was doing and only one of them could say how
         * far along it was, so a large change showed a note that sat still for
         * six seconds, a percentage that ran to a hundred, then another note
         * that sat still for three — none of which a reader can tell from the
         * thing having stopped.
         */
        const step = new Progress(({ note, percent }) => {
          const said = `${note}… ${percent}%`;
          progress.report({ message: said, increment: undefined });
          // Drawn but not finished is the first build's second half, which the
          // page covers over rather than mentioning in a corner.
          if (drawn) GraphPanel.setRefreshing(true, said, { percent });
          else GraphPanel.note(said, percent);
        });
        /*
         * What is being read, settled once and for the whole build.
         *
         * Each stage of the build worked this out for itself, and the way it
         * works it out when nobody has said is to ask the checkout what branch
         * it is on. A change is drawn in two passes — the cards as soon as the
         * diff is read, the arrows when they are resolved — and the panel a
         * pass lands in is found by a key made of the branch names. So a
         * checkout that moved between the two passes gave two different keys,
         * the second pass found no panel under its own, and opened another.
         *
         * Which is every remote pull request. Opening one fetches, and may add
         * a worktree or check the branch out, in between. The reader asked for
         * one change and got two tabs, one of them showing the half-built
         * picture the first pass had drawn.
         */
        const head = worktree
          ? "HEAD"
          : headRef ?? (await currentBranch({ cwd: repo })) ?? "HEAD";

        const request = {
          cwd: repo,
          ...(base ? { baseRef: base } : {}),
          ...(fallback ? { fallbackBaseRef: fallback } : {}),
          headRef: head,
          ...(worktree ? { worktree: true } : {}),
          includeImports: settings.get<boolean>("includeImports", true),
          includeContext: settings.get<boolean>("includeContext", false),
          progress: step,
          /*
           * Kept for the phases that say something a percentage cannot — a ref
           * being fetched, a checkout being made — and silent otherwise, since
           * the same words now arrive with a number attached.
           */
          report: () => {},
        };

        /*
         * The diff first, the references after.
         *
         * Reading the patch is a tenth of a second; following every reference
         * in it is several, and it is the whole of the wait on a change of any
         * size. Opening a review used to show nothing for all of it — and what
         * the reader came to see, the code, was ready almost immediately.
         *
         * So the cards go up as soon as the diff is read and the arrows arrive
         * when they are known. The corner keeps saying it is working, now with
         * how far through it is, because a picture that looks finished and is
         * not is worse than one that says so.
         */
        const staged = await stageGraphForRepo(request);
        const built = staged.first;
        const graph = built.graph;

        progress.report({ message: "colouring" });
        const reading = await present(built, repo, base, headRef, false, step);
        drawn = true;

        // The expensive half, over the picture the reader already has. The
        // badge says the arrows are still being worked out; without it a change
        // would look unconnected rather than unfinished.
        let final = built;
        if (staged.rest) {
          GraphPanel.setRefreshing(true, "Resolving references…");
          try {
            final = await staged.rest();
            await present(final, repo, base, headRef, false, step);
          } finally {
            GraphPanel.setRefreshing(false);
          }
        }

        // A reading of the working tree goes stale the moment the reader
        // touches a file, which they are about to. Nothing else does.
        // Named by the reading it belongs to, so standing another one up
        // beside it leaves this one watching.
        armLive(repo, base, headRef, final, reading);
        // And, for a reading of commits, whether the files underneath it have
        // moved on since. The two never both apply.
        watchForLocalWork(repo, base, headRef, final, reading);
      } catch (error) {
        await GraphPanel.stopLoading(
          error instanceof Error ? error.message : String(error),
        );
        await reportFailure(repo, error, { baseRef, headRef, worktree, at, is });
      }
    },
  );
}

/**
 * Puts a built graph on screen.
 *
 * Split out of `review` because it is also the whole of a hot reload: the
 * chrome around it — the notification, the pulsing mark, the "reading the
 * change" — belongs to a review someone asked for. A redraw provoked by the
 * reader saving a file is not something they asked for, and announcing it that
 * loudly every few seconds would be worse than not doing it.
 */
async function present(
  built: Awaited<ReturnType<typeof buildGraphForRepo>>,
  repo: string,
  base: string | undefined,
  headRef?: string,
  /**
   * A redraw of a change already on screen, rather than the first sight of one.
   *
   * The grammars and the editor's theme are the same as they were a second ago
   * — nothing about saving a file changes either — and re-reading them costs
   * more than everything else this function does put together. The panel keeps
   * the highlighter it already has.
   */
  quick = false,
  /**
   * The build reporting itself, when this is a review somebody asked for.
   *
   * Absent for a redraw provoked by a save: nothing about that is announced,
   * so there is nobody to report to.
   */
  step?: Progress,
  /**
   * Which reading this is, as the caller knows it.
   *
   * A watcher belongs to a reading and so does its rebuild. The name is passed
   * rather than worked out again here because the two ways of naming a reading
   * — the refs as asked for, the refs as resolved — do not always agree, and
   * the panel is registered under whichever the reader's own page wrote down.
   */
  where?: string,
): Promise<void> {
  const { graph, shown, layout, layoutWithTests, unifiedLayout, unifiedWithTests } = built;

  viewed.open(repo, graph.meta.baseRef, graph.meta.headRef);
  // What is being read, so the list can say later when it has moved on.
  if (graph.meta.pullRequest && graph.meta.headSha) {
    seen.mark(
      repo,
      graph.meta.pullRequest.number,
      graph.meta.headSha,
      new Date().toISOString(),
    );
  }

  // Loaded before the first paint. Colouring the code a beat after it appears
  // would redraw the whole page and take the reviewer's scroll position with
  // it.
  const theme = quick ? undefined : await activeTheme();
  const highlight = quick
    ? undefined
    : await loadHighlighter(
        graph.nodes.map((n) => n.language ?? "plaintext"),
        { dark: isDark(), ...(theme ? { theme } : {}) },
      );

  /*
   * Coloured here, a file at a time, rather than inside the document build.
   *
   * It is two thirds of building the document and it is one synchronous
   * stretch — two and a half seconds on a change of a hundred and thirty files,
   * during which the extension host answers nobody, including the progress it
   * is reporting. Split by file it is the same work in pieces short enough that
   * the editor stays awake, and it is the last phase that can say how far along
   * it is.
   */
  if (highlight) {
    step?.begins("colour");
    await paintRows(layout, highlight, (done, total) => step?.within(done, total));
  }

  // The list follows whichever part the panel is showing.
  GraphPanel.onPart = (paths) => sidebar.setPart(paths);

  const pull = graph.meta.pullRequest;

  /*
   * A redraw the page can apply to itself, when there is a page to apply it.
   *
   * Everything below this belongs to a review someone asked for. A hot reload
   * asked for none of it: the checks are already being polled, the comments
   * cannot have changed because a file was saved, and both of them end in
   * another full render — so a single save was paying for two documents, a
   * `gh` call for the remarks, another for who the reader is, and one more
   * checks poller than the last save left running.
   */
  if (quick) {
    const took = GraphPanel.reload(
      shown, layout, repo, layoutWithTests, viewed,
      { layout: unifiedLayout, withTests: unifiedWithTests },
      built.redrawn,
      built.withdrawn,
      where,
    );
    if (took) {
      sidebar.setGraph(graph);
      return;
    }
  }

  const panel = GraphPanel.show(
    shown, layout, repo, layoutWithTests, viewed, highlight,
    { layout: unifiedLayout, withTests: unifiedWithTests },
  );

  // Fetched after the graph is on screen: the picture is the point, and
  // waiting on the forge before showing it would be the wrong order.
  if (pull) panel.watchChecks(graph.meta.headRef, repo);
  if (pull) {
    // The comments and their conversations, which the forge answers apart: one
    // request knows the bodies and the other knows which of them are one thread
    // and whether anybody has settled it.
    void Promise.all([
      listReviewComments(pull.number, { cwd: repo }),
      listReviewThreads(pull.number, { cwd: repo }).catch(
        () => new Map<number, { threadId: string; resolved: boolean }>(),
      ),
    ])
      .then(([found, threads]) => stampThreads(found, threads))
      .then((found) => inlineAvatars(found).catch(() => found))
      .then((comments) => {
        if (comments.length > 0) panel.setComments(comments);
      });
  }
  sidebar.setGraph(graph);
  last = {
    repo,
    ...(base ? { baseRef: base } : {}),
    ...(headRef ? { headRef } : {}),
    ...(graph.meta.worktree ? { worktree: true } : {}),
  };
  // What to come back to. Recorded from what was actually shown rather than
  // from what was asked for: the base may have been detected, and a reload
  // that reopened a different change from the one on screen would be worse
  // than one that reopened nothing.
  session.remember({
    repo,
    ...(base ? { baseRef: base } : {}),
    ...(headRef ? { headRef } : {}),
    ...(graph.meta.worktree ? { worktree: true } : {}),
    ...(pull ? { number: pull.number } : {}),
  });

  return panel.reading;
}

/**
 * When the forge was last asked anything, so it is not asked constantly.
 *
 * Focus arrives on every alt-tab, and somebody moving between an editor and a
 * terminal generates dozens a minute. What is being guarded is not the cost to
 * this machine but a shared rate limit: `gh` is the same allowance the sidebar,
 * the checks and the comments all draw on.
 */
let lastAsked = 0;

/** How long an answer from the forge is worth keeping without asking again. */
const STALE_AFTER = 120_000;

/**
 * Asks the forge for everything that could have moved while nobody was looking.
 *
 * The list of pull requests, this review's own standing, and its checks. None
 * of it touches the diff: the change on screen is still the change, and
 * rebuilding it would take the reader's place on the page away for news that
 * belongs in the bar.
 */
async function refreshStale(): Promise<void> {
  const now = Date.now();
  if (now - lastAsked < STALE_AFTER) return;
  lastAsked = now;
  await Promise.all([
    refreshPullRequests(),
    GraphPanel.refreshStale(),
  ]).catch(() => undefined);
}

/**
 * Watchers, by the reading each belongs to.
 *
 * One per window used to be enough, because one reading was. With several open
 * at once a single slot is worse than a missing feature: opening a second
 * change would tear down the first one's watching on its way past, and what the
 * reader sees is a graph that has quietly stopped following their edits with
 * nothing having gone wrong.
 *
 * Only a reading of the working tree is ever watched — the forge's copy of a
 * change does not move while it is being looked at — so this rarely holds more
 * than one. It is a map because *which* reading owns the watcher matters, not
 * because there are many.
 */
const live = new Map<string, LiveGraph>();

/**
 * Points the watcher at whatever is now on screen, or puts it away.
 *
 * One at a time: opening a second review while the first is being watched
 * would leave two watchers rebuilding two graphs into one panel, and the
 * slower of them would win.
 */
/**
 * Watching a committed reading for work that has not been committed.
 *
 * A reading of commits does not change when the reader edits a file — that is
 * what makes it a reading of commits — so nothing about it can say that the
 * files underneath it have moved on. Somebody restores a stash and goes on
 * reading a picture of the branch as the forge has it, which is now a picture
 * of something else, with nothing anywhere saying so.
 *
 * The live reading exists for exactly that and has to be asked for. So this
 * says when it would be worth asking for, once, and then stays quiet.
 */
const localWatch = new Map<string, LiveGraph>();

function watchForLocalWork(
  repo: string,
  base: string | undefined,
  headRef: string | undefined,
  built: Awaited<ReturnType<typeof buildGraphForRepo>> | undefined,
  key: string,
): void {
  // This reading's own, like the live watcher: two committed readings both want
  // to know when the files underneath them move, and neither should silence the
  // other by being opened second.
  localWatch.get(key)?.dispose();
  localWatch.delete(key);

  const shown = built?.graph;
  // A live reading already shows this work; there is nothing to offer.
  if (!shown || shown.meta.worktree === true) return;

  const settings = vscode.workspace.getConfiguration("odin");
  if (!settings.get<boolean>("liveReload", true)) return;

  /*
   * What the tree looked like when this reading went up.
   *
   * Read before the watcher is armed, not from inside it. Taking the first
   * event as the baseline sounds harmless and swallows precisely the change
   * worth reporting: somebody restores a stash, the first file lands, and it is
   * recorded as "how things were" rather than as news. Nothing is offered until
   * a second change arrives, and for a stash of one file nothing ever is.
   *
   * Compared against rather than tested for emptiness, because a reader who
   * opened a committed reading with work already in progress said, by opening
   * it, that this is the picture they want.
   */
  void uncommittedCount({ cwd: repo }).then((atFirst) => {
    if (localWatch.has(key)) return;
    let before = atFirst;
    /** Asked and declined; not asked again until the tree is clean once more. */
    let refused = false;

    const watching = new LiveGraph({
      repo,
      rebuild: async () => {
        const now = await uncommittedCount({ cwd: repo });
        if (now === 0) {
          // Committed, stashed again or reverted. Whatever was offered and
          // turned down is no longer the same offer.
          before = 0;
          refused = false;
          return undefined;
        }
        if (now <= before || refused) return undefined;

        before = now;
        const files = now === 1 ? "1 file" : `${now} files`;
        const answer = await vscode.window.showInformationMessage(
          `Odin: ${files} changed on disk that this reading does not show.`,
          "Show local changes",
        );
        if (answer !== "Show local changes") {
          refused = true;
          return undefined;
        }
        // The same change read the other way, not a second tab of it.
        GraphPanel.promoting = key;
        await review(base, headRef, true);
        return undefined;
      },
      onChange: () => {},
    });
    localWatch.set(key, watching);
  });
}

function armLive(
  repo: string,
  base: string | undefined,
  headRef: string | undefined,
  built: Awaited<ReturnType<typeof buildGraphForRepo>> | undefined,
  key: string,
): void {
  // This reading's own watcher, and only this one. Standing the graph up again
  // replaces it; standing a different one up leaves it alone.
  live.get(key)?.dispose();
  live.delete(key);

  const shown = built?.graph;
  if (!shown || shown.meta.worktree !== true) return;

  const settings = vscode.workspace.getConfiguration("odin");
  if (!settings.get<boolean>("liveReload", true)) return;

  /*
   * The change graph as it stands, carried from one rebuild to the next.
   *
   * This is what makes a redraw cheap. Held here rather than recomputed
   * because almost none of it can have changed: the arrows, the vertices the
   * resolvers invented, the blobs behind every gap and the forge's own facts
   * are all still true after somebody edits a line, and working them out again
   * is the several seconds that made saving a file feel like the graph had
   * stopped updating.
   */
  let known: Awaited<ReturnType<typeof buildGraphForRepo>> | undefined = built;
  /** Held from the rebuild to the report: what goes on screen is the build. */
  let fresh: Awaited<ReturnType<typeof buildGraphForRepo>> | undefined;

  const watcher = new LiveGraph({
    repo,
    // The repository root is very often not what the editor has open — a
    // reader working on the front end of a monorepo opens that folder, and the
    // root is its parent. Both are asked for; the editor is certain about the
    // one it opened.
    roots: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    rebuild: async () => {
      const request = {
        cwd: repo,
        ...(base ? { baseRef: base } : {}),
        ...(headRef ? { headRef } : {}),
        worktree: true,
        includeImports: settings.get<boolean>("includeImports", true),
        includeContext: settings.get<boolean>("includeContext", false),
      };
      // What the next rebuild is judged and shortcut against. Taken from
      // whichever answer was last delivered, and dropped outright if the
      // expensive half fails: the provisional graph is missing arrows on
      // purpose, and treating it as the truth would make them missing for good.
      const staged = await stageGraphForRepo(request, known);
      fresh = staged.first;
      known = staged.first;
      if (!staged.rest) return { graph: staged.first.graph };

      return {
        graph: staged.first.graph,
        rest: async () => {
          try {
            fresh = await staged.rest!();
            known = fresh;
            return fresh.graph;
          } catch (error) {
            known = undefined;
            throw error;
          }
        },
      };
    },
    // Said in the frame this watcher belongs to. The reader may be reading
    // something else by now, and a rebuild of what they left is not news about
    // what they are looking at.
    onRebuilding: (files) =>
      GraphPanel.setRefreshingIn(
        shown,
        repo,
        true,
        `Rebuilding — ${files} file${files === 1 ? "" : "s"} changed`,
      ),
    // Cleared whatever came of it, including a rebuild that found nothing
    // worth redrawing. A spinner left running says the tool is still working
    // when it has finished and decided there was nothing to do.
    onSettled: () => GraphPanel.setRefreshingIn(shown, repo, false),
    onChange: async (_graph, delta) => {
      if (!fresh) return;
      await present(fresh, repo, base, headRef, true, undefined, key);
      // In the status bar rather than a notification: this happens every time
      // the reader saves, and a toast per save is a reason to turn the whole
      // thing off. It says what moved, then goes away on its own.
      vscode.window.setStatusBarMessage(`Odin: ${describeDelta(delta)}`, 4000);
    },
    onError: (error) => {
      // Said once, quietly. A watcher that pops an error dialog on every
      // broken intermediate state — which is most keystrokes — is unusable.
      vscode.window.setStatusBarMessage(
        `Odin: could not rebuild — ${error instanceof Error ? error.message : String(error)}`,
        6000,
      );
    },
  });
  // What the next rebuild is judged against. Without it the first rebuild has
  // nothing to compare to, reports no change, and the watcher looks broken
  // exactly once — on the first edit, which is the one being watched for.
  watcher.seed(shown);
  live.set(key, watcher);
}

/**
 * The ref a git failure is complaining about, when it names one.
 *
 * `fatal: Not a valid object name origin/luis/lab-147` is a sentence with the
 * answer in it, and every layer above this used to throw that answer away and
 * report "could not find the base branch" — which for a missing *head* is not
 * merely unhelpful but wrong, and sends the reader off to pick a base that was
 * never the problem.
 */
function missingRef(message: string): string | undefined {
  const named = /Not a valid object name ([^\s]+)/.exec(message);
  if (named) return named[1];
  const unknown = /unknown revision or path not in the working tree.*?'([^']+)'/s.exec(message);
  return unknown?.[1];
}

/**
 * Turns a failed review into something actionable.
 *
 * Two failures, and they want different answers. A base that does not exist in
 * this checkout — a worktree with no local `main`, a repository that still uses
 * `master` — is a question for the reader, and the branch list is the way to
 * ask it. A *head* that does not exist is usually not a question at all: it is
 * a tracking ref this checkout has never fetched, and fetching it is the whole
 * of the fix.
 */
async function reportFailure(
  repo: string,
  error: unknown,
  asked?: {
    baseRef?: string;
    headRef?: string;
    worktree?: boolean;
    at?: string;
    is?: number;
  },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const missing = missingRef(message);

  /*
   * A ref this checkout has not got, fetched and tried again.
   *
   * The case that provoked this: a reading of the forge's copy of a change,
   * restored after a window reload into a checkout that had never fetched that
   * branch. What the reader got was a raw `git merge-base` failure and an offer
   * to pick a base branch, for a head ref nobody had asked them about.
   *
   * Only for a ref that names a remote, and only once. A missing local branch
   * is not something a fetch can conjure, and a second failure after a fetch is
   * a real answer rather than a race.
   */
  const remote = missing && /^([\w.-]+)\/(.+)$/.exec(missing);
  if (remote && asked && missing !== asked.baseRef) {
    const [, name, branch] = remote;
    /*
     * The branch first, and then the pull request's own copy of it.
     *
     * A branch is deleted the moment its change is merged, on most projects
     * automatically — so a reading of a change that has landed asks for a ref
     * the forge no longer has, and `git fetch origin <branch>` answers
     * "couldn't find remote ref". The change itself is not gone: a forge keeps
     * the head it was merged from under `refs/pull/<n>/head`, which is exactly
     * what a reader coming back to a merged review wants to see.
     *
     * Written into the tracking ref it was looking for, so everything
     * downstream — the diff, the title, the marks stored against the reading —
     * goes on calling it what the reader calls it.
     */
    /*
     * The number, from the reading rather than from the forge.
     *
     * It used to be looked up in the list of open pull requests, which is only
     * populated when `gh` is signed in — and a reader whose `gh` is signed out
     * is exactly the reader who cannot fetch a deleted branch any other way. A
     * restored reading carries its own number; it was written down when the
     * reading was made.
     */
    const number =
      asked.is ?? [...known.values()].find((one) => one.branch === branch)?.number;
    const fetched = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Odin: fetching ${missing}` },
      async () => {
        const first = await git(["fetch", "--quiet", name!, branch!], { cwd: repo })
          .then(() => undefined)
          .catch((why: unknown) => (why instanceof Error ? why.message : String(why)));
        if (first === undefined) return undefined;
        if (!number) return first;

        return git(
          [
            "fetch",
            "--quiet",
            name!,
            `refs/pull/${number}/head:refs/remotes/${name}/${branch}`,
          ],
          { cwd: repo },
        )
          .then(() => undefined)
          .catch(() => first);
      },
    );
    if (fetched === undefined) {
      await review(
        asked.baseRef,
        asked.headRef,
        asked.worktree === true,
        asked.at,
        asked.is,
      );
      return;
    }
    /*
     * Git's own words, because "fetching it failed" is the one thing the reader
     * already knows.
     *
     * Node puts the command on the first line of the error and git's reason on
     * the ones after it, so taking the first line hands back the command that
     * was run and none of why it did not work — "couldn't find remote ref" is
     * the whole of the answer, and it was being cut off.
     */
    const why =
      fetched
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("Command failed:")) ?? fetched;

    /*
     * Said in full, and then the tab goes.
     *
     * This is the end of the line: the ref is not here, the forge does not have
     * the branch any more, and either there is no pull request to reach its
     * head through or that failed too. No retry helps and no button would, so a
     * frame left open on a git error is a tab that looks like a review, opens
     * like a review, and can never be one — and the reader is left to work out
     * that closing it is the only thing to do.
     */
    const gone = /couldn't find remote ref|not found|does not appear to be a git repo/i.test(
      why,
    );
    vscode.window.showErrorMessage(
      gone
        ? `Odin: ${missing} is not on the remote any more${
            number ? ` and #${number}'s head could not be fetched` : ""
          }. There is nothing left to read, so this tab is closing.`
        : `Odin: ${missing} is not in this checkout — ${why.replace(/^fatal:\s*/, "")}. ` +
          "This tab is closing.",
    );
    GraphPanel.abandon(
      keyOf({
        repo,
        ...(asked.baseRef ? { baseRef: asked.baseRef } : {}),
        ...(asked.headRef ? { headRef: asked.headRef } : {}),
        ...(asked.worktree ? { worktree: true } : {}),
      }),
    );
    return;
  }

  const missingBase =
    message.includes("no base branch found") ||
    (missing !== undefined && (!asked || missing === asked.baseRef));

  if (!missingBase) {
    vscode.window.showErrorMessage(`Odin: ${message}`);
    return;
  }

  const choice = await vscode.window.showErrorMessage(
    "Odin: could not find the base branch to compare against.",
    "Pick a branch",
  );
  if (choice !== "Pick a branch") return;

  const picked = await vscode.window.showQuickPick(await listBranches(repo), {
    title: "Review against which base?",
    placeHolder: "The diff is taken from the merge base, not the branch tip",
  });
  if (!picked) return;

  /*
   * Remembered here, not in the workspace's settings.
   *
   * That is where this used to go, and `.vscode/settings.json` is a file most
   * repositories commit — so one person answering this question once wrote a
   * permanent instruction for everybody who cloned it. Months later it is still
   * choosing the base for changes it has nothing to do with, and what that
   * looks like is other people's merged work inside your branch rather than a
   * setting anybody would think to look at.
   */
  await chosenBase.write(picked);
  await review(picked);
}

/** Lets a reviewer compare against something other than the configured base. */
async function reviewAgainst(): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const branches = await listBranches(repo);
  const picked = await vscode.window.showQuickPick(branches, {
    title: "Review against which base?",
    placeHolder: "The diff is taken from the merge base, not the branch tip",
  });
  if (picked) await review(picked);
}

async function exportGraph(): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const settings = vscode.workspace.getConfiguration("odin");
  const { graph } = await buildGraphForRepo({
    cwd: repo,
    // The stored preference, not a request: the pull request's own base beats
    // it, the same way it does everywhere else.
    ...(settings.get<string>("baseRef")
      ? { fallbackBaseRef: settings.get<string>("baseRef")! }
      : {}),
    includeImports: settings.get<boolean>("includeImports", true),
    includeContext: settings.get<boolean>("includeContext", false),
  });

  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: serializeGraph(graph),
  });
  await vscode.window.showTextDocument(document);
}

/**
 * The repository containing the active file, falling back to the first
 * workspace folder. Picking by active file keeps the right answer in a
 * multi-root workspace without asking.
 */
async function repositoryRoot(quiet = false): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    if (!quiet) vscode.window.showErrorMessage("Odin: open a folder first.");
    return undefined;
  }

  const active = vscode.window.activeTextEditor?.document.uri;
  const folder =
    (active && vscode.workspace.getWorkspaceFolder(active)) ?? folders[0]!;

  try {
    const root = await git(["rev-parse", "--show-toplevel"], {
      cwd: folder.uri.fsPath,
    });
    return root.trim();
  } catch {
    if (!quiet) {
      vscode.window.showErrorMessage("Odin: this folder is not a git repository.");
    }
    return undefined;
  }
}

async function listBranches(repo: string): Promise<string[]> {
  const refs = await listRefs({ cwd: repo });
  return refs.length > 0 ? refs : ["main", "master"];
}
