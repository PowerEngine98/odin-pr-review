import {
  currentBranch,
  forgeEnv,
  git,
  listPullRequests,
  listRefs,
  inlineAvatars,
  listReviewComments,
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

/** Enough of the last review to act on it without rebuilding. */
let last: { repo: string; baseRef?: string } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  viewed = new ViewedStore(context.workspaceState);
  sidebar = new ChangeSidebar(viewed);

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

  const [pulls, branch] = await Promise.all([
    listPullRequests({ cwd: repo }),
    currentBranch({ cwd: repo }),
  ]);
  sidebar.setPullRequests(pulls, branch ?? "");
}

/**
 * Switches to a pull request's branch.
 *
 * Refuses outright when the working tree is dirty. `gh pr checkout` would
 * either fail halfway or carry the changes onto another branch, and neither is
 * something to do to someone's work without asking — the reviewer is better
 * placed to decide whether to commit or stash.
 */
async function checkout(number: number): Promise<void> {
  const repo = await repositoryRoot();
  if (!repo) return;

  const dirty = (await git(["status", "--porcelain"], { cwd: repo })).trim();
  if (dirty) {
    const count = dirty.split("\n").length;
    vscode.window.showWarningMessage(
      `Odin: ${count} uncommitted change${count === 1 ? "" : "s"} in this ` +
        `worktree. Commit or stash before switching to #${number}.`,
    );
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Odin: checking out #${number}` },
    async () => {
      try {
        await gh(["pr", "checkout", String(number)], repo);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Odin: could not check out #${number}. ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      await refreshPullRequests();
      await review();
    },
  );
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
      try {
        const { graph, shown, layout, layoutWithTests, unifiedLayout, unifiedWithTests } =
          await buildGraphForRepo({
          cwd: repo,
          ...(base ? { baseRef: base } : {}),
          includeImports: settings.get<boolean>("includeImports", true),
          includeContext: settings.get<boolean>("includeContext", false),
          report: (message) => progress.report({ message }),
        });

        if (graph.nodes.length === 0) {
          vscode.window.showInformationMessage(
            `Odin: nothing differs between ${graph.meta.baseRef} and the current branch.`,
          );
          return;
        }

        viewed.open(repo, graph.meta.baseRef, graph.meta.headRef);

        // Loaded before the first paint. Colouring the code a beat after it
        // appears would redraw the whole page and take the reviewer's scroll
        // position with it.
        progress.report({ message: "colouring" });
        const theme = await activeTheme();
        const highlight = await loadHighlighter(
          graph.nodes.map((n) => n.language ?? "plaintext"),
          { dark: isDark(), ...(theme ? { theme } : {}) },
        );

        const panel = GraphPanel.show(
          shown, layout, repo, layoutWithTests, viewed, highlight,
          { layout: unifiedLayout, withTests: unifiedWithTests },
        );

        // Fetched after the graph is on screen: the picture is the point, and
        // waiting on the forge before showing it would be the wrong order.
        const pull = graph.meta.pullRequest;
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
