import { describe, expect, it } from "vitest";

import { MANY, REACH, RUN, highways, type Travelling } from "../src/layout/highways.js";

/**
 * Many roads going the same way, gathered onto one.
 *
 * Twenty files calling one module drew twenty roads down twenty lanes a few
 * pixels apart — twenty lines for the reader to tell from their neighbours,
 * none of them saying anything the one beside it does not. A road network does
 * not look like that: everything going that way joins the highway, travels
 * together, and comes off at its own exit.
 */

/** Roads leaving a column at different heights, all running down beside it. */
function parallel(count: number, spread = 6): Travelling[] {
  return Array.from({ length: count }, (_, at) => ({
    id: `r:${at}`,
    corners: [
      { x: 0, y: at * 40 },
      { x: 400 + at * spread, y: at * 40 },
      { x: 400 + at * spread, y: 900 },
      { x: 700, y: 900 },
    ],
  }));
}

/** Only the ones running the way this assertion is about. */
const going = (found: { axis: string }[], axis: "vertical" | "horizontal") =>
  found.filter((one) => one.axis === axis);

/** Every vertical leg of a road, as the lane it runs in. */
function lanes(road: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let at = 1; at < road.length; at++) {
    if (road[at]!.x === road[at - 1]!.x) out.push(road[at]!.x);
  }
  return out;
}

describe("gathering roads that travel together", () => {
  it("puts nearby lanes on one lane", () => {
    const { roads, highways: found } = highways(parallel(5));

    const used = new Set(
      [...roads.values()].flatMap((road) => lanes(road)),
    );
    expect(used.size).toBe(1);
    // They also share the stretch they arrive along, which is a highway of its
    // own and the right answer — this one is about the lane they came down.
    const down = going(found, "vertical");
    expect(down).toHaveLength(1);
    expect(down[0]!.users).toBe(5);
  });

  it("leaves each road its own ends", () => {
    // The whole bargain: only the long middle is shared, because that is the
    // part where they were all saying the same thing.
    const before = parallel(4);
    const { roads } = highways(before);

    for (const road of before) {
      const after = roads.get(road.id)!;
      expect(after[0]).toEqual(road.corners[0]);
      expect(after[after.length - 1]).toEqual(road.corners[road.corners.length - 1]);
    }
  });

  it("leaves two roads alone, which are just two roads", () => {
    const { highways: found, roads } = highways(parallel(MANY - 1));
    expect(going(found, "vertical")).toHaveLength(0);
    const used = new Set([...roads.values()].flatMap((road) => lanes(road)));
    expect(used.size).toBe(MANY - 1);
  });

  it("does not drag a lane further than a reader would follow", () => {
    // Lanes a whole column apart are different places, and moving a road onto
    // one of them would be routing it somewhere it was never planned to go.
    const far = parallel(4, REACH * 3);
    const { highways: found } = highways(far);
    expect(going(found, "vertical")).toHaveLength(0);
  });

  it("ignores a run too short to be a journey", () => {
    const jogs: Travelling[] = Array.from({ length: 5 }, (_, at) => ({
      id: `r:${at}`,
      corners: [
        { x: 0, y: at * 10 },
        { x: 300 + at * 4, y: at * 10 },
        { x: 300 + at * 4, y: at * 10 + RUN / 2 },
        { x: 600, y: at * 10 + RUN / 2 },
      ],
    }));
    expect(going(highways(jogs).highways, "vertical")).toHaveLength(0);
  });

  it("keeps runs in the same column but at opposite ends apart", () => {
    /*
     * Two crowds in one column, one at the top of the drawing and one at the
     * bottom. They share a lane and nothing else, and drawing one highway
     * through both would lay a road across everything in between.
     */
    const top = parallel(3).map((road) => ({ ...road, id: `top:${road.id}` }));
    const low: Travelling[] = Array.from({ length: 3 }, (_, at) => ({
      id: `low:${at}`,
      corners: [
        { x: 0, y: 5000 + at * 40 },
        { x: 400 + at * 6, y: 5000 + at * 40 },
        { x: 400 + at * 6, y: 5900 },
        { x: 700, y: 5900 },
      ],
    }));

    const down = going(highways([...top, ...low]).highways, "vertical");
    expect(down).toHaveLength(2);
    expect(down[0]!.to).toBeLessThan(down[1]!.from);
  });

  it("gathers roads running across as well as down", () => {
    const across: Travelling[] = Array.from({ length: 4 }, (_, at) => ({
      id: `r:${at}`,
      corners: [
        { x: at * 30, y: 0 },
        { x: at * 30, y: 500 + at * 5 },
        { x: 900, y: 500 + at * 5 },
        { x: 900, y: 800 },
      ],
    }));
    const { highways: found } = highways(across);
    expect(found.some((one) => one.axis === "horizontal")).toBe(true);
  });

  it("takes out the kink that moving a road leaves behind", () => {
    /*
     * Putting a leg on a lane shortens the legs either side of it, and one can
     * end up with no length at all — two corners in the same place, which every
     * routine downstream measures the direction of.
     */
    const { roads } = highways(parallel(5));
    for (const road of roads.values()) {
      for (let at = 1; at < road.length; at++) {
        const a = road[at - 1]!;
        const b = road[at]!;
        expect(a.x === b.x && a.y === b.y).toBe(false);
        // And still only right angles.
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
  });

  it("says how many travel each highway, which is what its width means", () => {
    const { highways: found } = highways(parallel(9));
    expect(going(found, "vertical")[0]!.users).toBe(9);
  });

  it("does not touch the roads it was given", () => {
    const before = parallel(5);
    const was = JSON.stringify(before);
    highways(before);
    expect(JSON.stringify(before)).toBe(was);
  });
});
