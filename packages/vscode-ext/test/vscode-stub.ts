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

export const commands = {
  executeCommand: () => Promise.resolve(),
  registerCommand: () => disposable,
};

export const window = {
  activeColorTheme: { kind: 2 },
  registerWebviewViewProvider: () => disposable,
  createWebviewPanel: (viewType: string, title: string) => {
    const panel = makePanel(viewType, title);
    frames.push(panel);
    return panel;
  },
  showErrorMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  setStatusBarMessage: () => disposable,
  onDidChangeActiveColorTheme: () => disposable,
  tabGroups: { all: [], onDidChangeTabs: () => disposable },
};

export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3 };

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
  webview: {
    html: string;
    cspSource: string;
    options: unknown;
    asWebviewUri: (uri: unknown) => unknown;
    onDidReceiveMessage: (fn: (message: unknown) => void) => { dispose(): void };
    postMessage: (message: unknown) => Promise<boolean>;
  };
  reveal: (column?: number) => void;
  dispose: () => void;
  onDidDispose: (fn: () => void) => { dispose(): void };
  onDidChangeViewState: (fn: (event: unknown) => void) => { dispose(): void };
  visible: boolean;
  active: boolean;
}

export function makePanel(viewType: string, title: string): StubPanel {
  const closing: (() => void)[] = [];
  const panel: StubPanel = {
    title,
    viewType,
    disposed: false,
    webview: {
      html: "",
      cspSource: "vscode-test:",
      options: {},
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: () => disposable,
      postMessage: () => Promise.resolve(true),
    },
    reveal: () => {},
    dispose: () => {
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

export const ViewColumn = { One: 1, Two: 2, Beside: -2 };

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: "file", path, toString: () => path }),
  joinPath: (base: { fsPath: string }, ...rest: string[]) =>
    Uri.file([base.fsPath, ...rest].join("/")),
};
