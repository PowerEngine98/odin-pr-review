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
      showInformationMessage: () => Promise.resolve(),
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
      joinPath: () => ({}),
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

  return { serializer, commands, opened, watchers, saves, status, focus, extension };
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

  it("redraws the card when the file behind it changes", async () => {
    restore();
    const editor = stub(local(), { folder: repo, baseRef: "HEAD~1" });
    const panel = await reading(editor);
    expect(panel.page()).toContain("test x5");

    const page = await save(editor, panel, ON_DISK.replace("x5", "x6"));
    expect(page).toContain("test x6");
  }, 120_000);
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
