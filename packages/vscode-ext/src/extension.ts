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
  worktreeFor,
  serializeGraph,
} from "@odin/core";
import { loadHighlighter } from "@odin/highlight";
import { execFile } from "node:child_process";

import * as vscode from "vscode";

import { BASE_SCHEME, BaseContentProvider } from "./baseContent.js";
import { buildGraphForRepo } from "./graph.js";
import { GraphPanel } from "./panel.js";
import { ChangeSidebar } from "./sidebar.js";
import { activeTheme } from "./theme.js";
import { SeenStore } from "./seen.js";
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

/** Enough of the last review to act on it without rebuilding. */
let last: { repo: string; baseRef?: string } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // The graph's tab wears the extension's own mark, which is a file on disk:
  // the tab belongs to the editor rather than to the page inside it.
  GraphPanel.assets = context.extensionUri;

  viewed = new ViewedStore(context.workspaceState);
  seen = new SeenStore(context.workspaceState);
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
    vscode.commands.registerCommand("odin.refresh", () =>
      review(last?.baseRef),
    ),
    vscode.commands.registerCommand("odin.openFile", (path: string) =>
      GraphPanel.openPath(path),
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
    vscode.commands.registerCommand("odin.reviewAgainst", () => reviewAgainst()),
    vscode.commands.registerCommand("odin.exportGraph", () => exportGraph()),
    vscode.commands.registerCommand("odin.checkout", (number: number) =>
      checkout(number),
    ),
  );
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
    known.clear();
    for (const pull of pulls) known.set(pull.number, pull);
    sidebar.setPullRequests(pulls, branch ?? "", repo, me ?? "", answer !== undefined);
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
  // Nothing to tear down: temporary checkouts are removed as they are used.
}

async function review(baseRef?: string, headRef?: string): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const settings = vscode.workspace.getConfiguration("odin");
  const base = baseRef ?? settings.get<string>("baseRef") ?? undefined;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Odin" },
    async (progress) => {
      // Reading a diff, resolving its references and laying them out is several
      // seconds on a large change. The mark says so in the panel the reviewer
      // is watching, not only in a notification in the corner.
      await GraphPanel.showLoading("Reading the change");
      try {
        const { graph, shown, layout, layoutWithTests, unifiedLayout, unifiedWithTests } =
          await buildGraphForRepo({
          cwd: repo,
          ...(base ? { baseRef: base } : {}),
          ...(headRef ? { headRef } : {}),
          includeImports: settings.get<boolean>("includeImports", true),
          includeContext: settings.get<boolean>("includeContext", false),
          report: (message) => {
            progress.report({ message });
            GraphPanel.note(message);
          },
        });

        if (graph.nodes.length === 0) {
          vscode.window.showInformationMessage(
            `Odin: nothing differs between ${graph.meta.baseRef} and the current branch.`,
          );
          await GraphPanel.stopLoading(
            `Nothing differs between ${graph.meta.baseRef} and this branch.`,
          );
          return;
        }

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

        // Loaded before the first paint. Colouring the code a beat after it
        // appears would redraw the whole page and take the reviewer's scroll
        // position with it.
        progress.report({ message: "colouring" });
        const theme = await activeTheme();
        const highlight = await loadHighlighter(
          graph.nodes.map((n) => n.language ?? "plaintext"),
          { dark: isDark(), ...(theme ? { theme } : {}) },
        );

        // The list follows whichever part the panel is showing.
        GraphPanel.onPart = (paths) => sidebar.setPart(paths);

        const panel = GraphPanel.show(
          shown, layout, repo, layoutWithTests, viewed, highlight,
          { layout: unifiedLayout, withTests: unifiedWithTests },
        );

        // Fetched after the graph is on screen: the picture is the point, and
        // waiting on the forge before showing it would be the wrong order.
        const pull = graph.meta.pullRequest;
        if (pull) panel.watchChecks(graph.meta.headRef, repo);
        if (pull) {
          void listReviewComments(pull.number, { cwd: repo })
            .then((found) => inlineAvatars(found).catch(() => found))
            .then((comments) => {
              if (comments.length > 0) panel.setComments(comments);
            });
        }
        sidebar.setGraph(graph);
        last = { repo, ...(base ? { baseRef: base } : {}) };
      } catch (error) {
        await GraphPanel.stopLoading(
          error instanceof Error ? error.message : String(error),
        );
        await reportFailure(repo, error);
      }
    },
  );
}

/**
 * Turns a failed review into something actionable.
 *
 * The common failure by far is a base branch that does not exist in this
 * checkout — a worktree with no local `main`, or a repository that still uses
 * `master`. Offering the branch list on the spot beats making the reviewer go
 * and find the settings.
 */
async function reportFailure(repo: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const missingBase =
    message.includes("no base branch found") ||
    message.includes("Not a valid object name");

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

  // Remember it, so the next review does not ask again.
  await vscode.workspace
    .getConfiguration("odin")
    .update("baseRef", picked, vscode.ConfigurationTarget.Workspace);
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
    ...(settings.get<string>("baseRef")
      ? { baseRef: settings.get<string>("baseRef")! }
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
