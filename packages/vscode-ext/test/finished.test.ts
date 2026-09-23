import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * The same instrument as `promotion.test.ts`, and for the same reason: what a
 * tab is called is a thing the editor holds rather than something the source
 * can be asked, so the naming is recorded as it happens and read back at the
 * end.
 *
 * With one addition — when each frame was last written to or brought forward.
 * A reading of a change already open is applied to the tab that already holds
 * it rather than to a new one, so "the tab the reader is now looking at" is not
 * "the last tab that was made"; asking the newest frame what it is called
 * answers about whichever change happened to be opened last, which is a second
 * way of reading the wrong pull request off the screen.
 */
let touched = 0;

function recorder() {
  const written: string[] = [];
  const posted: { type?: string; [key: string]: unknown }[] = [];
  const closed: (() => void)[] = [];
  const seen = { written, posted, disposed: false, revealed: 0, at: ++touched };
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
      seen.at = ++touched;
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
      seen.at = ++touched;
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
 * A repository whose interesting changes have all finished, and a forge that
 * answers about each of them by name or by number.
 *
 * Built rather than mocked, because the thing being measured is what a real
 * build decides a reading *is*. Three changes have ended: two landed and one
 * was abandoned, and every one of them has had its branch taken away the way a
 * forge takes it away the moment a change stops being worked on. What is left
 * of each is the head commit under `refs/pull/<n>/head`, which is the only
 * thing a reading of a finished change has to go on.
 *
 * The working tree is deliberately left on the branch of one of them, because
 * that is the arrangement in the report: the reader had `chore/be-java-21-runtime`
 * out, pressed a different row, and got that row's diff wearing this branch's
 * number. `gh` is a shell script that answers `pr list` and `pr view`, and it
 * writes down every question it was asked — the wrong number does not announce
 * itself anywhere else, and which selector the forge was asked about is the
 * whole of the evidence.
 */
function forge(): { repo: string; bin: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), "odin-finished-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const log = join(root, "asked.txt");
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
  writeFileSync(join(work, "base.ts"), "export const base = 1;\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "base");

  // The change the reader presses: landed, its branch long gone.
  git(work, "checkout", "--quiet", "-b", "feat/stomp-transport");
  writeFileSync(
    join(work, "stomp.ts"),
    'import { base } from "./base.js";\n\nexport const stomp = base + 1;\n',
  );
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "stomp");

  // The change the working tree happens to be on: also landed, and the one
  // every press used to open.
  git(work, "checkout", "--quiet", "-b", "chore/be-java-21-runtime", "development");
  writeFileSync(
    join(work, "runtime.ts"),
    'import { base } from "./base.js";\n\nexport const runtime = base + 2;\n',
  );
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "runtime");

  // And one that ended without landing, which takes the same route.
  git(work, "checkout", "--quiet", "-b", "fix/abandoned-retry", "development");
  writeFileSync(
    join(work, "retry.ts"),
    'import { base } from "./base.js";\n\nexport const retry = base + 3;\n',
  );
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "retry");

  execFileSync("git", ["init", "--bare", "--quiet", origin], { stdio: "ignore", env });
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "--quiet", "origin", "development", "chore/be-java-21-runtime");
  // What a forge keeps of a change once its branch is gone.
  git(work, "push", "--quiet", "origin", "feat/stomp-transport:refs/pull/125/head");
  git(work, "push", "--quiet", "origin", "chore/be-java-21-runtime:refs/pull/282/head");
  git(work, "push", "--quiet", "origin", "fix/abandoned-retry:refs/pull/301/head");

  const shaOf = (ref: string) =>
    execFileSync("git", ["rev-parse", ref], { cwd: work, encoding: "utf8" }).trim();
  const heads = {
    125: shaOf("feat/stomp-transport"),
    282: shaOf("chore/be-java-21-runtime"),
    301: shaOf("fix/abandoned-retry"),
  };

  git(work, "checkout", "--quiet", "chore/be-java-21-runtime");
  git(work, "branch", "-D", "feat/stomp-transport");
  git(work, "branch", "-D", "fix/abandoned-retry");
  git(work, "fetch", "--quiet", "origin");

  const titles: Record<number, string> = {
    125: "feat(fe): shared STOMP transport with reconnect",
    282: "chore(be): run the backend image on a Java 21 JRE",
    301: "fix(be): retry the projector once, then give up",
    404: "chore(be): rotate the dead-letter queue nightly",
  };
  const branches: Record<number, string> = {
    125: "feat/stomp-transport",
    282: "chore/be-java-21-runtime",
    301: "fix/abandoned-retry",
    404: "chore/be-dlq-rotation",
  };
  /*
   * A row, and the one thing a row is not guaranteed to carry.
   *
   * #404 is the change the forge has nothing left of: no head commit in the
   * list, and no `refs/pull/404/head` to fetch either, which is what an old
   * forge or a mirror looks like. It exists here so that a fetch which fails
   * has something to fail on, because the fallback that failure used to reach
   * for was whatever had been fetched last — another change's commits entirely.
   */
  const row = (number: 125 | 282 | 301 | 404, state: string) => ({
    number,
    title: titles[number],
    url: `https://example.invalid/pr/${number}`,
    headRefName: branches[number],
    ...(number === 404 ? {} : { headRefOid: heads[number as 125 | 282 | 301] }),
    isDraft: false,
    author: { login: "marco" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: `2026-01-0${number === 125 ? 4 : number === 282 ? 3 : 2}T00:00:00Z`,
    state,
    ...(state === "MERGED"
      ? { mergedAt: "2026-01-05T00:00:00Z" }
      : { closedAt: "2026-01-05T00:00:00Z" }),
    baseRefName: "development",
    reviewRequests: [],
  });
  const view = (number: 125 | 282 | 301 | 404, state: string) => ({
    number,
    title: titles[number],
    url: `https://example.invalid/pr/${number}`,
    isDraft: false,
    state,
    baseRefName: "development",
    reviewRequests: [],
    latestReviews: [],
  });

  const list = JSON.stringify([
    row(125, "MERGED"),
    row(282, "MERGED"),
    row(301, "CLOSED"),
    row(404, "MERGED"),
  ]);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      `echo "$@" >> ${log}`,
      'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
      "  cat <<'ODIN'",
      list,
      "ODIN",
      "  exit 0",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
      '  case "$3" in',
      `    125|feat/stomp-transport) echo '${JSON.stringify(view(125, "MERGED"))}'; exit 0;;`,
      `    282|chore/be-java-21-runtime) echo '${JSON.stringify(view(282, "MERGED"))}'; exit 0;;`,
      `    301|fix/abandoned-retry) echo '${JSON.stringify(view(301, "CLOSED"))}'; exit 0;;`,
      `    404|chore/be-dlq-rotation) echo '${JSON.stringify(view(404, "MERGED"))}'; exit 0;;`,
      "  esac",
      "  exit 1",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);

  return {
    repo: execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: work,
      encoding: "utf8",
    }).trim(),
    bin,
    log,
  };
}

/** A window with the list already fetched, filtered the way the report had it. */
async function opened(repo: string) {
  const editor = stub(undefined, { folder: repo, baseRef: "" });
  editor.information = (_message: string, ...rest: unknown[]) =>
    Promise.resolve(rest.find((one) => typeof one === "string"));
  await editor.commands.get("odin.askForPulls")!({ state: "merged", author: "" });
  await wait(1500);
  return editor;
}

/**
 * Waits until this many frames have been asked for and the newest holds a graph.
 *
 * The newest rather than any of them: a loader is written into whichever frame
 * is free, so what says the build being waited on has landed is the frame it
 * landed in.
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
  await wait(1500);
}

/** The tab the reader is now looking at: last drawn into, or last brought forward. */
function front(editor: Awaited<ReturnType<typeof opened>>) {
  const left = editor.opened.filter((frame) => !frame.disposed);
  return left.reduce<(typeof left)[number] | undefined>(
    (best, frame) => (!best || frame.at > best.at ? frame : best),
    undefined,
  );
}

/** What that tab ended up calling itself. */
function named(editor: Awaited<ReturnType<typeof opened>>): string {
  return front(editor)?.panel.title ?? "";
}

/**
 * Pressing a change that has already finished.
 *
 * A landed change is read rather than checked out — there is no branch left to
 * work on and nothing to work on it with — so the press goes down a route of
 * its own, and that route was handing the build a bare commit and nothing else.
 * Nothing downstream can name a change from a commit, so the one thing that
 * still could was asked instead: the branch the working tree happens to be on.
 * The reader pressed one row and got that row's diff underneath another row's
 * number, title and comments, over and over, because the answer never depended
 * on which row was pressed.
 *
 * Driven through the command the list itself runs, against a real repository
 * and a real build with a real `gh` on the path, because what a tab is called
 * is not a question the source can answer.
 */
describe("reading a change that has already finished", () => {
  let repo: string;
  let log: string;
  let path: string | undefined;

  beforeAll(() => {
    const made = forge();
    repo = made.repo;
    log = made.log;
    path = process.env.PATH;
    process.env.PATH = `${made.bin}:${path ?? ""}`;
  });
  afterAll(() => {
    if (path !== undefined) process.env.PATH = path;
  });

  it("opens the change that was pressed, not the one the tree is on", async () => {
    const editor = await opened(repo);

    await editor.commands.get("odin.checkout")!(125);
    await drawn(editor, 1);

    expect(named(editor)).toContain("#125");
    expect(named(editor)).not.toContain("#282");
  }, 90_000);

  it("draws the pressed change's own files under its own number", async () => {
    /*
     * Both halves of the report, in one assertion apiece.
     *
     * The diff was always right — it is built from the commit the forge named —
     * and only the identity was wrong, which is exactly why this reads as the
     * wrong pull request having opened rather than as anything being broken.
     * A fix that got the number right by reading the wrong commits would pass
     * the test above and be a worse bug than the one it replaced.
     */
    const editor = await opened(repo);

    await editor.commands.get("odin.checkout")!(125);
    await drawn(editor, 1);

    const page = front(editor)!.page();
    expect(named(editor)).toContain("#125");
    expect(page).toContain("stomp.ts");
    expect(page).not.toContain("runtime.ts");
  }, 90_000);

  it("never asks the forge about the branch the reader happens to be on", async () => {
    /*
     * The cause, named rather than inferred from the symptom.
     *
     * A reading of a finished change knows its number — the row carries it —
     * and the only reason the wrong one came back is that the number was
     * dropped and the checkout asked in its place. If `gh pr view` is ever
     * asked about `chore/be-java-21-runtime` while #125 is being opened, the
     * number has been dropped again, whatever the tab happens to be called.
     */
    const editor = await opened(repo);
    writeFileSync(log, "");

    await editor.commands.get("odin.checkout")!(125);
    await drawn(editor, 1);

    const asked = readFileSync(log, "utf8");
    expect(asked).not.toContain("pr view chore/be-java-21-runtime");
  }, 90_000);

  it("keeps opening the pressed one however many times it is pressed", async () => {
    /*
     * "No matter how many attempts I do."
     *
     * Worth its own case because the two explanations that were in the running
     * differ here: a stale ref left over from an earlier fetch would come right
     * once the right thing had been fetched, and reading the identity off the
     * checkout never comes right at all. Pressing the same row again after
     * pressing another one is the shortest way to tell those apart.
     */
    const editor = await opened(repo);

    await editor.commands.get("odin.checkout")!(125);
    await drawn(editor, 1);
    expect(named(editor)).toContain("#125");

    await editor.commands.get("odin.checkout")!(282);
    await drawn(editor, 2);
    expect(named(editor)).toContain("#282");

    await editor.commands.get("odin.checkout")!(125);
    await wait(6000);
    expect(named(editor)).toContain("#125");
  }, 120_000);

  it("says a change it cannot reach cannot be reached, under its own number", async () => {
    /*
     * The change there is nothing left of, opened straight after one there was.
     *
     * #404 carries no head commit in the forge's list and has no
     * `refs/pull/404/head` to fetch either, which is what an old forge or a
     * mirror looks like. What the reading then falls back on is `FETCH_HEAD`,
     * and `FETCH_HEAD` is not a ref belonging to anything — it is a note of
     * whatever was fetched last, by anything, for any reason, which after the
     * press just before is another change's head entirely. Reading #125 first
     * is what puts it there.
     *
     * Measured rather than assumed, and the measurement was kinder than
     * expected: git truncates the file when a fetch fails, so the note came
     * back empty rather than wrong. This holds the line at the two places that
     * do not depend on that — a reading that cannot be reached says so, and it
     * says so under the number that was pressed rather than under the branch
     * the reader is standing on.
     */
    const editor = await opened(repo);

    await editor.commands.get("odin.checkout")!(125);
    await drawn(editor, 1);
    expect(named(editor)).toContain("#125");

    await editor.commands.get("odin.checkout")!(404);
    await wait(6000);

    const page = front(editor)!.page();
    expect(page).not.toContain("stomp.ts");
    expect(page).toContain("Could not find the commits for #404");
  }, 90_000);

  it("does the same for a change that ended without landing", async () => {
    /*
     * Closed and merged leave by the same door — anything whose state is not
     * open is read where it lies — so a fix that only mentioned merging would
     * leave half the report standing.
     */
    const editor = await opened(repo);

    await editor.commands.get("odin.checkout")!(301);
    await drawn(editor, 1);

    expect(named(editor)).toContain("#301");
    expect(named(editor)).not.toContain("#282");
  }, 90_000);
});
