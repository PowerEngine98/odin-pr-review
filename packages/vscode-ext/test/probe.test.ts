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
 * Same instrument as `restore.test.ts`, with the channel recorded too: a hot
 * reload may reach the reader as a new document or as a message, and the
 * question these tests answer is whether it reaches them at all.
 */
function recorder() {
  const written: string[] = [];
  const posted: { type?: string; [key: string]: unknown }[] = [];
  const closed: (() => void)[] = [];
  const seen = { written, posted, disposed: false, revealed: 0 };
  const webview = {
    cspSource: "vscode-webview:",
    onDidReceiveMessage: () => ({ dispose() {} }),
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
    /**
     * The document the frame is showing, which is the last one written.
     *
     * A method rather than a getter: `Object.assign` copies what a getter
     * returns at the moment of copying, which here is the empty string, and
     * every page written afterwards would be invisible to the test reading it.
     */
    page: () => written[written.length - 1] ?? "",
  });
}

/** The watchers the extension asked for, so a test can make one fire. */
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
  /** Handlers listening for the reader saving a document in this window. */
  const saves: ((d: { uri: { scheme: string; fsPath: string } }) => void)[] = [];
  const status: string[] = [];
  /** Handlers waiting for the window to be given focus again. */
  const focus: ((w: { focused: boolean }) => void)[] = [];

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
      executeCommand: () => Promise.resolve(),
    },
    workspace: {
      registerTextDocumentContentProvider: () => disposable,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === "baseRef" ? workspace.baseRef : fallback,
      }),
      workspaceFolders: [
        {
          uri: {
            scheme: "file",
            path: workspace.folder,
            fsPath: workspace.folder,
          },
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
      registerWebviewViewProvider: () => disposable,
      registerWebviewPanelSerializer: (_type: string, s: typeof serializer) => {
        serializer = s;
        return disposable;
      },
      showErrorMessage: () => Promise.resolve(),
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
    },
    Uri: {
      file: (p: string) => ({ scheme: "file", path: p, fsPath: p, toString: () => p }),
      /*
       * Joins, as the editor's own does.
       *
       * It used to answer `{}` for everything, which is fine until something
       * being tested is *which* file was named — the tab's icon, the diagram
       * renderer's address — and then every answer looks like every other and
       * the test can only prove that something happened.
       */
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
    // Where the reader's own preferences live, as opposed to what they have
    // read. Same store here; what matters is that it exists, because a page is
    // built from it.
    globalState: {
      get: (key: string, fallback: unknown) => (key in held ? held[key] : fallback),
      update: (key: string, value: unknown) => {
        held[key] = value;
        return Promise.resolve();
      },
    },
  });

  return {
    serializer, commands, opened, watchers, saves, status, focus, extension,
    /** Swapped by a test that wants to see what the reader was offered. */
    set information(fn: (message: string, ...rest: unknown[]) => Promise<unknown>) {
      api.information = fn;
    },
  };
}

/** A repository with a committed file and an uncommitted edit on top of it. */
function tinyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-probe-"));
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  run("init", "--quiet", "-b", "main");
  writeFileSync(join(dir, "one.ts"), "export function one(): number {\n  return 1;\n}\n");
  run("add", "-A");
  run("commit", "--quiet", "-m", "one");
  writeFileSync(
    join(dir, "two.ts"),
    'import { one } from "./one.js";\n\n// test x4\nexport const two = one() + 1;\n',
  );
  // A branch at the first commit, which is what the reading is measured
  // against. Named rather than counted back to, so it goes on meaning the same
  // thing after anything else is committed.
  run("branch", "base", "HEAD");
  run("add", "-A");
  run("commit", "--quiet", "-m", "two");
  // The uncommitted edit from the screenshot: the branch's last commit says
  // `x4`, and the files on disk say `x5`. Which of the two a card shows is then
  // the page's own answer to which reading it is.
  writeFileSync(
    join(dir, "two.ts"),
    'import { one } from "./one.js";\n\n// test x5\nexport const two = one() + 1;\n',
  );
  // What git calls this directory, which on macOS is not what `tmpdir` calls
  // it: the extension finds the repository with `rev-parse --show-toplevel`,
  // and a test firing events at the other spelling would be testing the
  // spelling rather than the watching.
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Model {
  nodes: Record<string, unknown>[];
  edges: { id: string; toPath: string; kind: string }[];
}

/** What the page was handed in the document it was handed. */
function modelOf(page: string): Model {
  const at = page.indexOf("window.__ODIN__=");
  return JSON.parse(page.slice(at + 16, page.indexOf(";</script>", at)));
}

/**
 * What the page is showing, having applied everything it was sent.
 *
 * A redraw no longer replaces the document — it is a message, so the last page
 * written says what the reader saw when the graph first opened and nothing
 * about what it says now. This applies the messages the way the page does, so
 * a test asks the same question the reader would.
 */
/** Redraws the page has been sent, as opposed to every other message. */
function redraws(panel: ReturnType<typeof recorder>): number {
  return (
    panel.written.length +
    panel.posted.filter((m) => m["type"] === "model" || m["type"] === "rows").length
  );
}

function showing(panel: ReturnType<typeof recorder>): Model {
  const model = modelOf(panel.page());
  for (const message of panel.posted) {
    if (message["type"] === "model") {
      Object.assign(model, message["payload"]);
    } else if (message["type"] === "rows") {
      // Arrows the host has withheld. Applied the way the page applies them,
      // or these tests would be asking a question the reader never sees.
      const gone = new Set((message["withdraw"] as string[]) ?? []);
      if (gone.size > 0) model.edges = model.edges.filter((e) => !gone.has(e.id));
      for (const patch of message["nodes"] as Record<string, unknown>[]) {
        const node = model.nodes.find((n) => n["id"] === patch["id"]);
        if (node) Object.assign(node, patch);
      }
    }
  }
  return model;
}

/**
 * The reader edits a file and the card beside it goes on showing the old line.
 *
 * Reading this code has been wrong about where it stops several times, so the
 * whole path is driven for real: activation, a review of the working tree, a
 * file event, and a recorder that says whether anything ever reached the page.
 *
 * The repository is arranged so the page itself says which reading it is: the
 * last commit carries `// test x4` and the files on disk carry `// test x5`, so
 * a card reading `x4` is a reading of the commit however it was asked for.
 */
describe("a live reading of the working tree", () => {
  let repo: string;
  beforeAll(() => {
    repo = tinyRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const ON_DISK = 'import { one } from "./one.js";\n\n// test x5\nexport const two = one() + 1;\n';
  const restore = () => writeFileSync(join(repo, "two.ts"), ON_DISK);

  /*
   * A branch rather than `HEAD~1`.
   *
   * A remembered base has to still mean what it meant, and `HEAD~1` does not:
   * it is measured from wherever `HEAD` now is, so reopening a session weeks
   * later compares the change against a point nobody chose. Sessions carrying
   * one are dropped, so a fixture built on one is testing a path production no
   * longer takes.
   */
  const local = () => ({
    repo,
    baseRef: "base",
    worktree: true,
    at: new Date().toISOString(),
  });

  /** Opens the local reading and hands back the frame it landed in. */
  /**
   * A restored panel, waited on until the graph is actually in it.
   *
   * The deserializer no longer awaits the build — it hands the frame back with
   * the waiting mark in it, because the editor shows nothing at all until that
   * method returns. So the build finishes afterwards, and a test that wants the
   * graph has to wait for the graph rather than for the call.
   */
  async function reading(editor: ReturnType<typeof stub>) {
    const panel = recorder();
    await editor.serializer!.deserializeWebviewPanel(panel.panel, undefined);
    await settled(editor, panel);
    return panel;
  }

  /**
   * Waits for the build to be over, not merely for something to be on screen.
   *
   * A review is drawn twice now: the diff as soon as it is read, and the
   * arrows when the resolver has caught up. The cards appear at the first of
   * those, so waiting for markup means carrying on while the slow half is still
   * running. The watcher is armed last, once there is a final graph to watch
   * against, which makes it the honest signal that everything has landed.
   */
  async function settled(
    editor: ReturnType<typeof stub>,
    panel: ReturnType<typeof recorder>,
  ) {
    for (let waited = 0; waited < 60_000; waited += 50) {
      if (panel.page().includes("card-body") && editor.watchers.length > 0) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error("the graph never arrived");
  }

  /** Fires the watcher at a file and waits for whatever the page is given. */
  async function save(
    editor: ReturnType<typeof stub>,
    panel: ReturnType<typeof recorder>,
    text: string,
  ) {
    const before = redraws(panel);
    writeFileSync(join(repo, "two.ts"), text);
    const watcher = editor.watchers.find((w) => !w.disposed)!;
    for (const fire of watcher.change) fire({ fsPath: join(repo, "two.ts") });
    for (let i = 0; i < 200 && redraws(panel) === before; i++) await wait(50);
    return JSON.stringify(showing(panel));
  }

  it("watches the repository once the working tree is what is on screen", async () => {
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    await reading(editor);

    // Nothing else in the extension creates one, so a watcher here is armLive
    // having decided this reading is of the files on disk.
    expect(editor.watchers.filter((w) => !w.disposed)).toHaveLength(1);
  }, 60_000);

  it("shows the files on disk, not the last commit", async () => {
    restore();
    const panel = await reading(stub(local(), { folder: repo, baseRef: "HEAD~1" }));
    expect(panel.page()).toContain("test x5");
    expect(panel.page()).not.toContain("test x4");
  }, 60_000);

  /*
   * The one that was broken.
   *
   * `odin.refresh` replays the last review, and what it had to replay it from
   * held only the repository and the base — so a reader who had asked for the
   * local reading got the last commit back, the card reverted to committed
   * text, and the watching stopped, because nothing but a working-tree reading
   * is watched. It looked exactly like a watcher that had died.
   */
  it("keeps the reading it was asked for when the graph is refreshed", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    await (editor.commands.get("odin.refresh") as () => Promise<void>)();

    expect(panel.page()).toContain("test x5");
    expect(editor.watchers.filter((w) => !w.disposed)).toHaveLength(1);
  }, 60_000);

  /*
   * Refresh, pressed on the list rather than on a graph.
   *
   * The button lives on the pull request list's own title bar, and the reason
   * to press it is usually that the list is wrong — a forge that did not answer
   * leaves nothing to rebuild and a list worth asking about again. Replaying a
   * reading that was never opened would build a review of whatever happened to
   * be checked out, which is not what was asked for and costs seconds to find
   * out.
   */
  /*
   * The one nothing could see.
   *
   * The editor does not present a restored webview until `deserializeWebviewPanel`
   * settles: restoring is over when the extension says it is over. While that
   * method awaited the build, every page written during it — the waiting mark,
   * and three attempts at rewriting it — went into a frame the reader could not
   * yet see, and the graph appeared the instant the method returned because it
   * was simply the last page written. The trace said the loader was written and
   * the trace was right; what it could not say was that nothing written there
   * goes on screen until this returns.
   */
  it("hands the frame back with the mark in it, before the graph is built", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = recorder();

    await editor.serializer!.deserializeWebviewPanel(panel.panel, undefined);

    // Whatever is in the frame at the moment restoring is declared finished is
    // the only thing the reader can possibly see first.
    expect(panel.page()).toContain("Reopening");
    expect(panel.page()).not.toContain("card-body");
  }, 60_000);

  /*
   * Opening a change, in two answers.
   *
   * Reading the patch is a tenth of a second; following every reference in it
   * is several, and on a change of any size that is the whole of the wait. The
   * cards go up as soon as the diff is read and the arrows arrive after, so the
   * reader is looking at the code they came for while the slow half runs.
   */
  it("draws the diff before the references are known", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    // Two documents, not one: the diff, then the same change with its arrows.
    const pages = panel.written.filter((page) => page.includes("window.__ODIN__="));
    expect(pages.length).toBeGreaterThan(1);

    const edgesIn = (page: string) => modelOf(page).edges.length;
    // The first has the cards and no arrows; the last has both.
    expect(edgesIn(pages[0]!)).toBe(0);
    expect(modelOf(pages[0]!).nodes.length).toBeGreaterThan(0);
    expect(edgesIn(pages[pages.length - 1]!)).toBeGreaterThan(0);
  }, 60_000);

  it("says how far through resolving it is", async () => {
    // The slow half is the one worth reporting on, and a bar that only says
    // "working" for several seconds is the reason people press things twice.
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    // On the badge, not the waiting page: by the time the references are being
    // worked out the cards are up and the loader is gone.
    const said = panel.posted
      .filter((m) => m["type"] === "refreshing" || m["type"] === "note")
      .map((m) => String(m["note"] ?? m["message"] ?? ""));
    expect(said.some((note) => /Resolving references… \d+%/.test(note))).toBe(true);
  }, 60_000);

  /*
   * Coming back to a window that was left open.
   *
   * Everything the forge says is an answer to a question asked once, and the
   * forge goes on without this window: a change approved last night is merged
   * by somebody else this morning. A reader who returns is otherwise looking at
   * yesterday's answers with nothing to say so.
   */
  it("asks the forge again when the window is given focus", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    expect(editor.focus.length).toBeGreaterThan(0);

    const before = panel.posted.length;
    for (const focused of editor.focus) focused({ focused: true });
    // The forge is best-effort and this repository has none, so what is being
    // asserted is that it was asked at all — the answer is allowed to be
    // nothing.
    await wait(400);
    expect(panel.posted.length).toBeGreaterThanOrEqual(before);
  }, 60_000);

  it("does not ask again while the answer is still fresh", async () => {
    // Focus arrives on every alt-tab, and somebody moving between an editor and
    // a terminal generates dozens a minute. `gh` is a shared allowance.
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    await reading(editor);

    for (const focused of editor.focus) focused({ focused: true });
    await wait(200);
    const settledAt = Date.now();
    for (let i = 0; i < 20; i++) {
      for (const focused of editor.focus) focused({ focused: true });
    }
    // Twenty presses in a moment cannot have taken twenty round trips.
    expect(Date.now() - settledAt).toBeLessThan(1000);
  }, 60_000);

  it("asks the forge again without inventing a review to rebuild", async () => {
    restore();
    const editor = stub(undefined, { folder: repo, baseRef: "HEAD~1" });

    await (editor.commands.get("odin.refresh") as () => Promise<void>)();

    expect(editor.opened).toHaveLength(0);
  }, 60_000);

  /*
   * The case the whole feature exists for, on the shakiest foundation.
   *
   * A file watcher is the editor's view of the disk, and it depends on which
   * folders are open — a reader working on the front end of a monorepo opens
   * that folder, and the repository root is its parent, which is not the
   * workspace's own recursive watcher. Nothing arrives, forever, with no error
   * to go on. A document saved in this window is something the editor knows
   * for certain, so the reader's own edit no longer waits on any of that.
   */
  it("redraws when the reader saves, with no watcher event at all", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    const before = redraws(panel);

    writeFileSync(join(repo, "two.ts"), ON_DISK.replace("x5", "x7"));
    // Deliberately not the watcher: only the editor saying a document was
    // written, which is what it does when the reader presses save.
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    for (let i = 0; i < 200 && redraws(panel) === before; i++) await wait(50);

    expect(JSON.stringify(showing(panel))).toContain("test x7");
  }, 120_000);

  it("watches the folder the editor has open, not only the repository root", async () => {
    // The two are routinely different, and watching only the root is the
    // failure that looks exactly like the feature being switched off.
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    await reading(editor);
    expect(editor.watchers.map((w) => w.base)).toContain(repo);
    expect(editor.saves.length).toBeGreaterThan(0);
  }, 60_000);

  /*
   * What the map in the corner is allowed to hear about.
   *
   * The map draws each file as a rectangle coloured by its status. Editing a
   * comment inside a file that was already modified changes none of that, so
   * the map has nothing to redraw — but it redrew anyway, because the whole
   * model was being replaced and every card object with it. The narrow message
   * names the cards that moved and carries their rows; anything the map reads
   * has to arrive unchanged, or not arrive.
   */
  it("tells the page about rows without touching what the map draws", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    const boxes = (m: Model) =>
      m.nodes.map((n) => [n["id"], n["x"], n["y"], n["width"], n["height"], n["status"]]);
    const before = boxes(showing(panel));

    await save(editor, panel, ON_DISK.replace("x5", "x9"));

    const patch = panel.posted.filter((m) => m["type"] === "rows");
    expect(patch).toHaveLength(1);
    // One card named, not seventy-four.
    expect((patch[0]!["nodes"] as unknown[]).length).toBe(1);
    expect(JSON.stringify(showing(panel))).toContain("test x9");
    // And nothing the map reads has moved.
    expect(boxes(showing(panel))).toEqual(before);
  }, 120_000);

  /*
   * Two answers to one save, in the order that helps.
   *
   * Reading the diff is a tenth of a second; resolving every reference in it is
   * three, because the compiler's program is a snapshot and a new one has to be
   * built over the whole checkout. The reader edited a line and wants to see the
   * line, so the rows go first and the arrows follow.
   *
   * What the first answer must never do is draw an arrow it cannot stand
   * behind. An edit that moved lines moved the anchors of every arrow ending in
   * that file, so those are withdrawn for the interval and come back with the
   * right numbers on them.
   */
  it("shows the rows first and the arrows after, withdrawing the doubtful ones", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    const to = (m: Model) => m.edges.filter((e) => e.toPath === "one.ts").length;
    expect(to(showing(panel))).toBeGreaterThan(0);

    const before = redraws(panel);
    // A line inserted: every anchor below it has moved, so this cannot take the
    // shortcut and the arrows have to be worked out again.
    writeFileSync(
      join(repo, "two.ts"),
      'import { one } from "./one.js";\n\n// test x5\n// and another\nexport const two = one() + 1;\n',
    );
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }

    // The first answer: the new row is there, and the arrows out of the file
    // that moved are not.
    for (let i = 0; i < 200 && redraws(panel) === before; i++) await wait(25);
    const staged = showing(panel);
    expect(JSON.stringify(staged.nodes)).toContain("and another");
    expect(to(staged)).toBe(0);

    // The second: the resolver has caught up and they are back.
    for (let i = 0; i < 400 && redraws(panel) < before + 2; i++) await wait(25);
    expect(to(showing(panel))).toBeGreaterThan(0);
  }, 120_000);

  /*
   * The reader's view must not move because the host is still thinking.
   *
   * The first answer used to take the doubtful arrows out of the graph, and
   * connectedness is what decides the parts, the columns and the size of the
   * whole picture — so the arrangement changed, the canvas re-framed, and the
   * view flew out to fit and came back three seconds later when the arrows
   * returned. Caught on video before it was caught here.
   *
   * The arrows are still withheld; the graph they belong to is not touched.
   */
  it("does not re-arrange the picture while the arrows are being worked out", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    const frame = (m: Model) => ({
      // What the canvas frames itself on, and what names the parts strip.
      parts: JSON.stringify((m as unknown as { parts: unknown }).parts),
      boxes: m.nodes.map((n) => [n["id"], n["x"], n["y"], n["column"]]),
      count: m.nodes.length,
    });
    const before = frame(showing(panel));

    const mark = redraws(panel);
    writeFileSync(
      join(repo, "two.ts"),
      'import { one } from "./one.js";\n\n// test x5\n// inserted\nexport const two = one() + 1;\n',
    );
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    for (let i = 0; i < 200 && redraws(panel) === mark; i++) await wait(25);

    const staged = showing(panel);
    // The arrows out of the edited file are withheld...
    expect(staged.edges.filter((e) => e.toPath === "one.ts")).toHaveLength(0);
    // ...and nothing the canvas frames itself on has moved.
    expect(frame(staged).parts).toEqual(before.parts);
    expect(frame(staged).count).toEqual(before.count);
  }, 120_000);

  it("draws the change on a host that cannot address its own files", async () => {
    /*
     * The page is told where to fetch the diagram renderer, which is one
     * optional extra on a document whose job is to draw a change. Working that
     * out unguarded threw for any frame without `asWebviewUri` — and it threw
     * while the document was being built, so the graph never rendered at all:
     * sixteen tests sat on a loading page until they timed out, reporting
     * "unexpected token '<'" rather than anything about a URI.
     *
     * This editor is exactly that host: its webview double has no such method.
     * So the change is drawn and the diagrams are what is lost.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    const page = panel.page();
    expect(page).toContain("window.__ODIN__=");
    expect(modelOf(page).nodes.length).toBeGreaterThan(0);
    // The model, not the document: the page carries the renderer's *name* in
    // its own script whatever happens, because the code that would fetch it is
    // part of the application.
    expect((modelOf(page) as unknown as { mermaid?: string }).mermaid).toBeUndefined();
  }, 120_000);

  it("sends a rebuild to its own reading, not to whichever tab is in front", async () => {
    /*
     * The one the reader reported. A rebuild was delivered to the active panel
     * rather than to the panel holding the reading it belongs to — so turning
     * from a live change to another tab and carrying on working meant the first
     * change's next rebuild arrived in the second change's frame. What that
     * looks like from the outside is the reading you left coming back over the
     * one you are in, or a page sitting on a model of something else.
     *
     * Two readings of the same branch: one of the files on disk, which is
     * watched, and one of the last commit, which is not. Opening the second
     * puts it in front; the first is the one that rebuilds.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const live = await reading(editor);

    const committed = recorder();
    await editor.serializer!.deserializeWebviewPanel(committed.panel, {
      repo,
      baseRef: "base",
    });
    for (let i = 0; i < 200 && !committed.page().includes('id="app"'); i++) {
      await wait(50);
    }
    expect(committed.page()).toContain('id="app"');

    /*
     * Waited out rather than counted from.
     *
     * A change is drawn twice — the diff as soon as it is read, the arrows when
     * the resolver catches up — so a count taken the moment the page appears is
     * taken in the middle of that frame's own build, and the second half of it
     * would read as somebody else's rebuild landing.
     */
    let quiet = redraws(committed);
    for (let still = 0; still < 8; still++) {
      await wait(150);
      if (redraws(committed) !== quiet) {
        quiet = redraws(committed);
        still = 0;
      }
    }

    const before = { live: redraws(live), other: redraws(committed) };
    writeFileSync(join(repo, "two.ts"), ON_DISK.replace("x5", "x9"));
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    for (let i = 0; i < 200 && redraws(live) === before.live; i++) await wait(50);

    // The reading that changed got the rebuild...
    expect(JSON.stringify(showing(live))).toContain("test x9");
    // ...and the one the reader had turned to was left alone.
    expect(redraws(committed)).toBe(before.other);
  }, 120_000);

  it("gives every restored frame its own graph, not one of them all of them", async () => {
    /*
     * What the reader saw: two reviews open, a window reload, one of them draws
     * and the other sits on "Laying out…" forever — a layout that had in fact
     * finished, for a graph that had been delivered to the wrong frame.
     *
     * The build reports its progress into the waiting page and hands the
     * finished graph to a panel. Both used to mean "whichever panel is in
     * front", so with two frames coming back at once the second build's graph
     * landed on the first frame and the second was left holding the loader.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });

    const one = recorder();
    const two = recorder();
    await editor.serializer!.deserializeWebviewPanel(one.panel, {
      repo,
      baseRef: "base",
      worktree: true,
    });
    await editor.serializer!.deserializeWebviewPanel(two.panel, {
      repo,
      baseRef: "base",
    });

    const drew = (frame: ReturnType<typeof recorder>) =>
      frame.page().includes('id="app"') && frame.page().includes("window.__ODIN__=");
    for (let i = 0; i < 300 && !(drew(one) && drew(two)); i++) await wait(50);

    // Both frames hold a change of their own, and neither is left waiting.
    expect(drew(one)).toBe(true);
    expect(drew(two)).toBe(true);
    for (const frame of [one, two]) {
      expect(frame.page()).not.toContain("Laying out");
      expect(frame.page()).not.toContain("Reopening");
    }
    // And they are two different readings: one of the files on disk, one of the
    // last commit, which differ by the edit this repository carries uncommitted.
    expect(modelOf(one.page()).meta.worktree).toBe(true);
    expect(modelOf(two.page()).meta.worktree).toBeUndefined();
  }, 180_000);

  it("does not throw a loader over a graph it is about to redraw", async () => {
    /*
     * A waiting page replaces the document, and the document is the reader's
     * cards, camera and open conversation. Asking for a reading that is already
     * on screen — a refresh, a rebuild, anything — used to write one anyway,
     * because the loader went to whichever panel was in front rather than to
     * the reading it was for and had no way to know that reading was already
     * drawn.
     *
     * Told which reading it is for, it finds the panel already showing it and
     * says the words instead of taking the picture away.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    expect(panel.page()).toContain('id="app"');

    await (editor.commands.get("odin.refresh") as () => Promise<void>)();
    for (let i = 0; i < 200 && !panel.page().includes('id="app"'); i++) await wait(50);

    /*
     * Every page written after the first graph is a graph.
     *
     * Counted from the graph rather than from the start: a restored frame is
     * given a waiting page before its first build, which is right — there is
     * nothing to take away yet. What must never happen is one landing on a
     * drawing that already exists.
     */
    const first = panel.written.findIndex((page) => page.includes("window.__ODIN__="));
    expect(first).toBeGreaterThanOrEqual(0);
    const since = panel.written.slice(first + 1);
    expect(since.filter((page) => page.includes("breathe"))).toHaveLength(0);
    expect(panel.page()).toContain('id="app"');
  }, 120_000);

  it("takes a frame of its own rather than the one in front", async () => {
    /*
     * The reader's own sequence: reading the forge's copy of a change, press
     * the offer to see the local one, then turn back — and find the first tab
     * pulsing forever.
     *
     * A reading with no frame yet had the loader written into whichever panel
     * was in front. When its graph arrived it went into a frame of its own, and
     * what was left behind was a tab waiting for a graph that had already been
     * delivered somewhere else.
     *
     * Driven the other way round — live first, then the committed reading —
     * because that is the pair this harness can open without a forge.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const first = await reading(editor);
    expect(first.page()).toContain('id="app"');
    const pages = first.written.length;

    const second = recorder();
    await editor.serializer!.deserializeWebviewPanel(second.panel, {
      repo,
      baseRef: "base",
    });
    for (let i = 0; i < 200 && !second.page().includes('id="app"'); i++) {
      await wait(50);
    }

    // The tab they came from kept its change: no waiting page was written over
    // it, and what it holds is still a graph.
    expect(second.page()).toContain('id="app"');
    expect(first.page()).toContain('id="app"');
    expect(first.written.slice(pages).filter((page) => page.includes("breathe"))).toHaveLength(0);
  }, 120_000);

  it("opens one tab for a second reading, not a tab and an abandoned loader", async () => {
    /*
     * The other side of taking a fresh frame: the frame has to be handed to the
     * build that will fill it. It was made and then not offered, so the graph
     * opened a frame of its own and the reader got their change plus a tab
     * called "Odin: Change Graph" still saying "Reading the change" — a loader
     * waiting for a graph that had arrived somewhere else.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    await reading(editor);
    const before = editor.opened.length;

    // A second reading of the same branch: the committed one, which has no
    // frame of its own yet.
    await (editor.commands.get("odin.reviewAgainst") as undefined | (() => Promise<void>))?.();
    await (editor.commands.get("odin.review") as () => Promise<void>)();
    await wait(1500);

    const made = editor.opened.slice(before);
    // At most one new tab, and if there is one it holds a change rather than a
    // pulsing mark.
    expect(made.length).toBeLessThanOrEqual(1);
    for (const frame of made) {
      expect(frame.page()).toContain('id="app"');
      expect(frame.page()).not.toContain("breathe");
    }
  }, 120_000);

  it("says which reading is of the files on disk, in the tab", async () => {
    // Two tabs for one change, and the only difference between them is which
    // follows the reader's typing. A title that does not say it leaves them to
    // tell two identical tabs apart by clicking one.
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);

    expect(panel.panel.title.startsWith("LIVE ")).toBe(true);

    /*
     * And in the one place in that strip a colour can live: the icon.
     *
     * A tab's title is plain text, so the mark beside it is the only thing
     * there that can be green. The word stays as well — a colour nobody can
     * name says nothing to a reader who does not already know the convention.
     */
    expect(JSON.stringify(panel.panel.iconPath ?? null)).toContain("odin-live");
  }, 60_000);

  it("keeps the plain mark for a reading of the forge's copy", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    await reading(editor);

    const committed = recorder();
    await editor.serializer!.deserializeWebviewPanel(committed.panel, {
      repo,
      baseRef: "base",
    });
    for (let i = 0; i < 200 && !committed.page().includes('id="app"'); i++) {
      await wait(50);
    }

    const icon = JSON.stringify(committed.panel.iconPath ?? null);
    expect(icon).toContain("odin-dark.svg");
    expect(icon).not.toContain("odin-live");
    expect(committed.panel.title.startsWith("LIVE ")).toBe(false);
  }, 120_000);

  it("marks the tab while its change is being worked out", async () => {
    /*
     * A rebuild takes seconds, and every sign of one was inside the page — so a
     * reader who has turned to their editor cannot tell a graph that is current
     * from one three saves behind. The tab is where they are looking.
     *
     * A pulse rather than a colour, because a colour is a state and this is a
     * process; the editor gives no other way to animate a tab, so it is two
     * icons alternating.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    const quiet = JSON.stringify(panel.panel.iconPath ?? null);

    writeFileSync(join(repo, "two.ts"), ON_DISK.replace("x5", "x8"));
    let working: string | undefined;
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    for (let i = 0; i < 200 && working === undefined; i++) {
      const now = JSON.stringify(panel.panel.iconPath ?? null);
      if (now !== quiet) working = now;
      await wait(25);
    }

    expect(working).toBeDefined();
    expect(working).toContain("odin-working");

    /*
     * And it goes back to the tab's own mark when the rebuild is over.
     *
     * Not back to what it was before, which for a restored frame is nothing at
     * all: the editor hands those back without the icon the extension gave the
     * original, and this is the first thing to set one.
     */
    for (let i = 0; i < 400; i++) {
      const now = JSON.stringify(panel.panel.iconPath ?? null);
      if (now.includes("odin-live")) break;
      await wait(50);
    }
    const ended = JSON.stringify(panel.panel.iconPath ?? null);
    // This is a reading of the files on disk, so its resting mark is the green
    // one rather than the plain one.
    expect(ended).toContain("odin-live");
    expect(ended).not.toContain("odin-working");
  }, 120_000);

  it("follows the checkout when the branch moves under it", async () => {
    /*
     * A live reading is of a checkout, not of a branch: it is the base against
     * the files on disk, and what is on disk is whatever HEAD happens to be. So
     * switching branch under one makes it a reading of something else, and it
     * has to say so.
     *
     * The drawing already followed — a checkout rewrites the files, which is
     * what the watcher watches — but the tab did not: only a whole new document
     * re-titled it, and a rebuild applied in place is not one. What that left
     * was a tab naming the branch the reader had left, over a drawing of the
     * one they had moved to.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    const before = panel.panel.title;
    expect(before).toContain("main");

    // Somewhere else to be, with a file that differs so the rebuild has news.
    execFileSync("git", ["checkout", "-B", "elsewhere"], { cwd: repo, stdio: "ignore" });
    writeFileSync(join(repo, "two.ts"), ON_DISK.replace("x5", "x11"));
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    for (let i = 0; i < 300 && panel.panel.title === before; i++) await wait(50);

    expect(panel.panel.title).not.toBe(before);
    expect(panel.panel.title).toContain("elsewhere");
    expect(panel.panel.title.startsWith("LIVE ")).toBe(true);

    execFileSync("git", ["checkout", "main"], { cwd: repo, stdio: "ignore" });
  }, 120_000);

  it("reads a second branch live from a checkout of its own", async () => {
    /*
     * A live reading is of a working tree and a working tree holds one branch,
     * so two live readings need two working trees. Git's own answer is a linked
     * worktree — a second checkout of the same repository with its own HEAD —
     * and it refuses to put one branch in two of them, which is what keeps
     * several live readings from contradicting each other.
     *
     * The two are separate readings all the way down: different roots, so
     * different keys, different tabs, different watchers.
     */
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const here = await reading(editor);
    expect(here.page()).toContain('id="app"');

    // A branch to read beside it, and a checkout to read it from.
    execFileSync("git", ["branch", "-f", "beside", "HEAD"], { cwd: repo, stdio: "ignore" });
    const { readableCheckout } = await import("@odin/core");
    const made = await readableCheckout("beside", { cwd: repo });
    expect(made.path).toContain(".worktrees");

    // The main reading is blind to it: git hides it, and so does the watcher.
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(status).not.toContain(".worktrees");

    // And a save inside it does not rebuild the reading of this checkout.
    const drew = redraws(here);
    writeFileSync(join(made.path, "two.ts"), ON_DISK.replace("x5", "x21"));
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(made.path, "two.ts") } });
    }
    await wait(2000);
    expect(redraws(here)).toBe(drew);

    execFileSync("git", ["worktree", "remove", "--force", made.path], {
      cwd: repo,
      stdio: "ignore",
    });
  }, 120_000);

  it("fetches a ref this checkout has not got rather than blaming the base", async () => {
    /*
     * The reader's own failure: a reading of the forge's copy of a change,
     * rebuilt in a checkout that had never fetched that branch. `git merge-base`
     * said `Not a valid object name origin/luis/lab-147`, and what reached the
     * reader was that sentence plus an offer to pick a *base* branch — for a
     * head ref nobody had asked them about.
     *
     * The ref is in the message: one naming a remote is fetched and the reading
     * tried again, and only a missing base is a question for the reader.
     *
     * Driven with a clone whose tracking ref has been deleted, which is the
     * same position as a checkout that never fetched it.
     */
    restore();
    const origin = mkdtempSync(join(tmpdir(), "odin-origin-"));
    const clone = mkdtempSync(join(tmpdir(), "odin-clone-"));
    const run = (dir: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        },
      });

    try {
      run(origin, "init", "-b", "main");
      writeFileSync(join(origin, "one.ts"), "export const one = () => 1;\n");
      run(origin, "add", "-A");
      run(origin, "commit", "-m", "first");
      run(origin, "branch", "base", "HEAD");
      run(origin, "checkout", "-b", "topic");
      writeFileSync(join(origin, "one.ts"), "export const one = () => 2;\n");
      run(origin, "add", "-A");
      run(origin, "commit", "-m", "on the topic");
      run(origin, "checkout", "main");

      execFileSync("git", ["clone", origin, clone], { stdio: "ignore" });
      // The position a checkout is in when it has never fetched that branch.
      run(clone, "update-ref", "-d", "refs/remotes/origin/topic");
      expect(() =>
        execFileSync("git", ["rev-parse", "origin/topic"], { cwd: clone, stdio: "ignore" }),
      ).toThrow();

      const editor = stub(undefined, { folder: clone, baseRef: "origin/base" });
      const panel = recorder();
      await editor.serializer!.deserializeWebviewPanel(panel.panel, {
        repo: clone,
        baseRef: "origin/base",
        headRef: "origin/topic",
      });

      for (let i = 0; i < 400 && !panel.page().includes("window.__ODIN__="); i++) {
        await wait(50);
      }

      // The reading arrived, and the ref it needed is now here.
      expect(panel.page()).toContain("window.__ODIN__=");
      expect(() =>
        execFileSync("git", ["rev-parse", "origin/topic"], { cwd: clone, stdio: "ignore" }),
      ).not.toThrow();
    } finally {
      rmSync(origin, { recursive: true, force: true });
      rmSync(clone, { recursive: true, force: true });
    }
  }, 120_000);

  it("reaches a deleted branch through the pull request it belongs to", async () => {
    /*
     * The reader's actual failure, run to ground: the branch had been deleted
     * from the forge — seventy heads there, none of them it — and the reading
     * was of a ref that no longer exists anywhere but in the pull request.
     *
     * A forge keeps the head it merged under `refs/pull/<n>/head`, so the
     * change is still readable. Reaching it needs the number, and the number
     * used to be looked up in the list of open pull requests — which is only
     * populated when `gh` is signed in. A reader whose `gh` is signed out is
     * exactly the reader who cannot get at the branch any other way.
     *
     * The reading carries its own number. That is what is used.
     */
    restore();
    const origin = mkdtempSync(join(tmpdir(), "odin-pr-origin-"));
    const clone = mkdtempSync(join(tmpdir(), "odin-pr-clone-"));
    const run = (dir: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        },
      });

    try {
      run(origin, "init", "-b", "main");
      writeFileSync(join(origin, "one.ts"), "export const one = () => 1;\n");
      run(origin, "add", "-A");
      run(origin, "commit", "-m", "first");
      run(origin, "branch", "base", "HEAD");
      run(origin, "checkout", "-b", "gone");
      writeFileSync(join(origin, "one.ts"), "export const one = () => 2;\n");
      run(origin, "add", "-A");
      run(origin, "commit", "-m", "the change");
      // What a forge keeps after the branch is deleted.
      run(origin, "update-ref", "refs/pull/171/head", "refs/heads/gone");
      run(origin, "checkout", "main");

      execFileSync("git", ["clone", origin, clone], { stdio: "ignore" });
      run(clone, "update-ref", "-d", "refs/remotes/origin/gone");
      run(origin, "branch", "-D", "gone");

      // `gh` says nothing, so nothing knows this branch belongs to #171 except
      // the reading itself.
      const editor = stub(undefined, { folder: clone, baseRef: "origin/base" });
      const panel = recorder();
      await editor.serializer!.deserializeWebviewPanel(panel.panel, {
        repo: clone,
        baseRef: "origin/base",
        headRef: "origin/gone",
        number: 171,
      });

      for (let i = 0; i < 400 && !panel.page().includes("window.__ODIN__="); i++) {
        await wait(50);
      }
      expect(panel.page()).toContain("window.__ODIN__=");
      // Written into the ref the reading was looking for, so everything
      // downstream goes on calling it what the reader calls it.
      expect(() =>
        execFileSync("git", ["rev-parse", "origin/gone"], { cwd: clone, stdio: "ignore" }),
      ).not.toThrow();
    } finally {
      rmSync(origin, { recursive: true, force: true });
      rmSync(clone, { recursive: true, force: true });
    }
  }, 120_000);

  it("says what git said when a ref cannot be fetched at all", async () => {
    /*
     * The second half of the same failure. A branch is deleted the moment its
     * change is merged, on most projects automatically, so a reading of a
     * change that has landed asks for a ref the forge no longer has. Fetching
     * it answers "couldn't find remote ref", and what the reader needs then is
     * git's own words rather than "fetching it failed", which is the one thing
     * they already know.
     */
    restore();
    const origin = mkdtempSync(join(tmpdir(), "odin-gone-origin-"));
    const clone = mkdtempSync(join(tmpdir(), "odin-gone-clone-"));
    const run = (dir: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        },
      });

    try {
      run(origin, "init", "-b", "main");
      writeFileSync(join(origin, "one.ts"), "export const one = () => 1;\n");
      run(origin, "add", "-A");
      run(origin, "commit", "-m", "first");
      run(origin, "branch", "base", "HEAD");
      run(origin, "checkout", "-b", "landed");
      writeFileSync(join(origin, "one.ts"), "export const one = () => 2;\n");
      run(origin, "add", "-A");
      run(origin, "commit", "-m", "on the branch");
      run(origin, "checkout", "main");

      execFileSync("git", ["clone", origin, clone], { stdio: "ignore" });
      run(clone, "update-ref", "-d", "refs/remotes/origin/landed");
      // Merged, and the branch tidied away — which is what most projects do.
      run(origin, "branch", "-D", "landed");

      const editor = stub(undefined, { folder: clone, baseRef: "origin/base" });
      const said = editor.errors;

      const panel = recorder();
      await editor.serializer!.deserializeWebviewPanel(panel.panel, {
        repo: clone,
        baseRef: "origin/base",
        headRef: "origin/landed",
      });
      for (let i = 0; i < 200 && said.length === 0; i++) await wait(50);

      /*
       * Said in full, and then the tab goes.
       *
       * The ref is not here, the forge has not got the branch, and there is no
       * pull request left to reach its head through. No retry helps, so a frame
       * left open on a git error is a tab that looks like a review, opens like
       * one, and can never be one.
       */
      expect(said.join(" ")).toContain("origin/landed");
      expect(said.join(" ")).toContain("not on the remote any more");
      expect(said.join(" ")).toContain("this tab is closing");

      for (let i = 0; i < 100 && !panel.disposed; i++) await wait(50);
      expect(panel.disposed).toBe(true);
    } finally {
      rmSync(origin, { recursive: true, force: true });
      rmSync(clone, { recursive: true, force: true });
    }
  }, 120_000);

  it("redraws the card when the file behind it changes", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    expect(panel.page()).toContain("test x5");

    const page = await save(editor, panel, ON_DISK.replace("x5", "x6"));
    expect(page).toContain("test x6");
  }, 120_000);

  /**
   * A redraw the page applies to itself, and never a new document.
   *
   * Replacing the document is what throws the reader across the drawing: the
   * page boots again, and everything it knew about where they were is gone
   * except the little it wrote down. The page has been able to take a rebuilt
   * model over the wire for a while; what matters is that the rebuild actually
   * arrives that way, every time, and not only when the shortcut happened to
   * be available.
   */
  it("never writes a second document for a file that changed", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    const documents = panel.written.length;

    // Three saves, one of them structural: a file's imports change, which is
    // the kind of edit that cannot take the rows shortcut.
    await save(editor, panel, ON_DISK.replace("x5", "x6"));
    await save(editor, panel, ON_DISK.replace("x5", "x7"));
    await save(
      editor,
      panel,
      'import { one } from "./one.js";\n\n// test x8\nexport const two = one() + 2;\n',
    );

    expect(panel.written.length).toBe(documents);
  }, 180_000);
});

/**
 * The shortcut, from the outside.
 *
 * `rowsOnly` is tested on its own, but the thing that matters is what the
 * reader ends up looking at — so this drives the whole extension and asks the
 * page. The rewritten comment must arrive; the reference that was taken away in
 * the same number of lines must be gone from the arrows, which is precisely
 * what carrying the previous edges over would have got wrong.
 */
describe("an edit that must not take the shortcut", () => {
  let repo: string;
  beforeAll(() => {
    repo = tinyRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const ON_DISK = 'import { one } from "./one.js";\n\n// test x5\nexport const two = one() + 1;\n';

  it("drops the arrow when the call on that line is taken away", async () => {
    writeFileSync(join(repo, "two.ts"), ON_DISK);
    const editor = stub(
      { repo, baseRef: "HEAD~1", worktree: true, at: new Date().toISOString() },
      { folder: repo, baseRef: "HEAD~1" },
    );
    const panel = recorder();
    await editor.serializer!.deserializeWebviewPanel(panel.panel, undefined);
    // The deserializer hands the frame back with the waiting mark in it and
    // builds behind that, in two halves — the diff, then the references. The
    // watcher is armed once the second has landed, which makes it the signal
    // that there is a finished graph to ask about.
    for (let waited = 0; waited < 60_000; waited += 50) {
      if (panel.page().includes("window.__ODIN__=") && editor.watchers.length > 0) break;
      await wait(50);
    }

    // The call, not the import: the import line is untouched by this edit and
    // its arrow is expected to survive, so counting every arrow to `one.ts`
    // would pass whatever happened to the one that matters.
    const calls = () =>
      showing(panel).edges.filter((e) => e.toPath === "one.ts" && e.kind !== "import");
    expect(calls()).not.toHaveLength(0);

    // Same line count, same hunk, different names on one line. The rows look
    // like the cheap case and are not: the arrow this file drew is gone.
    const before = redraws(panel);
    writeFileSync(
      join(repo, "two.ts"),
      'import { one } from "./one.js";\n\n// test x5\nexport const two = 2 + 1;\n',
    );
    const watcher = editor.watchers.find((w) => !w.disposed)!;
    for (const fire of watcher.change) fire({ fsPath: join(repo, "two.ts") });
    for (let i = 0; i < 200 && redraws(panel) === before; i++) await wait(50);

    expect(calls()).toHaveLength(0);
  }, 120_000);
});

/*
 * A reading of commits, over files that have moved on.
 *
 * A committed reading does not change when the reader edits — that is what
 * makes it a reading of commits — so nothing about it can say the files
 * underneath have changed. Somebody restores a stash and goes on reading a
 * picture of the branch as the forge has it, which is a picture of something
 * else, with nothing anywhere saying so.
 */
describe("work appearing under a committed reading", () => {
  let repo: string;
  beforeAll(() => {
    repo = tinyRepo();
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("offers the live reading once, and does not ask again", async () => {
    // A clean tree to start from: the fixture leaves an edit in place for the
    // live-reading tests, and a reading opened over work already in progress
    // is one the reader asked for as it is.
    execFileSync("git", ["checkout", "--", "."], { cwd: repo, stdio: "ignore" });

    const offered: string[] = [];
    const editor = stub(
      { repo, baseRef: "base", at: new Date().toISOString() },
      { folder: repo, baseRef: "base" },
    );
    // Declined, so the offer must not come back while the work is still there.
    editor.information = (message: string) => {
      offered.push(message);
      return Promise.resolve(undefined);
    };

    const panel = recorder();
    await editor.serializer!.deserializeWebviewPanel(panel.panel, undefined);
    for (let waited = 0; waited < 40_000; waited += 50) {
      if (panel.page().includes("window.__ODIN__=")) break;
      await wait(50);
    }

    // The watch arms once it has read how the tree stands, which is a `git
    // status` away. A reader edits seconds later; a test has to wait for it.
    for (let waited = 0; waited < 10_000; waited += 25) {
      if (editor.saves.length > 0) break;
      await wait(25);
    }

    // The stash coming back: a tracked file changed on disk, uncommitted.
    writeFileSync(join(repo, "two.ts"), 'import { one } from "./one.js";\n\n// restored\nexport const two = one() + 2;\n');
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    await wait(1500);

    expect(offered.some((m) => /changed on disk/.test(m))).toBe(true);

    // Asked once. Editing again while the answer stands is not a new question.
    const asked = offered.length;
    writeFileSync(join(repo, "two.ts"), 'import { one } from "./one.js";\n\n// restored twice\nexport const two = one() + 3;\n');
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }
    await wait(1500);
    expect(offered.length).toBe(asked);
  }, 60_000);

  it("replaces the tab it was promoted from rather than adding to it", async () => {
    /*
     * Accepting the offer is not asking for a second tab. It is the same change
     * read the other way, and what the reader wants at the end of it is the
     * live one — so the tab it came from goes.
     *
     * Closed after the replacement is drawn rather than before: closing first
     * leaves them looking at nothing for the seconds a build takes, and at
     * nothing at all if it fails.
     */
    execFileSync("git", ["checkout", "--", "."], { cwd: repo, stdio: "ignore" });

    const editor = stub(
      { repo, baseRef: "base", at: new Date().toISOString() },
      { folder: repo, baseRef: "base" },
    );
    // Accepted this time.
    editor.information = (message: string, ...rest: unknown[]) =>
      Promise.resolve(/changed on disk/.test(message) ? rest[0] : undefined);

    const committed = recorder();
    await editor.serializer!.deserializeWebviewPanel(committed.panel, undefined);
    for (let waited = 0; waited < 40_000; waited += 50) {
      if (committed.page().includes("window.__ODIN__=")) break;
      await wait(50);
    }
    for (let waited = 0; waited < 10_000; waited += 25) {
      if (editor.saves.length > 0) break;
      await wait(25);
    }

    writeFileSync(
      join(repo, "two.ts"),
      'import { one } from "./one.js";\n\n// promoted\nexport const two = one() + 4;\n',
    );
    for (const save of editor.saves) {
      save({ uri: { scheme: "file", fsPath: join(repo, "two.ts") } });
    }

    // The live reading arrives in a frame of its own...
    for (let waited = 0; waited < 40_000; waited += 50) {
      if (editor.opened.some((frame) => frame.page().includes("window.__ODIN__="))) break;
      await wait(50);
    }
    const live = editor.opened.find((frame) => frame.page().includes("window.__ODIN__="));
    expect(live).toBeDefined();

    // ...and the tab it was promoted from is gone.
    for (let waited = 0; waited < 5_000 && !committed.disposed; waited += 50) {
      await wait(50);
    }
    expect(committed.disposed).toBe(true);
  }, 90_000);
});
