import {
  currentBranch,
  forgeEnv,
  git,
  listPullRequests,
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
 * Fills the sidebar's chooser with whatever is open on the forge.
 *
 * Best-effort and silent on failure: `gh` may be missing or signed out, and the
 * ability to review the branch you are on does not depend on it.
 */
async function refreshPullRequests(): Promise<void> {
  const repo = await repositoryRoot(true);
  if (!repo) return;

  sidebar.setLoading(true);
  try {
    const [pulls, branch] = await Promise.all([
      listPullRequests({ cwd: repo }),
      currentBranch({ cwd: repo }),
    ]);
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
    sidebar.setPullRequests(pulls, branch ?? "", repo);
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

async function checkout(number: number): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

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
  const open = await listPullRequests({ cwd: repo }).catch(() => []);
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
          vscode.window.showErrorMessage(
            `Odin: could not check out #${number}. ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          await GraphPanel.stopLoading(`Could not check out #${number}.`);
          return;
        }
        await refreshPullRequests();
        await review();
      },
    );
  } finally {
    switching.delete(number);
  }
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

async function review(baseRef?: string): Promise<void> {
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
