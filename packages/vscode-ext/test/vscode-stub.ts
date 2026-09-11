/**
 * Enough of the editor API to import a module that talks to it.
 *
 * VS Code injects `vscode` at runtime, so a module importing it cannot be
 * loaded anywhere else without something under that name. The bundle test
 * substitutes a recording stub through the module loader because it is
 * checking activation; this exists for the opposite case — a pure function
 * that happens to live in a file which also holds editor code, where the API
 * is never reached and only needs to resolve.
 */
const disposable = { dispose() {} };

/**
 * Every command something has asked the editor to run, in order.
 *
 * Most of what the sidebar decides it says by running one: which buttons its
 * title bar may offer is a `setContext`, and whether the reader is being shown
 * the chooser or a change is one of those. There is nothing else to read it
 * off — the bar is drawn by the editor, not by us — so the asking is recorded.
 */
export const ran: { id: string; args: unknown[] }[] = [];

export const commands = {
  executeCommand: (id?: string, ...args: unknown[]) => {
    ran.push({ id: id ?? "", args });
    return Promise.resolve();
  },
  registerCommand: () => disposable,
};

/** Everything the editor has been asked to run, forgotten. */
export function forgetRan(): void {
  ran.length = 0;
}

/** What was last set under a context key, or nothing if it never was. */
export function contextOf(key: string): unknown {
  const said = ran.filter((one) => one.id === "setContext" && one.args[0] === key);
  return said.length === 0 ? undefined : said[said.length - 1]!.args[1];
}

export const window = {
  activeColorTheme: { kind: 2 },
  registerWebviewViewProvider: () => disposable,
  createWebviewPanel: (viewType: string, title: string) => {
    const panel = makePanel(viewType, title);
    frames.push(panel);
    return panel;
  },
  showErrorMessage: () => Promise.resolve(undefined),
  /**
   * A question put to the reader, recorded and answerable.
   *
   * Some decisions genuinely belong to them — whether to send a message whose
   * code has been rewritten out from under it, for one — and a test of that has
   * to be able to be both readers: the one who says go on and the one who does
   * not. Returns nothing by default, which is a dialogue dismissed.
   */
  showWarningMessage: (message: string, ...rest: unknown[]) => {
    asked.push({ message, choices: rest.filter((one) => typeof one === "string") });
    return Promise.resolve(answers.shift());
  },
  showInformationMessage: () => Promise.resolve(undefined),
  showTextDocument: () => Promise.resolve(undefined),
  setStatusBarMessage: () => disposable,
  onDidChangeActiveColorTheme: () => disposable,
  tabGroups: { all: [], onDidChangeTabs: () => disposable },
};

export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3 };

/** Every question the editor has been asked to put to the reader. */
export const asked: { message: string; choices: unknown[] }[] = [];

/** What the reader will answer, in order. Empty means every dialogue is closed. */
const answers: (string | undefined)[] = [];

export function readerSays(...said: (string | undefined)[]): void {
  answers.length = 0;
  answers.push(...said);
}

export function forgetAsked(): void {
  asked.length = 0;
  answers.length = 0;
}

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  constructor(readonly start: Position, readonly end: Position) {}
}

/**
 * The last watcher something asked for, so a test can make it fire.
 *
 * `LiveGraph` is worth driving directly — the timing rules in it are the whole
 * of what it does, and reaching them through the bundle means a real repository
 * and a real rebuild for a question about a timer.
 */
export const watched: {
  change?: (uri: { fsPath: string }) => void;
  save?: (document: { uri: { scheme: string; fsPath: string } }) => void;
} = {};

export const workspace = {
  /** The reader saving a document, which needs no watcher to be noticed. */
  onDidSaveTextDocument: (fn: (d: { uri: { scheme: string; fsPath: string } }) => void) => {
    watched.save = fn;
    return disposable;
  },
  createFileSystemWatcher: () => ({
    onDidCreate: () => disposable,
    onDidChange: (fn: (uri: { fsPath: string }) => void) => {
      watched.change = fn;
      return disposable;
    },
    onDidDelete: () => disposable,
    dispose() {
      watched.change = undefined;
    },
  }),
};

export class RelativePattern {
  constructor(readonly base: unknown, readonly pattern: string) {}
}

export class Disposable {
  constructor(readonly fn?: () => void) {}
  dispose(): void {}
}

/**
 * Every webview frame something has asked the editor for.
 *
 * How many tabs a change opens is the whole of one class of fault, and it is
 * not a question the source can answer: it is a count of what the editor was
 * asked to make while one review was being drawn. So the stub records the
 * asking, and a test can drive a build and count.
 */
export const frames: StubPanel[] = [];

export interface StubPanel {
  title: string;
  viewType: string;
  disposed: boolean;
  /**
   * How many times the whole document has been replaced.
   *
   * Which is a question the source cannot answer and the reader feels sharply:
   * assigning `html` throws the page away and builds it again, so the loader
   * returns, every card is made afresh, and wherever they were reading is gone.
   * A count is the only way to tell a panel that told the page something from
   * one that rebuilt it to say the same thing.
   */
  writes: number;
  webview: {
    html: string;
    cspSource: string;
    options: unknown;
    asWebviewUri: (uri: unknown) => unknown;
    onDidReceiveMessage: (fn: (message: unknown) => void) => { dispose(): void };
    postMessage: (message: unknown) => Promise<boolean>;
  };
  /** What the panel has told the page, so a test can read the news. */
  sent: { type?: string }[];
  /** Sends the panel a message, as the page would. */
  say: (message: unknown) => void;
  reveal: (column?: number) => void;
  dispose: () => void;
  onDidDispose: (fn: () => void) => { dispose(): void };
  onDidChangeViewState: (fn: (event: unknown) => void) => { dispose(): void };
  visible: boolean;
  active: boolean;
}

export function makePanel(viewType: string, title: string): StubPanel {
  const closing: (() => void)[] = [];
  const heard: ((message: unknown) => void)[] = [];
  let written = "";
  const panel: StubPanel = {
    title,
    viewType,
    disposed: false,
    writes: 0,
    webview: {
      // A property with a counter behind it, because what matters is the
      // assignment happening rather than what was assigned.
      get html(): string {
        return written;
      },
      set html(page: string) {
        written = page;
        panel.writes += 1;
      },
      cspSource: "vscode-test:",
      options: {},
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: (fn: (message: unknown) => void) => {
        heard.push(fn);
        return disposable;
      },
      postMessage: (message: unknown) => {
        panel.sent.push(message as { type?: string });
        return Promise.resolve(true);
      },
    },
    sent: [],
    say: (message: unknown) => {
      for (const fn of heard) fn(message);
    },
    reveal: () => {},
    dispose: () => {
      // Once, however often it is asked for, which is what the editor does.
      // Everything holding a panel closes it on the way out — the panel itself
      // does, from inside the very handler this fires — so a stub that told
      // them again each time would not be a harsher editor, it would be an
      // endless one.
      if (panel.disposed) return;
      panel.disposed = true;
      for (const fn of closing) fn();
    },
    onDidDispose: (fn: () => void) => {
      closing.push(fn);
      return disposable;
    },
    onDidChangeViewState: () => disposable,
    visible: true,
    active: true,
  };
  return panel;
}

/** Everything the stub has been asked for, forgotten. */
export function forgetFrames(): void {
  frames.length = 0;
}

/**
 * The bar beside the drawing, as much of it as the provider actually touches.
 *
 * A view is not a panel — it has no tab, nothing to reveal and no state to
 * change — but what a test wants of it is the same thing: the document it was
 * last given. What the reader is being offered in the sidebar is only readable
 * there, because the rows are markup rather than anything this side keeps.
 */
export interface StubView {
  webview: {
    html: string;
    cspSource: string;
    options: unknown;
    onDidReceiveMessage: (fn: (message: unknown) => void) => { dispose(): void };
    postMessage: (message: unknown) => Promise<boolean>;
  };
  /** Sends the view a message, as the page in it would. */
  say: (message: unknown) => void;
  /** What the view has been told, so a test can read the news. */
  sent: { type?: string }[];
}

export function makeView(): StubView {
  const heard: ((message: unknown) => void)[] = [];
  const view: StubView = {
    webview: {
      html: "",
      cspSource: "vscode-test:",
      options: {},
      onDidReceiveMessage: (fn: (message: unknown) => void) => {
        heard.push(fn);
        return disposable;
      },
      postMessage: (message: unknown) => {
        view.sent.push(message as { type?: string });
        return Promise.resolve(true);
      },
    },
    say: (message: unknown) => {
      for (const fn of heard) fn(message);
    },
    sent: [],
  };
  return view;
}

export const ViewColumn = { One: 1, Two: 2, Beside: -2 };

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: "file", path, toString: () => path }),
  joinPath: (base: { fsPath: string }, ...rest: string[]) =>
    Uri.file([base.fsPath, ...rest].join("/")),
};
