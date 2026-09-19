import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUNDLE = join(HERE, "..", "dist", "extension.js");

/**
 * A webview that remembers every page and every message it was given.
 *
 * The same instrument as `probe.test.ts`, cut down to what these tests read:
 * which files the page is showing once every message has been applied, and
 * whether a redraw arrived as a whole new model or as rows patched in place —
 * which is how the fast path and the slow one can be told apart from outside.
 */
function recorder() {
  const written: string[] = [];
  const posted: { type?: string; [key: string]: unknown }[] = [];
  const closed: (() => void)[] = [];
  const seen = { written, posted, disposed: false };
  const heard: ((message: unknown) => void)[] = [];
  const webview = {
    cspSource: "vscode-webview:",
    onDidReceiveMessage: (fn: (message: unknown) => void) => {
      heard.push(fn);
      return { dispose() {} };
    },
    postMessage: (message: { type?: string }) => {
      posted.push(message);
      return Promise.resolve(true);
    },
    get html() {
      return written[written.length - 1] ?? "";
    },
    set html(value: string) {
      written.push(value);
    },
  };
  const panel = {
    webview,
    onDidChangeViewState: () => ({ dispose() {} }),
    active: false,
    onDidDispose: (fn: () => void) => {
      closed.push(fn);
      return { dispose() {} };
    },
    reveal() {},
    dispose() {
      if (seen.disposed) return;
      seen.disposed = true;
      for (const fn of closed.splice(0)) fn();
    },
    title: "",
  };
  return Object.assign(seen, {
    panel,
    page: () => written[written.length - 1] ?? "",
  });
}

interface Watcher {
  base: string;
  change: ((uri: { fsPath: string }) => void)[];
  disposed: boolean;
}

/** Just enough editor to activate the real bundle and open a reading in it. */
function stub(session: unknown, folder: string) {
  const disposable = { dispose() {} };
  let serializer:
    | { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }
    | undefined;
  const watchers: Watcher[] = [];
  const status: string[] = [];

  const api: Record<string, unknown> = {
    commands: {
      registerCommand: () => disposable,
      executeCommand: () => Promise.resolve(),
    },
    workspace: {
      registerTextDocumentContentProvider: () => disposable,
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      workspaceFolders: [
        { uri: { scheme: "file", path: folder, fsPath: folder }, name: "w", index: 0 },
      ],
      getWorkspaceFolder: () => undefined,
      createFileSystemWatcher: (pattern: { base?: unknown }) => {
        const watcher: Watcher = {
          base: String((pattern as { base?: string }).base ?? ""),
          change: [],
          disposed: false,
        };
        watchers.push(watcher);
        return {
          onDidCreate: () => disposable,
          onDidChange: (fn: (uri: { fsPath: string }) => void) => {
            watcher.change.push(fn);
            return disposable;
          },
          onDidDelete: () => disposable,
          dispose() {
            watcher.disposed = true;
          },
        };
      },
      openTextDocument: () => Promise.resolve({}),
      onDidSaveTextDocument: () => disposable,
    },
    window: {
      registerUriHandler: () => disposable,
      onDidChangeWindowState: () => disposable,
      registerWebviewViewProvider: () => disposable,
      registerWebviewPanelSerializer: (_type: string, s: typeof serializer) => {
        serializer = s;
        return disposable;
      },
      showErrorMessage: () => Promise.resolve(undefined),
      showInformationMessage: () => Promise.resolve(undefined),
      showWarningMessage: () => Promise.resolve(),
      showQuickPick: () => Promise.resolve(undefined),
      showTextDocument: () => Promise.resolve({}),
      createWebviewPanel: () => recorder().panel,
      setStatusBarMessage: (message: string) => {
        status.push(message);
        return disposable;
      },
      withProgress: (_o: unknown, task: (p: unknown) => unknown) =>
        Promise.resolve(task({ report() {} })),
      activeTextEditor: undefined,
      activeColorTheme: { kind: 2 },
      onDidChangeActiveColorTheme: () => disposable,
    },
    Uri: {
      file: (p: string) => ({ scheme: "file", path: p, fsPath: p, toString: () => p }),
      joinPath: (base: { path?: string }, ...rest: string[]) => {
        const path = [base?.path ?? "", ...rest].filter(Boolean).join("/");
        return { scheme: "file", path, fsPath: path, toString: () => path };
      },
    },
    Disposable: class {
      constructor(readonly fn?: () => void) {}
      dispose(): void {}
    },
    EventEmitter: class {
      readonly event = () => disposable;
      fire(): void {}
      dispose(): void {}
    },
    RelativePattern: class {
      constructor(readonly base: unknown, readonly pattern: string) {}
    },
    TreeItem: class {
      constructor(readonly label: string) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
    ThemeColor: class {
      constructor(readonly id: string) {}
    },
    MarkdownString: class {
      constructor(readonly value?: string) {}
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Position: class {
      constructor(readonly line: number, readonly character: number) {}
    },
    Selection: class {
      constructor(readonly a: unknown, readonly b: unknown) {}
    },
    ViewColumn: { One: 1, Beside: -2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    ProgressLocation: { Notification: 15 },
  };

  const require = createRequire(import.meta.url);
  const Module = require("node:module") as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const original = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "vscode") return api;
    return original.call(this, request, parent, isMain);
  };
  let extension: { activate(context: unknown): void; deactivate(): void };
  try {
    delete require.cache[require.resolve(BUNDLE)];
    extension = require(BUNDLE) as typeof extension;
  } finally {
    Module._load = original;
  }

  const held: Record<string, unknown> = { "odin.session": session };
  const memory = {
    get: (key: string, fallback: unknown) => (key in held ? held[key] : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
  };
  extension.activate({
    subscriptions: [],
    extensionUri: { scheme: "file", path: "/ext" },
    workspaceState: memory,
    globalState: memory,
  });

  return { serializer: () => serializer, watchers, status, extension };
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Git with a fixed author, so a commit never stops to ask who is making it. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

/** Ten lines, with one of them said differently. */
function tenLines(changed: Record<number, string> = {}): string {
  return Array.from({ length: 10 }, (_, i) => changed[i + 1] ?? `export const line${i + 1} = ${i + 1};`)
    .join("\n") + "\n";
}

/**
 * A feature branch cut from `development`, with `development` moved on since.
 *
 * `feature.ts` is the branch's own work. `incoming.ts` is somebody else's,
 * landed on `development` after the branch was cut — so it belongs to the
 * branch only for the length of a merge, and to history once the merge is
 * committed, and it refers to `shared.ts` so that the arrow it brings is a
 * real difference between the graph with it and the graph without. `shared.ts` was touched on both sides, at opposite ends so that
 * the merge is clean, which is the ordinary shape of merging a busy base into
 * a branch and the one that matters here: the branch's card for it changes
 * shape when the merge lands, so the redraw that drops `incoming.ts` is never
 * a redraw of nothing else.
 *
 * Answered with git's own spelling of the directory, because on macOS that is
 * not what `tmpdir` calls it and the extension asks git.
 */
function forkedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-history-"));
  git(dir, "init", "--quiet", "-b", "development");
  writeFileSync(join(dir, "shared.ts"), tenLines());
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "shared");

  git(dir, "checkout", "--quiet", "-b", "feature");
  writeFileSync(join(dir, "feature.ts"), "// the branch's own\nexport const feature = 1;\n");
  writeFileSync(join(dir, "shared.ts"), tenLines({ 1: "export const line1 = 100;" }));
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "feature");

  git(dir, "checkout", "--quiet", "development");
  writeFileSync(
    join(dir, "incoming.ts"),
    '// somebody else\'s\nimport { line1 } from "./shared.js";\nexport const incoming = line1 + 1;\n',
  );
  writeFileSync(join(dir, "shared.ts"), tenLines({ 10: "export const line10 = 1000;" }));
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "incoming");
  git(dir, "checkout", "--quiet", "feature");

  return git(dir, "rev-parse", "--show-toplevel").trim();
}

/** The frame's model with every message it was sent applied, as the page does. */
function showing(panel: ReturnType<typeof recorder>): string[] {
  const page = panel.page();
  const at = page.indexOf("window.__ODIN__=");
  if (at < 0) return [];
  const model = JSON.parse(page.slice(at + 16, page.indexOf(";</script>", at))) as {
    nodes: { id: string; path?: string; status?: string }[];
  };
  for (const message of panel.posted) {
    if (message["type"] === "model") Object.assign(model, message["payload"]);
  }
  return model.nodes
    .filter((node) => node.status !== "phantom")
    .map((node) => node.path ?? node.id)
    .sort();
}

/** Opens the live reading of a checkout and waits for the finished graph. */
async function reading(repo: string) {
  const editor = stub(
    { repo, baseRef: "development", worktree: true, at: new Date().toISOString() },
    repo,
  );
  const panel = recorder();
  await editor.serializer()!.deserializeWebviewPanel(panel.panel, undefined);
  // The watcher is armed only once the second half of the build has landed,
  // which makes it the signal that there is a finished graph to ask about.
  for (let waited = 0; waited < 60_000; waited += 50) {
    if (panel.page().includes("card-body") && editor.watchers.length > 0) break;
    await wait(50);
  }
  return { editor, panel };
}

/**
 * Waits for the rebuild in hand to be over, both halves of it.
 *
 * The cards arrive with the first half and the arrows with the second, and a
 * test that commits while the second is still running has a rebuild reading
 * the repository after the commit — which draws the right answer for the
 * wrong reason, and passes against code that never heard the commit at all.
 * This was caught by exactly that: a merge test passing with the history
 * watching taken out. The corner's badge going off is the host saying it has
 * finished, so that is what is waited for.
 */
async function quiet(panel: ReturnType<typeof recorder>): Promise<void> {
  const off = () => {
    const said = panel.posted.filter((m) => m["type"] === "refreshing");
    return said.length > 0 && said[said.length - 1]!["value"] === false;
  };
  await until(off);
  await wait(300);
  await until(off);
}

/** Waits, within reason, for the page to be showing something in particular. */
async function until(test: () => boolean, ms = 20_000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 50) await wait(50);
}

/**
 * Somebody else's work, arriving by a merge and leaving by the merge commit.
 *
 * The reader's report, nearly verbatim: merging `development` into their branch
 * put `development`'s files in the graph — right, while the merge was open —
 * and committing the merge left them there, so that the branch appeared to
 * contain work it had only absorbed, until Odin was reloaded by hand.
 *
 * What the commit changes is history rather than any file: `HEAD` moves to the
 * merge commit, and with it the merge base against `development`, and relative
 * to the new base those files are not part of the change at all. Nothing on
 * disk is written by that, so a reading that only listened to the working tree
 * never heard about it. These drive the real bundle against a real repository,
 * and the commit is made with no event fired for any working-tree file, which
 * is exactly the position the reader was in.
 */
describe("a merge that completes under a live reading", () => {
  let repo: string;
  beforeAll(() => {
    repo = forkedRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("drops the base's files once the merge commit exists", async () => {
    const { editor, panel } = await reading(repo);
    expect(showing(panel)).toEqual(["feature.ts", "shared.ts"]);

    // The merge, opened and not yet committed: `development`'s file is on disk
    // and the editor says so. Showing it now is accepted behaviour — relative to
    // the old base it genuinely is different.
    git(repo, "merge", "--quiet", "--no-ff", "--no-commit", "development");
    const watcher = editor.watchers.find((w) => w.base === repo && !w.disposed)!;
    for (const fire of watcher.change) fire({ fsPath: join(repo, "incoming.ts") });
    await until(() => showing(panel).includes("incoming.ts"));
    expect(showing(panel)).toEqual(["feature.ts", "incoming.ts", "shared.ts"]);
    await quiet(panel);

    // The merge commit. What the editor's own watcher delivers for this is the
    // bookkeeping under `.git` — the reflog, the branch's ref, `MERGE_HEAD`
    // going away — and not one file of the project.
    git(repo, "commit", "--quiet", "--no-edit");
    for (const path of [".git/logs/HEAD", ".git/refs/heads/feature", ".git/MERGE_HEAD"]) {
      for (const fire of watcher.change) fire({ fsPath: join(repo, path) });
    }
    await until(() => !showing(panel).includes("incoming.ts"));

    expect(showing(panel)).toEqual(["feature.ts", "shared.ts"]);
    editor.extension.deactivate();
  }, 120_000);
});

/**
 * The same merge, in a linked worktree, which is where the reader works.
 *
 * A linked worktree's `.git` is a file pointing somewhere else: its `HEAD` and
 * reflog live in the main repository's `.git/worktrees/<name>`, and the
 * branches in the main repository's `refs`. None of that is under the folder
 * the editor has open, so the editor's watcher reports nothing whatever
 * happens to it — and a reading that waited to be told about history by the
 * editor would stay stale for ever. Nothing is fired by hand here: the commit
 * has to be noticed by the reading itself.
 */
describe("a merge that completes in a linked worktree", () => {
  let main: string;
  let parent: string;
  let tree: string;
  beforeAll(() => {
    main = forkedRepo();
    // Moved off the branch so the worktree may have it.
    git(main, "checkout", "--quiet", "development");
    parent = mkdtempSync(join(tmpdir(), "odin-history-tree-"));
    git(main, "worktree", "add", "--quiet", join(parent, "wt"), "feature");
    tree = git(join(parent, "wt"), "rev-parse", "--show-toplevel").trim();
  });
  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
    rmSync(main, { recursive: true, force: true });
  });

  it("notices the commit without the editor saying anything", async () => {
    const { editor, panel } = await reading(tree);
    expect(showing(panel)).toEqual(["feature.ts", "shared.ts"]);

    git(tree, "merge", "--quiet", "--no-ff", "--no-commit", "development");
    const watcher = editor.watchers.find((w) => w.base === tree && !w.disposed)!;
    for (const fire of watcher.change) fire({ fsPath: join(tree, "incoming.ts") });
    await until(() => showing(panel).includes("incoming.ts"));
    expect(showing(panel)).toEqual(["feature.ts", "incoming.ts", "shared.ts"]);
    await quiet(panel);

    git(tree, "commit", "--quiet", "--no-edit");
    await until(() => !showing(panel).includes("incoming.ts"));

    expect(showing(panel)).toEqual(["feature.ts", "shared.ts"]);
    editor.extension.deactivate();
  }, 120_000);
});

/**
 * An ordinary edit, which must stay on the fast path.
 *
 * The cheap way to fix the merge would be to treat every rebuild as though
 * history had moved, and it would be a regression the reader felt on every
 * save: the rows redraw in tens of milliseconds because the arrows, the blobs
 * and the layout are all carried over, and a full recompute throws all of that
 * away. A comment reworded in place is the cheapest edit there is, and it must
 * arrive as rows patched into the page, not as a new model.
 */
describe("an ordinary edit beside the history watching", () => {
  let repo: string;
  beforeAll(() => {
    repo = forkedRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("still arrives as rows, not as a rebuilt graph", async () => {
    const { editor, panel } = await reading(repo);
    const before = panel.posted.length;

    writeFileSync(join(repo, "feature.ts"), "// the branch's own, reworded\nexport const feature = 1;\n");
    const watcher = editor.watchers.find((w) => w.base === repo && !w.disposed)!;
    for (const fire of watcher.change) fire({ fsPath: join(repo, "feature.ts") });
    await until(() => panel.posted.slice(before).some((m) => m["type"] === "rows"));

    const after = panel.posted.slice(before).map((m) => m["type"]);
    expect(after).toContain("rows");
    expect(after).not.toContain("model");
    editor.extension.deactivate();
  }, 120_000);
});

/**
 * A file leaving the change in the same rebuild as another card's rows move.
 *
 * The second half of the reader's report, and the reason reloading was the only
 * cure even once a rebuild had happened. A rebuild whose cards merely changed
 * is delivered as rows patched into the page, and that was being done for a
 * rebuild whose set of files had changed as well — so a file that had left the
 * change was simply not mentioned, the page kept its card, and the expensive
 * half of the rebuild, compared with that answer rather than with what the
 * page showed, had nothing new to say. No history is involved here at all: the
 * branch's own file is put back as it was, in the same save that edits another.
 */
describe("a file leaving the change beside an edit to another", () => {
  let repo: string;
  beforeAll(() => {
    repo = forkedRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("takes the card away rather than patching the rows around it", async () => {
    const { editor, panel } = await reading(repo);
    expect(showing(panel)).toEqual(["feature.ts", "shared.ts"]);

    // `shared.ts` back to the base, which leaves the change; and `feature.ts`
    // grows a line, so that its card is redrawn in the same rebuild.
    writeFileSync(join(repo, "shared.ts"), tenLines());
    writeFileSync(
      join(repo, "feature.ts"),
      "// the branch's own\nexport const feature = 1;\nexport const more = 2;\n",
    );
    const watcher = editor.watchers.find((w) => w.base === repo && !w.disposed)!;
    for (const path of ["shared.ts", "feature.ts"]) {
      for (const fire of watcher.change) fire({ fsPath: join(repo, path) });
    }
    await until(() => !showing(panel).includes("shared.ts"), 10_000);

    expect(showing(panel)).toEqual(["feature.ts"]);
    editor.extension.deactivate();
  }, 120_000);
});
