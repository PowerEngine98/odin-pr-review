import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "../src/app", path), "utf8");

describe("a diagram a tour frame draws", () => {
  const player = read("tour/player.svelte.ts");
  const shown = read("tour/Diagram.svelte");
  const diagram = read("panels/Diagram.svelte");

  it("says when its picture is drawn, with the picture itself", () => {
    expect(diagram).toMatch(/if \(svg && ondrawn\) requestAnimationFrame\(\(\) => ondrawn\(svg\)\);/);
  });

  it("is framed by the drawing inside it, not by the room it was given", () => {
    expect(shown).toMatch(/const inner = svg\.getBoundingClientRect\(\);/);
    expect(shown).toMatch(/diagramDrawn\(id, \{\s*x: at\.x \+ \(inner\.left - outer\.left\) \/ scale,/);
    expect(player).toMatch(/export function diagramDrawn\(id: number, drawing: Box\): void \{\s*if \(framing !== id \|\| tour\.diagram\?\.id !== id\) return;/);
    expect(player).toMatch(/camera\.showWhole\(\{\s*x: drawing\.x - pad,/);
  });

  it("only moves the camera for a frame that is playing, not one scrubbed past", () => {
    expect(player).toMatch(/const area = draw\(frame, true\);\s*if \(!area\) return null;\s*framing = tour\.diagram\?\.id;/);
  });
});
