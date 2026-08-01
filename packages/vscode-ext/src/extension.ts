import { git, listRefs, serializeGraph } from "@odin/core";
import * as vscode from "vscode";

import { BASE_SCHEME, BaseContentProvider } from "./baseContent.js";
import { buildGraphForRepo } from "./graph.js";
import { GraphPanel } from "./panel.js";
import { ChangeSidebar } from "./sidebar.js";

/** The sidebar's view of the most recent review. */
const sidebar = new ChangeSidebar();

/** Enough of the last review to act on it without rebuilding. */
let last: { repo: string; baseRef?: string } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChangeSidebar.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("odin.showGraph", () => GraphPanel.revealCurrent()),
    vscode.commands.registerCommand("odin.refresh", () =>
      review(last?.baseRef),
    ),
    vscode.commands.registerCommand("odin.openFile", (path: string) =>
      GraphPanel.openPath(path),
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
        const { graph, shown, layout, layoutWithTests } = await buildGraphForRepo({
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

        GraphPanel.show(shown, layout, repo, layoutWithTests);
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
async function repositoryRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Odin: open a folder first.");
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
    vscode.window.showErrorMessage("Odin: this folder is not a git repository.");
    return undefined;
  }
}

async function listBranches(repo: string): Promise<string[]> {
  const refs = await listRefs({ cwd: repo });
  return refs.length > 0 ? refs : ["main", "master"];
}
