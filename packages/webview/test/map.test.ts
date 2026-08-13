import { describe, expect, it } from "vitest";

import type { NodeView } from "../src/app/model.js";
import {
  MAP_SIZE,
  bounds,
  fitMap,
  placeNode,
  placeWindow,
  pointAt,
  region,
  uncovered,
} from "../src/app/hud/map.js";

function node(over: Partial<NodeView> = {}): NodeView {
  return {
    id: "n:a",
    path: "src/a.ts",
    x: 0,
    y: 0,
    width: 100,
    height: 200,
    column: 0,
    isTest: false,
    language: "typescript",
    untouched: false,
    status: "modified",
    ...over,
  };
}

const WHOLE = { x: 0, y: 0, width: 1000, height: 4000 };

describe("what the map is a map of", () => {
  it("frames the cards, not the canvas", () => {
    // A canvas is as big as the layout engine made it. The change might sit in
    // a corner of it, and a map of the empty part is a map of nothing.
    const box = bounds(
      [node({ x: 500, y: 900 }), node({ id: "n:b", x: 700, y: 1200 })],
      WHOLE,
    );
    expect(box).toEqual({ x: 500, y: 900, width: 300, height: 500 });
  });

  it("falls back to the canvas when every card is filtered away", () => {
    expect(bounds([], WHOLE)).toEqual(WHOLE);
  });

  it("shows the whole change while the reader can see most of it", () => {
    // Zoomed out, "what shape is this" is the question, and the answer is all
    // of it. Windowing here would crop a picture that already fits.
    const all = { x: 0, y: 0, width: 900, height: 900 };
    const wide = { left: 0, top: 0, width: 800, height: 800 };
    expect(region(all, wide)).toEqual(all);
  });

  it("windows around the reader once they cannot", () => {
    // Zoomed into one file, a map of everything draws the view as a speck:
    // true, and no use for the question being asked of it.
    const all = { x: 0, y: 0, width: 4000, height: 4000 };
    const tight = { left: 2000, top: 2000, width: 100, height: 100 };
    const shown = region(all, tight);
    expect(shown.width).toBe(300);
    expect(shown.height).toBe(300);
    // Centred on the view.
    expect(shown.x).toBeCloseTo(1900);
    expect(shown.y).toBeCloseTo(1900);
  });

  it("pushes the window back inside the drawing at an edge", () => {
    // Otherwise the map is mostly empty exactly when the reader has scrolled
    // to a corner, which is where a map is most use.
    const all = { x: 0, y: 0, width: 4000, height: 4000 };
    const corner = { left: 0, top: 0, width: 100, height: 100 };
    const shown = region(all, corner);
    expect(shown.x).toBe(0);
    expect(shown.y).toBe(0);
  });
});

describe("folding it into the square", () => {
  it("centres a tall change rather than pinning it to an edge", () => {
    const fit = fitMap({ x: 0, y: 0, width: 100, height: 400 });
    expect(fit.padY).toBe(0);
    expect(fit.padX).toBeGreaterThan(0);
  });

  it("never rounds a card away to nothing", () => {
    // A file that rounds away is a file the reader cannot see is there.
    const fit = fitMap({ x: 0, y: 0, width: 100000, height: 100000 });
    const at = placeNode(node({ width: 1, height: 1 }), fit);
    expect(at.width).toBeGreaterThanOrEqual(2);
    expect(at.height).toBeGreaterThanOrEqual(2);
  });

  it("unfolds a press back to where it points", () => {
    const fit = fitMap({ x: 200, y: 400, width: 300, height: 300 });
    const at = pointAt(fit.padX, fit.padY, fit);
    expect(at.x).toBeCloseTo(200);
    expect(at.y).toBeCloseTo(400);
  });
});

/**
 * A scattering of cards of very different sizes, which is what a change is.
 *
 * The distances between them are what the map is read for, so they are the
 * thing to hold the drawing and the map against each other by.
 */
function scatter(): NodeView[] {
  return [
    node({ id: "n:a", x: 0, y: 0, width: 320, height: 900 }),
    node({ id: "n:b", x: 1400, y: 120, width: 640, height: 240 }),
    node({ id: "n:c", x: 400, y: 2600, width: 180, height: 5200 }),
    node({ id: "n:d", x: 2100, y: 4100, width: 900, height: 300 }),
    node({ id: "n:e", x: 60, y: 7300, width: 240, height: 160 }),
  ];
}

const middleOf = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** Every pair of cards, as the drawing has them and as the map draws them. */
function pairs(nodes: NodeView[], fit: ReturnType<typeof fitMap>) {
  const drawn = nodes.map((n) => middleOf(n));
  const mapped = nodes.map((n) => middleOf(placeNode(n, fit)));
  const out: { dx: number; dy: number; mx: number; my: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      out.push({
        dx: Math.abs(drawn[j].x - drawn[i].x),
        dy: Math.abs(drawn[j].y - drawn[i].y),
        mx: Math.abs(mapped[j].x - mapped[i].x),
        my: Math.abs(mapped[j].y - mapped[i].y),
      });
    }
  }
  return out;
}

describe("keeping the drawing's proportions", () => {
  /*
   * The test that was missing, and the only one that catches this class of bug.
   *
   * Everything else here asks whether a number is plausible. A map is read by
   * comparing one distance in it against another, so what has to hold is that
   * every distance in the drawing is the same distance in the map times one
   * number — the same number for x as for y, and the same number for a pair at
   * the top as for a pair at the bottom. Rounding each card to a whole map pixel
   * satisfied every other test here and broke this one by a fifth.
   */
  it("shrinks every distance by the same number", () => {
    const nodes = scatter();
    const fit = fitMap(bounds(nodes, WHOLE));
    const ratios = pairs(nodes, fit)
      .filter((p) => Math.hypot(p.dx, p.dy) > 0)
      .map((p) => Math.hypot(p.mx, p.my) / Math.hypot(p.dx, p.dy));

    for (const ratio of ratios) expect(ratio).toBeCloseTo(fit.scale, 10);
  });

  it("shrinks across as much as it shrinks down", () => {
    // A map with one scale for x and another is a map that says two files are
    // side by side when they are one above the other.
    const nodes = scatter();
    const fit = fitMap(bounds(nodes, WHOLE));

    for (const pair of pairs(nodes, fit)) {
      if (pair.dx > 1) expect(pair.mx / pair.dx).toBeCloseTo(fit.scale, 10);
      if (pair.dy > 1) expect(pair.my / pair.dy).toBeCloseTo(fit.scale, 10);
    }
  });

  it("keeps them while windowed onto a region shaped nothing like the change", () => {
    // Zoomed in, the region is squared off and then held inside a change that
    // is far taller than it is wide, so what the square gets handed is neither
    // the shape of the change nor the shape of the screen. Neither is a reason
    // for the picture inside it to be stretched.
    const nodes = scatter();
    const all = bounds(nodes, WHOLE);
    const fit = fitMap(region(all, { left: 900, top: 3800, width: 800, height: 450 }));

    for (const pair of pairs(nodes, fit)) {
      if (pair.dx > 1) expect(pair.mx / pair.dx).toBeCloseTo(fit.scale, 10);
      if (pair.dy > 1) expect(pair.my / pair.dy).toBeCloseTo(fit.scale, 10);
    }
  });

  it("leaves a card where it is when the floor has to make it visible", () => {
    // The floor may only make a card easier to see. Applied from the corner it
    // also moved it, by most of its own size — so the files too small to make
    // out were also the ones drawn furthest from where they are.
    const fit = fitMap({ x: 0, y: 0, width: 60000, height: 60000 });
    const speck = node({ x: 30000, y: 45000, width: 300, height: 300 });
    const at = placeNode(speck, fit);

    expect(at.width).toBeGreaterThanOrEqual(2);
    expect(middleOf(at).x).toBeCloseTo(fit.padX + (speck.x + 150) * fit.scale, 10);
    expect(middleOf(at).y).toBeCloseTo(fit.padY + (speck.y + 150) * fit.scale, 10);
  });

  it("draws the change the shape the change is", () => {
    const nodes = scatter();
    const all = bounds(nodes, WHOLE);
    const fit = fitMap(all);
    const drawn = nodes.map((n) => placeNode(n, fit));
    const left = Math.min(...drawn.map((d) => d.x));
    const top = Math.min(...drawn.map((d) => d.y));
    const right = Math.max(...drawn.map((d) => d.x + d.width));
    const bottom = Math.max(...drawn.map((d) => d.y + d.height));

    expect((right - left) / (bottom - top)).toBeCloseTo(all.width / all.height, 6);
  });
});

describe("the strip the bar across the top is standing on", () => {
  it("is not part of what the reader can see", () => {
    // The camera measures the viewport, which runs the full height of the page
    // with the chrome laid over the top of it. A frame drawn from that claims a
    // band of the drawing nobody can see.
    const win = { left: 100, top: 200, width: 800, height: 600 };
    expect(uncovered(win, 90)).toEqual({ left: 100, top: 290, width: 800, height: 510 });
  });

  it("takes nothing off when nothing is covering it", () => {
    // What a page rendered in Node reports, having no document to measure.
    const win = { left: 100, top: 200, width: 800, height: 600 };
    expect(uncovered(win, 0)).toEqual(win);
  });

  it("never takes off more than there is", () => {
    // A viewport shorter than its own chrome is a window being dragged closed,
    // and a negative height would fold the frame inside out.
    const win = { left: 0, top: 0, width: 800, height: 40 };
    expect(uncovered(win, 400).height).toBe(0);
    expect(uncovered(win, 400).top).toBe(40);
  });
});

describe("the frame showing what is on screen", () => {
  it("stays big enough to aim at", () => {
    // Zoomed right in, the window is a fraction of a pixel of the drawing, and
    // a frame drawn to scale disappears exactly when it is most needed.
    const fit = fitMap({ x: 0, y: 0, width: 100000, height: 100000 });
    const frame = placeWindow({ left: 0, top: 0, width: 1, height: 1 }, fit);
    expect(frame.width).toBeGreaterThanOrEqual(10);
    expect(frame.height).toBeGreaterThanOrEqual(10);
  });

  it("stays inside the square", () => {
    const fit = fitMap({ x: 0, y: 0, width: 1000, height: 1000 });
    const frame = placeWindow(
      { left: -5000, top: -5000, width: 20000, height: 20000 },
      fit,
    );
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(MAP_SIZE);
    expect(frame.y + frame.height).toBeLessThanOrEqual(MAP_SIZE);
  });
});
