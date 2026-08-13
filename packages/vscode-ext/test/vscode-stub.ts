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
