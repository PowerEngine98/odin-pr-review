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
 * A webview that remembers every page it was given.
 *
 * The question these tests answer is not what the loader looks like — that is
 * settled elsewhere — but whether the extension ever hands it over. Reading the
 * code has now been wrong about that three times, so the recorder replaces the
 * reading.
 */
function recorder() {
  const written: string[] = [];
  const closed: (() => void)[] = [];
  const seen = { written, disposed: false, revealed: 0 };
  const webview = {
    cspSource: "vscode-webview:",
    onDidReceiveMessage: () => ({ dispose() {} }),
    postMessage: () => Promise.resolve(true),
    get html() {
      return written[written.length - 1] ?? "";
    },
    set html(value: string) {
      written.push(value);
    },
  };
  const panel = {
    webview,
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
  return Object.assign(seen, { panel });
}

/** The editor, as much of it as activation and a restore actually touch. */
function stub(session: unknown, workspace?: { folder: string; baseRef: string }) {
  const disposable = { dispose() {} };
  let serializer: { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> } | undefined;
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  /** Frames the extension opened for itself, as opposed to ones handed to it. */
  const opened: ReturnType<typeof recorder>[] = [];

  const api = {
    commands: {
      registerCommand: (id: string, run: (...args: unknown[]) => unknown) => {
        commands.set(id, run);
        return disposable;
      },
      executeCommand: () => Promise.resolve(),
    },
    workspace: {
      registerTextDocumentContentProvider: () => disposable,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === "baseRef" && workspace ? workspace.baseRef : fallback,
      }),
      workspaceFolders: workspace
        ? [{ uri: { scheme: "file", path: workspace.folder, fsPath: workspace.folder }, name: "w", index: 0 }]
        : undefined,
      getWorkspaceFolder: () => undefined,
      createFileSystemWatcher: () => ({
        onDidCreate: () => disposable,
        onDidChange: () => disposable,
        onDidDelete: () => disposable,
        dispose() {},
      }),
      openTextDocument: () => Promise.resolve({}),
    },
    window: {
      registerUriHandler: () => disposable,
      onDidChangeWindowState: () => disposable,
      registerWebviewViewProvider: () => disposable,
      registerWebviewPanelSerializer: (_type: string, s: typeof serializer) => {
        serializer = s;
        return disposable;
      },
      showErrorMessage: () => Promise.resolve(),
      showInformationMessage: () => Promise.resolve(),
      showWarningMessage: () => Promise.resolve(),
      showQuickPick: () => Promise.resolve(undefined),
      showTextDocument: () => Promise.resolve({}),
      createWebviewPanel: () => {
        const seen = recorder();
        opened.push(seen);
        return seen.panel;
      },
      setStatusBarMessage: () => disposable,
      withProgress: (_o: unknown, task: (p: unknown) => unknown) =>
        Promise.resolve(task({ report() {} })),
      activeTextEditor: undefined,
      activeColorTheme: { kind: 2 },
      onDidChangeActiveColorTheme: () => disposable,
    },
    Uri: { file: (p: string) => ({ scheme: "file", path: p, toString: () => p }), joinPath: () => ({}) },
    Disposable: class { constructor(readonly fn?: () => void) {} dispose() {} },
    EventEmitter: class { readonly event = () => disposable; fire() {} dispose() {} },
    RelativePattern: class { constructor(readonly base: unknown, readonly pattern: string) {} },
    TreeItem: class { constructor(readonly label: string) {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(readonly id: string) {} },
    ThemeColor: class { constructor(readonly id: string) {} },
    MarkdownString: class { constructor(readonly value?: string) {} },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Position: class { constructor(readonly line: number, readonly character: number) {} },
    Selection: class { constructor(readonly a: unknown, readonly b: unknown) {} },
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
  let extension: { activate(context: unknown): void };
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
  });

  return { serializer, commands, opened };
}

const fresh = () => ({ repo: "/w", baseRef: "main", number: 152, at: new Date().toISOString() });

/**
 * A repository small enough to review in a test, and real enough to review at
 * all: the command reads a diff with git and resolves it with the compiler, and
 * neither can be talked out of wanting a checkout on disk.
 */
function tinyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-restore-"));
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });

  run("init", "--quiet", "-b", "main");
  writeFileSync(join(dir, "one.ts"), "export function one(): number {\n  return 1;\n}\n");
  run("add", "-A");
  run("commit", "--quiet", "-m", "one");
  writeFileSync(join(dir, "two.ts"), 'import { one } from "./one.js";\n\nexport const two = one() + 1;\n');
  run("add", "-A");
  run("commit", "--quiet", "-m", "two");
  return dir;
}

describe("coming back after a window reload", () => {
  it("registers something to restore the panel with", () => {
    expect(stub(fresh()).serializer).toBeDefined();
  });

  it("puts the mark on screen before it starts rebuilding", async () => {
    // The rebuild takes seconds. Handing the frame back empty for that long is
    // the reader watching a black rectangle wondering whether anything is
    // happening — which is exactly what a restored panel was doing.
    const { serializer } = stub(fresh());
    const seen = recorder();
    await serializer!.deserializeWebviewPanel(seen.panel, undefined);

    expect(seen.written.length).toBeGreaterThan(0);
    expect(seen.written[0]).toContain("breathe");
    expect(seen.written[0]).toContain("Reopening");
  });

  it("does not hold a frame open for a review it cannot name", async () => {
    // Nothing worth reopening, and an empty frame says less than no frame.
    const { serializer } = stub(undefined);
    const seen = recorder();
    let disposed = false;
    seen.panel.dispose = () => { disposed = true; };
    await serializer!.deserializeWebviewPanel(seen.panel, undefined);

    expect(seen.written).toEqual([]);
    expect(disposed).toBe(true);
  });
});

/**
 * The editor does not hand every restored frame back at once.
 *
 * A webview is only restored when its tab is first looked at, so a graph tab
 * left in the background comes back long after the window did — often after
 * the reader has asked for a review and been given a frame for it. Two frames,
 * one review: whichever one Odin does not take is never written to again, and a
 * frame nobody writes to is black. That is what the reader was looking at,
 * while the corner said references were being resolved.
 */
describe("a second frame for a review that is already open", () => {
  let repo: string;
  beforeAll(() => { repo = tinyRepo(); });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const editor = () => stub(fresh(), { folder: repo, baseRef: "HEAD~1" });

  it("never leaves a restored frame open with nothing in it", async () => {
    const { serializer, commands, opened } = editor();
    await (commands.get("odin.review") as () => Promise<void>)();
    expect(opened[0]!.written.some((page) => page.includes('id="app"'))).toBe(true);

    // The reader clicks the graph tab their reload left behind.
    const late = recorder();
    await serializer!.deserializeWebviewPanel(late.panel, undefined);

    const abandoned = !late.disposed && late.written.length === 0;
    expect(abandoned).toBe(false);
  }, 60_000);

  it("shows the graph that is already open rather than rebuilding it", async () => {
    // Reopening on top of a graph would redraw what the reader is reading, and
    // take their place on the page away for the seconds the rebuild takes.
    const { serializer, commands, opened } = editor();
    await (commands.get("odin.review") as () => Promise<void>)();
    const graph = opened[0]!;
    const pages = graph.written.length;

    const late = recorder();
    await serializer!.deserializeWebviewPanel(late.panel, undefined);

    expect(graph.written.length).toBe(pages);
    expect(graph.revealed).toBeGreaterThan(0);
    expect(opened).toHaveLength(1);
  }, 60_000);
});
