import { describe, expect, it } from "vitest";

import {
  bezier,
  curveEnd,
  curvePoints,
  mix,
  pointAt,
  rim,
  shorten,
} from "../src/layout/curves.js";

/**
 * Arrows as curves.
 *
 * The shape is one cubic with both control points level with the ends it joins,
 * so the line leaves the card horizontally and arrives horizontally — which is
 * what makes the head read as pointing at the row rather than down onto it. The
 * arithmetic lives in one place because three renderers draw these, and an
 * arrow that took one shape in the written document and another once the page
 * booted is a picture moving for no reason anybody can see.
 */
describe("the curve an arrow draws", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 200 };

  it("leaves and arrives level with the rows it joins", () => {
    const [start, first, second, end] = curvePoints(from, to, 1, 1);
    expect(first!.y).toBe(start!.y);
    expect(second!.y).toBe(end!.y);
  });

  it("reaches further apart the further it has to go", () => {
    const near = curvePoints(from, { x: 200, y: 0 }, 1, 1);
    const far = curvePoints(from, { x: 2000, y: 0 }, 1, 1);
    expect(far[1]!.x - from.x).toBeGreaterThan(near[1]!.x - from.x);
  });

  it("keeps a bend on two cards almost touching", () => {
    // With no floor the control points land a pixel or two out and the arrow
    // draws as a straight diagonal, which says nothing about which border it
    // left by.
    const [, first] = curvePoints(from, { x: 4, y: 60 }, 1, 1);
    expect(first!.x - from.x).toBeGreaterThanOrEqual(40);
  });

  it("leans the way it arrives, not the way it set off", () => {
    /*
     * Two cards that overlap in x are joined most cheaply by leaving one border
     * and coming back into the border on the same side of the other, so the two
     * directions are not always the same. A curve told only about the departure
     * arrives from the wrong side with its head on the far edge of the card it
     * is pointing into — the hook.
     */
    const [, , second] = curvePoints(from, to, 1, -1);
    expect(second!.x).toBeGreaterThan(to.x);
  });

  it("draws from where the line begins while bending about where the card is", () => {
    // A line that starts a few pixels out on a dot's rim is still the same
    // arrow between the same two cards; letting that offset into the arithmetic
    // would give two arrows out of one card different bends for no reason.
    const start = { x: 13.5, y: 0 };
    const [drawn, first] = curvePoints(from, to, 1, 1, start);
    expect(drawn).toEqual(start);
    expect(first).toEqual(curvePoints(from, to, 1, 1)[1]);
  });

  it("writes one cubic and nothing else", () => {
    const path = bezier(curvePoints(from, to, 1, 1));
    expect(path.match(/C/g)).toHaveLength(1);
    expect(path).not.toContain("Q");
    expect(path.startsWith("M 0 0 C ")).toBe(true);
  });

  it("rounds what it writes", () => {
    // Full double precision writes sixteen digits per number into a path
    // attribute for a difference nothing can see.
    const path = bezier(curvePoints({ x: 1 / 3, y: 0 }, { x: 100, y: 1 / 7 }, 1, 1));
    for (const number of path.match(/-?[\d.]+/g) ?? []) {
      expect((number.split(".")[1] ?? "").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("making room for the head", () => {
  const points = curvePoints({ x: 0, y: 0 }, { x: 400, y: 200 }, 1, 1);

  it("stops the drawn line a head's length short of the end", () => {
    /*
     * Cut with de Casteljau rather than by stepping back along the end tangent:
     * the curve is at its most bent right where it arrives, so a straight
     * backoff of a head's length lands off the line and leaves a visible kink
     * between the stem and the triangle it feeds.
     */
    const cut = shorten(points, 13);
    const end = curveEnd(points);
    const stopped = curveEnd(cut);
    expect(Math.hypot(end.x - stopped.x, end.y - stopped.y)).toBeCloseTo(13, 0);
  });

  it("stays on the line it was cut from", () => {
    const cut = shorten(points, 13);
    // Halfway along the shortened curve is a point on the original one, which
    // is what a de Casteljau split means and a tangent backoff does not give.
    const half = pointAt(cut, 0.5);
    let nearest = Infinity;
    for (let step = 0; step <= 400; step++) {
      const on = pointAt(points, step / 400);
      nearest = Math.min(nearest, Math.hypot(on.x - half.x, on.y - half.y));
    }
    expect(nearest).toBeLessThan(0.5);
  });

  it("starts where it always started", () => {
    expect(shorten(points, 13)[0]).toEqual(points[0]);
  });
});

describe("where a line leaves its dot", () => {
  it("starts on the ring rather than outside it", () => {
    // Stopping cleanly at the outer edge leaves a hairline of background
    // between the dot and the line, which draws as a dot with a gap after it.
    const on = rim({ x: 100, y: 50 }, { x: 900, y: 50 }, 4.5);
    expect(on).toEqual({ x: 104.5, y: 50 });
  });

  it("faces where the line is going", () => {
    const on = rim({ x: 0, y: 0 }, { x: 0, y: 100 }, 5);
    expect(on).toEqual({ x: 0, y: 5 });
  });

  it("answers rather than dividing by nothing when there is nowhere to face", () => {
    const on = rim({ x: 7, y: 9 }, { x: 7, y: 9 }, 4.5);
    expect(Number.isFinite(on.x) && Number.isFinite(on.y)).toBe(true);
  });
});

describe("the arithmetic underneath", () => {
  it("mixes two places in proportion", () => {
    expect(mix({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.25)).toEqual({ x: 2.5, y: 5 });
  });

  it("walks a curve from one end to the other", () => {
    const points = curvePoints({ x: 0, y: 0 }, { x: 400, y: 200 }, 1, 1);
    expect(pointAt(points, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(points, 1)).toEqual({ x: 400, y: 200 });
  });
});
