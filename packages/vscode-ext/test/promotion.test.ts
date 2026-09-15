import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUNDLE = join(HERE, "..", "dist", "extension.js");

/**
 * A webview that remembers every page it was given, and whether it is still
 * there.
 *
 * Same instrument as `probe.test.ts`. What these tests read off it is narrower
 * than usual: how many frames the editor was asked for, and which of them the
 * extension closed again. Neither is a question the source can answer — a tab
 * is a thing the editor holds — so the asking and the closing are recorded and
 * counted.
 */
function recorder() {
  const written: string[] = [];
  const posted: { type?: string; [key: string]: unknown }[] = [];
  const closed: (() => void)[] = [];
  const seen = { written, posted, disposed: false, revealed: 0 };
  const heard: ((message: unknown) => void)[] = [];
  const webview = {
    cspSource: "vscode-webview:",
    options: {} as unknown,
    asWebviewUri: (uri: unknown) => uri,
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
    visible: true,
    iconPath: undefined as unknown,
    onDidDispose: (fn: () => void) => {
      closed.push(fn);
      return { dispose() {} };
    },
    reveal() {
      seen.revealed += 1;
    },
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
    say: (message: unknown) => {
      for (const fn of heard) fn(message);
    },
  });
}

interface Watcher {
  base: string;
  change: ((uri: { fsPath: string }) => void)[];
  create: ((uri: { fsPath: string }) => void)[];
  remove: ((uri: { fsPath: string }) => void)[];
  disposed: boolean;
}

function stub(session: unknown, workspace: { folder: string; baseRef: string }) {
  const disposable = { dispose() {} };
  let serializer:
    | { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }
    | undefined;
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const opened: ReturnType<typeof recorder>[] = [];
  const watchers: Watcher[] = [];
  const saves: ((d: { uri: { scheme: string; fsPath: string } }) => void)[] = [];
  const status: string[] = [];
  const errors: string[] = [];
  const focus: ((w: { focused: boolean }) => void)[] = [];
  const views: { resolveWebviewView(view: unknown): void }[] = [];
  /** Everything the editor has been asked to run, in order. */
  const ran: { id: string; args: unknown[] }[] = [];

  const api: Record<string, never> & {
    information: (message: string, ...rest: unknown[]) => Promise<unknown>;
    [key: string]: unknown;
  } = {
    information: () => Promise.resolve(undefined),
    commands: {
      registerCommand: (id: string, run: (...args: unknown[]) => unknown) => {
        commands.set(id, run);
        return disposable;
      },
      // Recorded rather than swallowed. What the bar beside the drawing is
      // allowed to offer is said entirely through `setContext`, and one of
      // these tests is about the bar not being sent back to the pull request
      // list halfway through a swap.
      executeCommand: (id?: string, ...args: unknown[]) => {
        ran.push({ id: id ?? "", args });
        return Promise.resolve();
      },
    },
    workspace: {
      registerTextDocumentContentProvider: () => disposable,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === "baseRef" ? workspace.baseRef : fallback,
      }),
      workspaceFolders: [
        {
          uri: { scheme: "file", path: workspace.folder, fsPath: workspace.folder },
          name: "w",
          index: 0,
        },
      ],
      getWorkspaceFolder: () => undefined,
      createFileSystemWatcher: (pattern: { base?: unknown }) => {
        const watcher: Watcher = {
          base: String((pattern as { base?: string }).base ?? ""),
          change: [],
          create: [],
          remove: [],
          disposed: false,
        };
        watchers.push(watcher);
        return {
          onDidCreate: (fn: (uri: { fsPath: string }) => void) => {
            watcher.create.push(fn);
            return disposable;
          },
          onDidChange: (fn: (uri: { fsPath: string }) => void) => {
            watcher.change.push(fn);
            return disposable;
          },
          onDidDelete: (fn: (uri: { fsPath: string }) => void) => {
            watcher.remove.push(fn);
            return disposable;
          },
          dispose() {
            watcher.disposed = true;
          },
        };
      },
      openTextDocument: () => Promise.resolve({}),
      onDidSaveTextDocument: (fn: (d: { uri: { scheme: string; fsPath: string } }) => void) => {
        saves.push(fn);
        return disposable;
      },
    },
    window: {
      registerUriHandler: () => disposable,
      onDidChangeWindowState: (fn: (w: { focused: boolean }) => void) => {
        focus.push(fn);
        return disposable;
      },
      registerWebviewViewProvider: (_type: string, provider: {
        resolveWebviewView(view: unknown): void;
      }) => {
        views.push(provider);
        return disposable;
      },
      registerWebviewPanelSerializer: (_type: string, s: typeof serializer) => {
        serializer = s;
        return disposable;
      },
      showErrorMessage: (message: string) => {
        errors.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (message: string, ...rest: unknown[]) =>
        api.information(message, ...rest),
      showWarningMessage: () => Promise.resolve(),
      showQuickPick: () => Promise.resolve(undefined),
      showTextDocument: () => Promise.resolve({}),
      createWebviewPanel: () => {
        const seen = recorder();
        opened.push(seen);
        return seen.panel;
      },
      setStatusBarMessage: (message: string) => {
        status.push(message);
        return disposable;
      },
      withProgress: (_o: unknown, task: (p: unknown) => unknown) =>
        Promise.resolve(task({ report() {} })),
      activeTextEditor: undefined,
      activeColorTheme: { kind: 2 },
      onDidChangeActiveColorTheme: () => disposable,
      tabGroups: { all: [], onDidChangeTabs: () => disposable },
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
  extension.activate({
    subscriptions: [],
    extensionUri: { scheme: "file", path: "/ext" },
    workspaceState: {
      get: (key: string, fallback: unknown) => (key in held ? held[key] : fallback),
      update: (key: string, value: unknown) => {
        held[key] = value;
        return Promise.resolve();
      },
    },
    globalState: {
      get: (key: string, fallback: unknown) => (key in held ? held[key] : fallback),
      update: (key: string, value: unknown) => {
        held[key] = value;
        return Promise.resolve();
      },
    },
  });

  return {
    serializer, commands, opened, watchers, saves, status, focus, extension, errors, views, ran,
    set information(fn: (message: string, ...rest: unknown[]) => Promise<unknown>) {
      api.information = fn;
    },
  };
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));


/**
 * A repository with two pull requests on a forge that answers.
 *
 * Built rather than mocked, because what is being counted is what a real build
 * does: a reading is filed under the refs the reader asked for, and a graph
 * says what those refs turned out to be. The base is deliberately left with no
 * local copy, so `development` goes in and `origin/development` comes back —
 * which is the ordinary case in any checkout that has never needed the base
 * branch itself, and the case the duplicate tab came out of.
 *
 * `gh` is a shell script on the path. It answers the one question the list asks
 * and refuses everything else, which is also what a signed-out `gh` does: the
 * pull request metadata on the graph is then empty, so nothing here may depend
 * on it to know which change a tab is of.
 */
function forge(): { repo: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), "odin-promote-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore", env });

  mkdirSync(work);
  git(work, "init", "--quiet", "-b", "development");
  writeFileSync(join(work, "one.ts"), "export function one(): number {\n  return 1;\n}\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "one");

  // The change under test, and the branch this checkout holds — so the live
  // reading of it is a reading of these very files.
  git(work, "checkout", "--quiet", "-b", "marco/lab-86");
  writeFileSync(
    join(work, "two.ts"),
    'import { one } from "./one.js";\n\nexport const two = one() + 1;\n',
  );
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "two");

  // Somebody else's change, which must keep a tab of its own whatever happens
  // to the first one.
  git(work, "checkout", "--quiet", "-b", "marco/lab-87", "development");
  writeFileSync(join(work, "three.ts"), "export const three = 3;\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "three");
  git(work, "checkout", "--quiet", "marco/lab-86");

  execFileSync("git", ["init", "--bare", "--quiet", origin], { stdio: "ignore", env });
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "--quiet", "origin", "development", "marco/lab-86", "marco/lab-87");
  git(work, "fetch", "--quiet", "origin");
  // No local copy of the base, so it resolves to `origin/development` while the
  // reader only ever asked for `development`.
  git(work, "branch", "-D", "development");
  git(work, "branch", "-D", "marco/lab-87");
  // Work that is not committed, so the live reading is a different picture from
  // the forge's and a tab drawing one can be told from a tab drawing the other.
  writeFileSync(
    join(work, "two.ts"),
    'import { one } from "./one.js";\n\nexport const two = one() + 99;\n',
  );

  const shaOf = (ref: string) =>
    execFileSync("git", ["rev-parse", ref], { cwd: work, encoding: "utf8" }).trim();

  const bin = join(root, "bin");
  mkdirSync(bin);
  const list = JSON.stringify([
    {
      number: 114,
      title: "notification_feed read-model, migration and projector",
      url: "https://example.invalid/pr/114",
      headRefName: "marco/lab-86",
      headRefOid: shaOf("marco/lab-86"),
      isDraft: false,
      author: { login: "marco" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      state: "OPEN",
      baseRefName: "development",
      reviewRequests: [],
    },
    {
      number: 115,
      title: "an unrelated change",
      url: "https://example.invalid/pr/115",
      headRefName: "marco/lab-87",
      headRefOid: shaOf("origin/marco/lab-87"),
      isDraft: false,
      author: { login: "marco" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      state: "OPEN",
      baseRefName: "development",
      reviewRequests: [],
    },
  ]);
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
for a in "$@"; do
  case "$a" in
    list) cat <<'ODIN'
${list}
ODIN
      exit 0;;
  esac
done
exit 1
`,
  );
  chmodSync(join(bin, "gh"), 0o755);

  return {
    repo: execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: work,
      encoding: "utf8",
    }).trim(),
    bin,
  };
}

/** A window with the list already fetched, so a row can be pressed. */
async function opened(repo: string) {
  const editor = stub(undefined, { folder: repo, baseRef: "" });
  // Every offer accepted, as the reader in the report accepted theirs.
  editor.information = (_message: string, ...rest: unknown[]) =>
    Promise.resolve(rest.find((one) => typeof one === "string"));
  await editor.commands.get("odin.refresh")!();
  await wait(1500);
  return editor;
}

/**
 * Waits until this many frames have been asked for and the newest holds a graph.
 *
 * The newest rather than any of them, and a count of frames asked for rather
 * than of frames still showing something: the loader for a reading that is on
 * its way is written into whatever frame is free, so a tab that had a drawing a
 * moment ago may well be holding a pulsing mark right now. What says the build
 * being waited on has landed is the frame it landed in.
 */
async function drawn(
  editor: Awaited<ReturnType<typeof opened>>,
  many: number,
): Promise<void> {
  for (let waited = 0; waited < 60_000; waited += 100) {
    const newest = editor.opened[editor.opened.length - 1];
    if (editor.opened.length >= many && newest?.page().includes("window.__ODIN__=")) break;
    await wait(100);
  }
  // The tab a promotion replaces is closed after its replacement is drawn, so
  // there is always a moment after the graph arrives in which both are open.
  await wait(2000);
}

/** The tabs the reader is left with. */
function tabs(editor: Awaited<ReturnType<typeof opened>>) {
  return editor.opened.filter((frame) => !frame.disposed);
}

/**
 * One change, one tab, whichever way round it is being read.
 *
 * A pull request can be read two ways — as the forge has it, and from the files
 * on disk — and picking one of them for a change already on screen is not
 * asking for a second tab of it. It is the same change read the other way, and
 * what the reader wants at the end of it is the one they just asked for.
 *
 * What they got instead was three tabs: the forge's copy, the live reading, and
 * a second copy of the forge's. The second copy came from a reading being filed
 * under the refs as asked for — `development` — while everything that replayed
 * it replayed the refs as resolved — `origin/development` — so the replay found
 * no tab under that name and opened one. The live reading came beside rather
 * than instead of because the field the panel closes a promoted tab by was set
 * by the two routes that raise a prompt and by neither of the two the reader
 * presses.
 *
 * Driven through the commands the list itself runs, against a real repository
 * and a real build, because how many tabs a change opens is not a question the
 * source can answer: it is a count of what the editor was asked to make.
 */
describe("reading one change the other way", () => {
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    const made = forge();
    repo = made.repo;
    path = process.env.PATH;
    process.env.PATH = `${made.bin}:${path ?? ""}`;
  });
  afterAll(() => {
    if (path !== undefined) process.env.PATH = path;
  });

  it("leaves one tab when the live reading replaces the forge's copy", async () => {
    const editor = await opened(repo);

    await editor.commands.get("odin.readOrigin")!(114);
    await drawn(editor, 1);
    expect(tabs(editor)).toHaveLength(1);

    // What the reader did in the report: the same change, read from the files
    // on disk. Refreshing in between is what a reader does while they wait, and
    // it is where the duplicate of the forge's copy used to come from.
    await editor.commands.get("odin.refresh")!();
    await wait(2000);
    expect(tabs(editor)).toHaveLength(1);

    await editor.commands.get("odin.readLocal")!(114);
    await drawn(editor, 2);

    const left = tabs(editor);
    expect(left).toHaveLength(1);
    expect(left[0]!.panel.title.startsWith("LIVE ")).toBe(true);

    /*
     * And the bar beside the drawing stayed on the change.
     *
     * The tab being replaced is closed after its replacement is drawn, and the
     * panel decides whether anything outside it has to move by asking whether
     * the tab that closed was the one in front. Closed a moment too early —
     * before the replacement is the reading in front — that answer is yes, and
     * everything that follows the reading is told there is no change left to
     * follow: the file list is put away mid-promotion and what the reader is
     * given, over their newly drawn graph, is the list of pull requests they
     * had already chosen from.
     */
    const forgotten = editor.ran.some(
      (one) =>
        one.id === "setContext" &&
        one.args[0] === "odin.hasGraph" &&
        one.args[1] === false,
    );
    expect(forgotten).toBe(false);
  }, 90_000);

  it("leaves one tab when the change is checked out rather than merely read", async () => {
    /*
     * The same promotion, on the route that actually gets pressed.
     *
     * There are two ways to end up reading the files on disk, and they sit next
     * to each other in the list: "Local", which reads the working tree where it
     * is, and the checkout, which brings the branch onto this machine first and
     * then reads it. The first was given the promotion and the second was not,
     * so a reader who took the change onto their machine still finished with
     * three tabs — and the test written for the fix drove the route that had
     * been fixed, which is how it came to pass over a report that was still
     * true.
     *
     * Reading is not the same act as checking out, but what the reader wants at
     * the end of both is one tab showing the files on disk.
     */
    const editor = await opened(repo);

    await editor.commands.get("odin.readOrigin")!(114);
    await drawn(editor, 1);
    expect(tabs(editor)).toHaveLength(1);

    await editor.commands.get("odin.checkoutLocal")!(114);
    await drawn(editor, 2);

    const left = tabs(editor);
    expect(left).toHaveLength(1);
    expect(left[0]!.panel.title.startsWith("LIVE ")).toBe(true);
  }, 30_000);

  it("leaves one tab going back the other way", async () => {
    const editor = await opened(repo);

    await editor.commands.get("odin.readLocal")!(114);
    await drawn(editor, 1);
    expect(tabs(editor)).toHaveLength(1);
    expect(tabs(editor)[0]!.panel.title.startsWith("LIVE ")).toBe(true);

    await editor.commands.get("odin.readOrigin")!(114);
    await drawn(editor, 2);

    const left = tabs(editor);
    expect(left).toHaveLength(1);
    expect(left[0]!.panel.title.startsWith("LIVE ")).toBe(false);
  }, 90_000);

  it("still gives two different pull requests a tab each", async () => {
    /*
     * The guard on all of the above. Replacing one reading with another is only
     * right for two readings of the same change; a reader comparing two changes
     * asked for both and means to have both, which is the whole reason there is
     * more than one tab in the first place.
     */
    const editor = await opened(repo);

    await editor.commands.get("odin.readOrigin")!(114);
    await drawn(editor, 1);
    await editor.commands.get("odin.readOrigin")!(115);
    await drawn(editor, 2);

    expect(tabs(editor)).toHaveLength(2);
  }, 90_000);
});
