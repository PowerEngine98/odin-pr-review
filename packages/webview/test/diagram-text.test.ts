import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const diagram = readFileSync(join(__dirname, "../src/app/panels/Diagram.svelte"), "utf8");
const pinned = readFileSync(join(__dirname, "../src/app/canvas/Pinned.svelte"), "utf8");

describe("the words in a drawn diagram", () => {
  it("are selected, not opened, when pressed", () => {
    expect(diagram).toMatch(/const LABELS = "text, tspan, foreignObject, \.nodeLabel, \.edgeLabel, \.label, \.cluster-label";/);
    expect(diagram).toMatch(/function press\(event: PointerEvent\): void \{\s*if \(onText\(event\.target\)\) \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?return;\s*\}\s*if \(!openable/);
  });

  it("can be selected and copied, and a drag from them selects instead of lifting the diagram", () => {
    expect(diagram).toMatch(/user-select: text;/);
    expect(diagram).toMatch(/draggable=\{liftable && !reading\}/);
  });

  it("are not pans of the canvas when the diagram is pinned to it", () => {
    expect(pinned).toMatch(/<div class="pin-body" onpointerdown=\{\(event\) => event\.stopPropagation\(\)\}>/);
  });
});

describe("a diagram that could not be drawn here", () => {
  it("opens in the viewer when pressed", () => {
    expect(diagram).toMatch(/class="diagram-source openable"[\s\S]*?onclick=\{\(\) => showDrawing\(code\)\}/);
  });
});
