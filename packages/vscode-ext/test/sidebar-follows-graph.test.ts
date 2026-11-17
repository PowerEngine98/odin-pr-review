import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");
const bridge = read("vscode-ext/src/bridge.ts");
const panel = read("vscode-ext/src/panel.ts");
const camera = read("webview/src/app/canvas/camera.svelte.ts");
const state = read("webview/src/app/state.svelte.ts");
const canvas = read("webview/src/app/canvas/Canvas.svelte");
const app = read("webview/src/app/App.svelte");
const viewer = read("browser-ext/src/viewer.ts");

describe("the browser's file list, synced with VS Code", () => {
  it("is sent again whenever VS Code redraws the reading, so files an agent discarded leave it", () => {
    expect(bridge).toMatch(
      /if \(\(kind === "model" \|\| kind === "rows"\) && current\.changeGraph !== sentGraph\) \{\s*sentGraph = current\.changeGraph;\s*sink\.send\(\{ type: "graph", graph: sentGraph \}\);/,
    );
    expect(bridge).toMatch(/sentGraph = next\.changeGraph;/);
  });
});

describe("pressing a row in the side bar", () => {
  it("flies to a file in another part by opening the whole drawing", () => {
    expect(camera).toMatch(/const card = openedFor\(path\);/);
    expect(camera).toMatch(
      /function openedFor\(path: string\)[\s\S]*?ui\.part = null;\s*notify\("part", \{ paths: null \}\);/,
    );
    expect(camera).toMatch(/\): \{ nodeId: string; edgeId: string \| null \} \| null \{[\s\S]*?openedFor\(path\);/);
  });

  it("is answered by one owner, so the canvas mounting again cannot drop the fallbacks", () => {
    expect(canvas).not.toMatch(/travel\.toFile/);
    expect(app).toMatch(/travel\.toFile = \(path\) => \{/);
    expect(app).toMatch(/camera\.showLine\(path, line, side, true\)/);
  });

  it("follows a reference in the browser too", () => {
    expect(viewer).toMatch(/message\.type === "follow" && typeof message\.edgeId === "string"\) \{\s*toGraph\(\{ type: "follow", edgeId: message\.edgeId \}\);/);
    expect(state).toMatch(/case "follow": \{[\s\S]*?travel\.toLine\?\.\(to\.path, edge\.to\.line, edge\.to\.side\);/);
  });

  it("brings the graph forward in VS Code when it is behind another tab", () => {
    expect(panel).toMatch(/if \(!panel\.panel\.visible\) panel\.panel\.reveal\(panel\.panel\.viewColumn, true\);\s*void panel\.panel\.webview\.postMessage\(\{ type: "focus", path \}\);/);
  });
});
