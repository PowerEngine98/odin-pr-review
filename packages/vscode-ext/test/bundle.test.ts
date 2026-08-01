import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUNDLE = join(HERE, "..", "dist", "extension.js");

/**
 * Loads the built extension with a stand-in for the editor API.
 *
 * VS Code injects `vscode` at runtime, so nothing outside the editor can import
 * the bundle without it. Substituting a recording stub gives the one thing that
 * cannot be checked any other way short of launching an editor: that the bundle
 * evaluates, that activation registers what the manifest promises, and that it
 * does so without touching the workspace.
 */
function loadWithStub(): { api: Stub; extension: ExtensionModule } {
  const api = createStub();
  const require = createRequire(import.meta.url);

  const Module = require("node:module") as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const original = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "vscode") return api;
    return original.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(BUNDLE)];
    return { api, extension: require(BUNDLE) as ExtensionModule };
  } finally {
    Module._load = original;
  }
}

interface ExtensionModule {
  activate(context: { subscriptions: unknown[] }): void;
  deactivate(): void;
}

interface Stub {
  commands: { registerCommand(id: string, handler: unknown): unknown };
  registeredCommands: string[];
  registeredSchemes: string[];
}

function createStub(): Stub {
  const registeredCommands: string[] = [];
  const registeredSchemes: string[] = [];
  const disposable = { dispose() {} };

  return {
    registeredCommands,
    registeredSchemes,
    commands: {
      registerCommand(id: string) {
        registeredCommands.push(id);
        return disposable;
      },
      executeCommand: () => Promise.resolve(),
    },
    workspace: {
      registerTextDocumentContentProvider(scheme: string) {
        registeredSchemes.push(scheme);
        return disposable;
      },
      getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
      workspaceFolders: undefined,
      openTextDocument: () => Promise.resolve({}),
    },
    window: {
      registerUriHandler: () => disposable,
      registerTreeDataProvider: () => disposable,
      showErrorMessage: () => Promise.resolve(),
      showInformationMessage: () => Promise.resolve(),
      showQuickPick: () => Promise.resolve(undefined),
      showTextDocument: () => Promise.resolve({}),
      createWebviewPanel: () => ({
        webview: { html: "", cspSource: "", onDidReceiveMessage: () => disposable },
        onDidDispose: () => disposable,
        reveal() {},
        dispose() {},
      }),
      withProgress: (_options: unknown, task: (p: unknown) => unknown) =>
        Promise.resolve(task({ report() {} })),
      activeTextEditor: undefined,
      activeColorTheme: { kind: 2 },
      onDidChangeActiveColorTheme: () => disposable,
    },
    Uri: {
      file: (path: string) => ({ scheme: "file", path, toString: () => path }),
      from: (parts: Record<string, string>) => ({
        ...parts,
        toString: () => `${parts.scheme}:${parts.path}?${parts.query}`,
      }),
    },
    // The tree provider constructs an emitter as a field, so this has to exist
    // before activation, not merely when something subscribes.
    EventEmitter: class {
      readonly event = () => disposable;
      fire() {}
      dispose() {}
    },
    TreeItem: class { constructor(readonly label: string, readonly state?: unknown) {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(readonly id: string, readonly color?: unknown) {} },
    ThemeColor: class { constructor(readonly id: string) {} },
    MarkdownString: class { constructor(readonly value?: string) {} },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Position: class { constructor(readonly line: number, readonly character: number) {} },
    Selection: class { constructor(readonly a: unknown, readonly b: unknown) {} },
    ViewColumn: { One: 1, Beside: -2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    ProgressLocation: { Notification: 15 },
  } as unknown as Stub;
}

describe("the built extension", () => {
  it("has been bundled", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("evaluates without the editor present", () => {
    expect(() => loadWithStub()).not.toThrow();
  });

  it("registers every command the manifest declares", async () => {
    const { api, extension } = loadWithStub();
    extension.activate({ subscriptions: [] });

    const manifest = (
      await import("../package.json", { with: { type: "json" } })
    ).default as { contributes: { commands: { command: string }[] } };

    const declared = manifest.contributes.commands.map((c) => c.command).sort();
    expect([...api.registeredCommands].sort()).toEqual(declared);
  });

  it("serves base-revision documents under its own scheme", () => {
    const { api, extension } = loadWithStub();
    extension.activate({ subscriptions: [] });
    expect(api.registeredSchemes).toEqual(["odin-base"]);
  });

  it("collects every registration for disposal", async () => {
    const { api, extension } = loadWithStub();
    const subscriptions: unknown[] = [];
    extension.activate({ subscriptions });

    const manifest = (
      await import("../package.json", { with: { type: "json" } })
    ).default as { contributes: { commands: { command: string }[] } };

    // Every command, plus the content provider, the URI handler and the tree
    // view. Anything registered but not collected here leaks on reload.
    const nonCommands = 3;
    expect(subscriptions).toHaveLength(
      manifest.contributes.commands.length + nonCommands,
    );
    expect(api.registeredCommands).toHaveLength(
      manifest.contributes.commands.length,
    );
  });

  it("deactivates cleanly", () => {
    const { extension } = loadWithStub();
    extension.activate({ subscriptions: [] });
    expect(() => extension.deactivate()).not.toThrow();
  });
});
