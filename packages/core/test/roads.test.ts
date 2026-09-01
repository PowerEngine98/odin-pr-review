import { describe, expect, it } from "vitest";

import {
  CORNER,
  HOP,
  STUB,
  roadAround,
  roadOver,
  roadPath,
  roadPoints,
  shortenRoad,
} from "../src/layout/roads.js";

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

/**
 * Roads that go around the buildings rather than through them.
 *
 * The arrows are drawn under the cards — they have to be, or every road would
 * be laid across the code it connects — so a road that crosses a card is a road
 * that disappears and comes out the other side. At a distance, where the cards
 * are solid blocks, that is a line in pieces with no way to tell which pieces
 * belong together.
 */
describe("planning a road around the buildings", () => {
  const wall = { x: 90, y: -40, width: 60, height: 200 };
  const from = { x: 0, y: 0 };
  const to = { x: 260, y: 60 };

  /** Whether any leg of a road passes through a rectangle. */
  const crosses = (road: { x: number; y: number }[], box = wall) =>
    road.slice(1).some((point, at) => {
      const before = road[at]!;
      const lowX = Math.min(before.x, point.x);
      const highX = Math.max(before.x, point.x);
      const lowY = Math.min(before.y, point.y);
      const highY = Math.max(before.y, point.y);
      return !(
        highX <= box.x ||
        lowX >= box.x + box.width ||
        highY <= box.y ||
        lowY >= box.y + box.height
      );
    });

  it("goes around what the plain road would cross", () => {
    expect(crosses(roadPoints(from, to, true))).toBe(true);
    expect(crosses(roadAround(from, to, true, [wall]))).toBe(false);
  });

  it("still only turns at right angles", () => {
    const road = roadAround(from, to, true, [wall]);
    for (let at = 1; at < road.length; at++) {
      const dx = road[at]!.x - road[at - 1]!.x;
      const dy = road[at]!.y - road[at - 1]!.y;
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("leaves and arrives square to the card", () => {
    /*
     * A search left to itself will come down onto the destination from above,
     * because that is a perfectly good path and nobody told it otherwise — and
     * then the head points at the top of the row rather than at the row.
     */
    const road = roadAround(from, to, true, [wall]);
    expect(road[0]!.y).toBe(road[1]!.y);
    expect(road[road.length - 1]!.y).toBe(road[road.length - 2]!.y);
  });

  it("takes the plain road when nothing is in the way", () => {
    const clear = { x: 90, y: 900, width: 60, height: 200 };
    expect(roadAround(from, to, true, [clear])).toEqual(roadPoints(from, to, true));
  });

  it("goes around a wall that a level road would run straight through", () => {
    /*
     * Two cards at the same height with a third between them. The road is two
     * points and there is nothing to turn for — which is exactly why this case
     * was waved through, and why it was the commonest broken road on a large
     * drawing: the shortest road is also the one most likely to be obstructed.
     */
    const between = { x: 100, y: -30, width: 60, height: 60 };
    const level = { x: 0, y: 0 };
    const across = { x: 300, y: 0 };
    expect(roadPoints(level, across, true)).toHaveLength(2);
    expect(crosses(roadAround(level, across, true, [between]), between)).toBe(false);
  });

  it("goes around a card standing outside the box between its two ends", () => {
    /*
     * The buildings worth planning around used to be only the ones inside that
     * box, which is the box a road stays in when it never detours. A road that
     * detours leaves it — it goes under the building in its way — and out there
     * stands a card nobody put on the map. The road came back reported clean
     * against everything it had been told about, and was drawn through it.
     */
    const across = { x: 200, y: -400, width: 100, height: 600 };
    // Below both ends, so outside the box they make, and lying exactly on the
    // detour under `across`.
    const under = { x: 220, y: 205, width: 60, height: 115 };
    const level = { x: 0, y: 0 };
    const far = { x: 600, y: 0 };

    // A road that is told only about the building in front of it goes under it
    // and through this one, which is what makes the case worth asking about.
    expect(crosses(roadAround(level, far, true, [across]), under)).toBe(true);

    const road = roadAround(level, far, true, [across, under]);
    expect(crosses(road, across)).toBe(false);
    expect(crosses(road, under)).toBe(false);
  });

  it("keeps planning while each road is still finding buildings it did not know about", () => {
    /*
     * Three goes was a guess, and too low. Each go puts the buildings the last
     * road walked into onto the map, so a road across a crowd learns a couple at
     * a time; on a real change the worst of them needed eleven. The ones that
     * ran out of goes were drawn straight through every card they had not yet
     * been told about, which on that change was fourteen roads.
     */
    const crowd = [];
    for (let column = 0; column < 8; column++) {
      for (let row = 0; row < 6; row++) {
        crowd.push({
          x: 150 + column * 210,
          y: -200 + row * 260 + (column % 2) * 130,
          width: 150,
          height: 200,
        });
      }
    }
    const road = roadAround({ x: 0, y: 0 }, { x: 3000, y: 1400 }, true, crowd);
    expect(crowd.filter((wall) => crosses(road, wall))).toEqual([]);
  });

  it("plans around the buildings it is about to hit when there are too many to map", () => {
    /*
     * The streets are the lines the buildings leave between them, so the map is
     * their count squared, and a change carries hundreds of arrows. Past what
     * it will map, it plans around the ones nearest the line it would take —
     * giving up entirely put the road through every one of them, which is the
     * fault this whole file exists to prevent.
     */
    const crowd = Array.from({ length: 60 }, (_, at) => ({
      x: 60 + at * 20,
      y: -40 + (at % 5) * 80,
      width: 14,
      height: 60,
    }));
    const road = roadAround(from, to, true, crowd);
    const hit = crowd.filter((wall) => crosses(road, wall));
    expect(hit.length).toBeLessThan(crowd.filter((wall) =>
      crosses(roadPoints(from, to, true), wall)).length);
  });

  it("plans hundreds of roads in a frame", () => {
    // Measured rather than assumed: this runs for every arrow on the drawing.
    const walls = Array.from({ length: 40 }, (_, at) => ({
      x: 200 + (at % 4) * 300,
      y: at * 90,
      width: 220,
      height: 70,
    }));
    const started = Date.now();
    for (let n = 0; n < 900; n++) {
      roadAround({ x: 0, y: (n * 37) % 3000 }, { x: 1400, y: (n * 53) % 3000 }, true, walls);
    }
    expect(Date.now() - started).toBeLessThan(400);
  });
});

/**
 * A little bridge where one road crosses another.
 *
 * Two roads meeting at a right angle draw an X, and an X cannot say which pair
 * of arms belongs together — so a reader following an arrow loses it at the
 * first crossing and picks up whichever line carries on. Every wiring diagram
 * ever drawn solves this the same way.
 */
describe("hopping one road over another", () => {
  const across = [
    { x: 0, y: 100 },
    { x: 300, y: 100 },
  ];

  it("arcs over the crossing and carries on", () => {
    const path = roadOver(across, [{ x: 150, y: 100 }]);
    expect(path).toContain(`A ${HOP} ${HOP}`);
    expect(path.startsWith("M 0 100")).toBe(true);
    expect(path.endsWith("L 300 100")).toBe(true);
  });

  it("leaves a road nobody crosses exactly as it was", () => {
    expect(roadOver(across, [])).toBe(roadPath(across));
  });

  it("ignores a crossing that is not on the road", () => {
    expect(roadOver(across, [{ x: 150, y: 900 }])).toBe(roadPath(across));
  });

  it("does not hop at the very ends, where there is no room", () => {
    // A bridge in the first few pixels would be a bump on the card's own edge.
    expect(roadOver(across, [{ x: 2, y: 100 }])).toBe(roadPath(across));
  });

  it("hops each crossing in the order the road meets them", () => {
    const path = roadOver(across, [{ x: 220, y: 100 }, { x: 90, y: 100 }]);
    expect(path.indexOf("83")).toBeLessThan(path.indexOf("213"));
    expect((path.match(/ A /g) ?? [])).toHaveLength(2);
  });
});
