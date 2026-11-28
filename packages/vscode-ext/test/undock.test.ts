import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { undockedHtml } from "../src/panel.js";

const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

describe("an agent's console undocked into a window of its own", () => {
  it("is the reading's own document, marked with the agent it shows", () => {
    expect(undockedHtml("<html><head></head><body><main></main></body></html>", "claude")).toBe(
      '<html><head></head><body data-undocked="claude"><main></main></body></html>',
    );
  });

  it("is a second view of the same reading: it hears what the reading says and its replies go to the reading", () => {
    const panel = read("vscode-ext/src/panel.ts");
    expect(panel).toMatch(/const detach = this\.attach\(\{\s*html: \(html\) => \{\s*window\.webview\.html = undockedHtml\(html, agent\);/);
    expect(panel).toMatch(/window\.webview\.onDidReceiveMessage\(\(message: unknown\) => this\.receive\(message\)\)/);
    expect(panel).toMatch(/executeCommand\("workbench\.action\.moveEditorToNewWindow"\)/);
    expect(panel).toMatch(/for \(const window of \[\.\.\.this\.undocked\.values\(\)\]\) window\.dispose\(\);/);
  });

  it("fills its window with that console alone, and docks back from its own button or by closing the window", () => {
    const dock = read("webview/src/app/hud/Terminals.svelte");
    expect(dock).toMatch(/if \(undock\.as\) return found\.filter\(\(agent\) => agent\.id === undock\.as\);/);
    expect(dock).toMatch(/\.terminal-dock\.undocked \{\s*inset: 0;/);
    const terminal = read("webview/src/app/hud/Terminal.svelte");
    expect(terminal).toMatch(/notify\("undock", \{ agent: id, name \}\)/);
    expect(terminal).toMatch(/if \(undock\.as === id\) \{\s*notify\("dock", \{ agent: id \}\);/);
  });

  it("leaves a chip in the drawing that brings its window forward, in place of the console", () => {
    const dock = read("webview/src/app/hud/Terminals.svelte");
    expect(dock).toMatch(/\.filter\(\(id\) => !undock\.away\.includes\(id\)\)/);
    expect(dock).toMatch(/notify\("focusUndocked", \{ agent: agent\.id \}\)/);
  });
});
