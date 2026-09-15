import { describe, expect, it } from "vitest";

import {
  PIN_CHROME,
  PIN_LEAST,
  PIN_UNMEASURED,
  pinBox,
  readSize,
  saySize,
  sizeFromViewBox,
  wandered,
  zoomOf,
} from "../src/app/canvas/drawn.js";

/**
 * How big a drawing is, and where a dropped one lands.
 *
 * Split out of the components for the reason `heading.ts` states at length, and
 * tested here for the same one: two coordinate systems meet in this arithmetic
 * and they agree at exactly one zoom. Left inside the component it could only
 * be exercised by mounting a page, and a page mounts at scale one — which is
 * the single setting under which every version of this bug has looked perfect.
 *
 * The bug it is about: a drawing dragged onto the canvas was given a box of
 * `360 / view.scale` by `260 / view.scale`. Neither number was the drawing's,
 * and the division took a window-pixel length into canvas units while the
 * picture inside the box went on being laid out in canvas units at its own
 * size. The box and its contents were measured in different things.
 */
describe("the size a drawing is pinned at", () => {
  const drop = { x: 1000, y: 800 };

  it("is the size the drawing measured, and has no zoom in it", () => {
    // A drawing seven hundred by five hundred and twenty is pinned as a box
    // seven hundred by five hundred and twenty, plus what the bar and the
    // paddings round it cost. The zoom is not an argument here and cannot be:
    // the point has already been converted by the camera, which is the only
    // thing that knows the transform, and a size in canvas units is what a
    // pinned box is measured in.
    const box = pinBox(drop, { width: 700, height: 520 });
    expect(box.width).toBe(700 + PIN_CHROME.width);
    expect(box.height).toBe(520 + PIN_CHROME.height);
  });

  it("pays for the bar the drawing is dragged by", () => {
    // Left out, every pinned drawing is a title bar too short and its bottom
    // row sits under the edge of the box.
    expect(PIN_CHROME.height).toBeGreaterThan(PIN_CHROME.width);
    const box = pinBox(drop, { width: 300, height: 300 });
    expect(box.height - 300).toBeGreaterThan(box.width - 300);
  });

  it("gives two different drawings two different boxes", () => {
    // The plainest statement of the fault: one constant meant a tall narrow
    // sequence and a wide flat graph were pinned as the same rectangle, and
    // whichever of the two did not fit scrolled inside it.
    const tall = pinBox(drop, { width: 220, height: 900 });
    const wide = pinBox(drop, { width: 980, height: 240 });
    expect(tall.width).not.toBe(wide.width);
    expect(tall.height).not.toBe(wide.height);
    expect(tall.height).toBeGreaterThan(wide.height);
    expect(wide.width).toBeGreaterThan(tall.width);
  });

  it("still lands somewhere when nothing could measure the drawing", () => {
    // A diagram that has not drawn yet — the renderer still on its way, a
    // source mermaid will not parse — has no size to take, and the reader who
    // dragged it still has to land with something.
    expect(pinBox(drop, null).width).toBe(PIN_UNMEASURED.width + PIN_CHROME.width);
    expect(pinBox(drop, undefined).height).toBe(
      PIN_UNMEASURED.height + PIN_CHROME.height,
    );
  });

  it("never lands smaller than the grip can drag it back to", () => {
    // A one-node graph measures almost nothing, and a box of almost nothing has
    // no bar left to take hold of and no corner to stretch.
    const box = pinBox(drop, { width: 10, height: 8 });
    expect(box.width).toBe(PIN_LEAST.width);
    expect(box.height).toBe(PIN_LEAST.height);
  });

  it("lands under the pointer rather than beside it", () => {
    // By the middle across, which is where a reader thinks they are holding the
    // thing they dragged, rather than by the corner, which is where the pointer
    // is not.
    const box = pinBox(drop, { width: 700, height: 520 });
    expect(box.x + box.width / 2).toBe(drop.x);
    expect(box.y).toBeLessThan(drop.y);
    expect(box.y + box.height).toBeGreaterThan(drop.y);
  });

  it("gives whole numbers, because they are written into a stylesheet", () => {
    const box = pinBox({ x: 10.4, y: 20.6 }, { width: 301.3, height: 199.7 });
    for (const number of [box.x, box.y, box.width, box.height]) {
      expect(Number.isInteger(number)).toBe(true);
    }
  });
});

/**
 * What a drawing says its own size is.
 *
 * The element is no answer: the panel holds diagrams to `max-width: 100%`, so a
 * wide graph in a narrow console measures the console. The `viewBox` is the
 * size mermaid laid the picture out at, and it is the drawing's own whatever
 * box it happens to be in at the time.
 */
describe("reading a drawing's own size", () => {
  it("takes the layout size off the viewBox", () => {
    expect(sizeFromViewBox("0 0 812 546")).toEqual({ width: 812, height: 546 });
    // Mermaid writes fractions and sometimes commas, and both are still an
    // answer.
    expect(sizeFromViewBox("0 0 812.5 546.25")).toEqual({
      width: 812.5,
      height: 546.25,
    });
    expect(sizeFromViewBox("0,0,812,546")).toEqual({ width: 812, height: 546 });
  });

  it("says nothing rather than something wrong", () => {
    // A diagram that has not drawn has no SVG and no attribute, and a box sized
    // from a guess about that is worse than the fallback, which at least knows
    // it is one.
    expect(sizeFromViewBox(null)).toBeNull();
    expect(sizeFromViewBox("")).toBeNull();
    expect(sizeFromViewBox("0 0 812")).toBeNull();
    expect(sizeFromViewBox("0 0 0 0")).toBeNull();
    expect(sizeFromViewBox("0 0 wide tall")).toBeNull();
  });

  it("carries the size across a drag and back", () => {
    expect(readSize(saySize({ width: 812, height: 546 }))).toEqual({
      width: 812,
      height: 546,
    });
    expect(saySize(null)).toBe("");
  });

  it("refuses anything that is not ours", () => {
    // A reader drags all sorts of things over a window. Whatever else arrives
    // on the transfer, it is not a size, and reading one out of it would put a
    // box of arbitrary dimensions on the change.
    expect(readSize(undefined)).toBeNull();
    expect(readSize("")).toBeNull();
    expect(readSize("https://example.com/x.png")).toBeNull();
    expect(readSize("0x0")).toBeNull();
    expect(readSize("-10x20")).toBeNull();
  });
});

/**
 * Whether the thing being measured is being measured in its own units.
 *
 * This is the number that was missing, and its absence is what cut the labels
 * off. Mermaid sizes a node from `getBoundingClientRect` on the label it has
 * just put in the document, and that rect is the screen's — every transform
 * between the element and the window is already applied to it. Inside the
 * canvas layer, which is scaled, the width that comes back is not the width the
 * SVG will be laid out in, so every box came out the zoom's fraction of its own
 * text and the text ran out of it.
 */
describe("how much a layer is scaling what is in it", () => {
  it("is the canvas scale for an element inside the canvas", () => {
    // Three hundred and fifty units laid out, seventy on the screen: a fifth,
    // which is the zoom a reader reaches for to see a whole change at once, and
    // the zoom the truncated screenshot was taken at.
    expect(zoomOf(70, 350)).toBeCloseTo(0.2, 10);
    expect(zoomOf(700, 350)).toBeCloseTo(2, 10);
  });

  it("is one for an element nothing is scaling", () => {
    expect(zoomOf(350, 350)).toBe(1);
    // `offsetWidth` is a whole number and the rect is not, so an untransformed
    // element reports a ratio a hair either side of one. Counter-transforming
    // every diagram in the page over a rounding error would be the correction
    // doing harm on its own account.
    expect(zoomOf(350.4, 350)).toBe(1);
    expect(zoomOf(349.6, 350)).toBe(1);
  });

  it("is one when there is nothing to divide", () => {
    // A box with no layout yet — hidden, unattached, mid-build. One is the
    // answer that changes nothing, which is what an unknown deserves.
    expect(zoomOf(0, 0)).toBe(1);
    expect(zoomOf(120, 0)).toBe(1);
    expect(zoomOf(0, 120)).toBe(1);
    expect(zoomOf(Number.NaN, 120)).toBe(1);
  });
});

/**
 * Telling a press from a drag, which begin identically.
 *
 * A drawing answers to both: dragged it is pinned to the change, pressed it
 * opens full size. The browser will not decide this — a drag the reader thinks
 * better of still ends in a release — so the distance travelled is what
 * answers, and it has to allow for a hand that moves a pixel or two while
 * clicking.
 */
describe("whether a press was a press", () => {
  const from = { x: 200, y: 140 };

  it("forgives the wobble of a hand on a trackpad", () => {
    expect(wandered(from, from)).toBe(false);
    expect(wandered(from, { x: 202, y: 142 })).toBe(false);
  });

  it("calls a deliberate movement a drag", () => {
    // Which must go on pinning: opening a viewer at the end of a drag that was
    // meant to put the drawing beside a card would be the feature taking the
    // other feature away.
    expect(wandered(from, { x: 260, y: 140 })).toBe(true);
    expect(wandered(from, { x: 200, y: 40 })).toBe(true);
    expect(wandered(from, { x: 140, y: 100 })).toBe(true);
  });
});
