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
  activate(context: {
    subscriptions: unknown[];
    workspaceState: { get: () => unknown; update: () => Promise<void> };
  }): void;
  deactivate(): void;
}

/** Activation needs somewhere to keep the reviewer's marks. */
function context(subscriptions: unknown[] = []) {
  return {
    subscriptions,
    workspaceState: {
      get: (_key: string, fallback: unknown) => fallback,
      update: () => Promise.resolve(),
    },
  } as unknown as Parameters<ExtensionModule["activate"]>[0];
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
      registerWebviewViewProvider: () => disposable,
      registerWebviewPanelSerializer: () => disposable,
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
    // The viewed store hands back a Disposable of its own.
    Disposable: class { constructor(readonly fn?: () => void) {} dispose() {} },
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

  /*
   * The one activation event the editor will not work out for itself.
   *
   * VS Code derives activation from `contributes` these days, which covers the
   * commands and the side bar view — and covers nothing at all for a webview
   * being restored. Without this declared, a window reload brings the graph's
   * tab back, the reader presses it, and the editor has no reason to start the
   * extension: the serializer is never called, so nothing is ever written into
   * the frame and it stays blank. It looks exactly like a loader that failed to
   * appear, which is how it was reported three times.
   */
  it("asks to be woken when the editor restores the graph's tab", async () => {
    const manifest = (
      await import("../package.json", { with: { type: "json" } })
    ).default as { activationEvents?: string[] };

    expect(manifest.activationEvents ?? []).toContain("onWebviewPanel:odin.graph");
  });

  it("registers every command the manifest declares", async () => {
    const { api, extension } = loadWithStub();
    extension.activate(context());

    const manifest = (
      await import("../package.json", { with: { type: "json" } })
    ).default as { contributes: { commands: { command: string }[] } };

    const declared = manifest.contributes.commands.map((c) => c.command).sort();
    expect([...api.registeredCommands].sort()).toEqual(declared);
  });

  it("serves base-revision documents under its own scheme", () => {
    const { api, extension } = loadWithStub();
    extension.activate(context());
    expect(api.registeredSchemes).toEqual(["odin-base"]);
  });

  it("collects every registration for disposal", async () => {
    const { api, extension } = loadWithStub();
    const subscriptions: unknown[] = [];
    extension.activate(context(subscriptions));

    const manifest = (
      await import("../package.json", { with: { type: "json" } })
    ).default as { contributes: { commands: { command: string }[] } };

    // Every command, plus the content provider, the URI handler, the sidebar,
    // the viewed store's listener, and the serializer that reopens the graph
    // after a window reload. Anything registered but not collected here leaks
    // on reload — which is exactly the moment the serializer exists for.
    const nonCommands = 5;
    expect(subscriptions).toHaveLength(
      manifest.contributes.commands.length + nonCommands,
    );
    expect(api.registeredCommands).toHaveLength(
      manifest.contributes.commands.length,
    );
  });

  it("deactivates cleanly", () => {
    const { extension } = loadWithStub();
    extension.activate(context());
    expect(() => extension.deactivate()).not.toThrow();
  });
});
