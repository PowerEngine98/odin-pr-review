import { describe, expect, it } from "vitest";

import { CORNER, STUB, roadPath, roadPoints, shortenRoad } from "../src/layout/roads.js";

/** Every leg of a path, as the pairs of numbers written into it. */
function legs(path: string): { dx: number; dy: number }[] {
  const numbers = (path.match(/-?[\d.]+/g) ?? []).map(Number);
  const points: [number, number][] = [];
  for (let at = 0; at + 1 < numbers.length; at += 2) {
    points.push([numbers[at]!, numbers[at + 1]!]);
  }
  const out: { dx: number; dy: number }[] = [];
  for (let at = 1; at < points.length; at++) {
    out.push({
      dx: Math.abs(points[at]![0] - points[at - 1]![0]),
      dy: Math.abs(points[at]![1] - points[at - 1]![1]),
    });
  }
  return out;
}

/**
 * Arrows as roads.
 *
 * A curve says nothing true about a drawing of columns: two of them leaving the
 * same card fan apart and cross somewhere in the middle, so following one means
 * watching a line that is never where you last saw it. A road is followable —
 * straight runs, right-angled turns, and the turns rounded so the eye does not
 * stop at them.
 */
describe("routing an arrow as a road", () => {
  it("runs straight when both ends are level", () => {
    // Nothing to turn for. A jog would be a wobble.
    expect(roadPoints({ x: 0, y: 40 }, { x: 300, y: 40 }, true)).toEqual([
      { x: 0, y: 40 },
      { x: 300, y: 40 },
    ]);
  });

  it("turns twice, and only at right angles", () => {
    const points = roadPoints({ x: 0, y: 0 }, { x: 200, y: 80 }, true);
    expect(points).toHaveLength(4);
    for (let at = 1; at < points.length; at++) {
      const dx = points[at]!.x - points[at - 1]!.x;
      const dy = points[at]!.y - points[at - 1]!.y;
      // One axis or the other, never both.
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("turns in the gap between the two cards", () => {
    // Which is what makes two arrows crossing the same gap run beside each
    // other rather than wandering across the cards.
    const points = roadPoints({ x: 100, y: 0 }, { x: 300, y: 50 }, true);
    expect(points[1]!.x).toBe(200);
    expect(points[2]!.x).toBe(200);
  });

  it("leaves and arrives straight even when there is no gap", () => {
    // A destination beside or behind the source: the channel is outside the
    // pair rather than between them, and it is still only right angles.
    const points = roadPoints({ x: 300, y: 0 }, { x: 320, y: 60 }, true);
    expect(points[1]!.x).toBeGreaterThanOrEqual(300 + STUB);
    for (let at = 1; at < points.length; at++) {
      const dx = points[at]!.x - points[at - 1]!.x;
      const dy = points[at]!.y - points[at - 1]!.y;
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("goes the other way when the destination is to the left", () => {
    const points = roadPoints({ x: 300, y: 0 }, { x: 100, y: 40 }, false);
    expect(points[1]!.x).toBe(200);
    expect(points[3]!.x).toBe(100);
  });

  describe("the path it draws", () => {
    it("rounds every turn", () => {
      const path = roadPath(roadPoints({ x: 0, y: 0 }, { x: 200, y: 80 }, true));
      // Two turns, two fillets, and nothing else curved.
      expect(path.match(/Q/g)).toHaveLength(2);
      expect(path).not.toContain("C");
    });

    it("draws a straight road as one line", () => {
      expect(roadPath(roadPoints({ x: 0, y: 5 }, { x: 90, y: 5 }, true))).toBe(
        "M 0 5 L 90 5",
      );
    });

    it("never leaves a leg on the diagonal", () => {
      const path = roadPath(roadPoints({ x: 0, y: 0 }, { x: 400, y: 260 }, true));
      for (const leg of legs(path)) {
        // A fillet hops through its control point, which is inside the radius
        // on both axes. Anything longer than that on both is a real slope.
        expect(leg.dx <= CORNER + 1 || leg.dy <= CORNER + 1).toBe(true);
      }
    });

    it("shrinks a corner to fit a short leg", () => {
      // Or a road that turns twice in twenty pixels overlaps itself.
      const tight = roadPath([
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 6 },
        { x: 12, y: 6 },
      ]);
      expect(tight).not.toContain("NaN");
      const numbers = (tight.match(/-?[\d.]+/g) ?? []).map(Number);
      for (const value of numbers) expect(Number.isFinite(value)).toBe(true);
    });
  });

  describe("making room for the head", () => {
    it("takes it off the last leg, which is straight", () => {
      const road = roadPoints({ x: 0, y: 0 }, { x: 200, y: 80 }, true);
      const cut = shortenRoad(road, 13);
      expect(cut).toHaveLength(4);
      expect(cut[3]!.x).toBe(187);
      expect(cut[3]!.y).toBe(80);
      // And nothing before it has moved.
      expect(cut.slice(0, 3)).toEqual(road.slice(0, 3));
    });

    it("drops a last leg shorter than the head rather than reversing it", () => {
      // A negative leg would draw the arrow pointing back the way it came.
      const road = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 40 },
        { x: 105, y: 40 },
      ];
      expect(shortenRoad(road, 13)).toHaveLength(3);
    });
  });
});
