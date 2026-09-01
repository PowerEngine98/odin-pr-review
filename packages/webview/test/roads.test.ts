import { describe, expect, it } from "vitest";

import type { EdgeView, NodeView, ViewModel } from "../src/app/model.js";
import { arrows, secondPass, type Arrow, type Box, type Reading } from "../src/app/canvas/wire.js";

/**
 * Roads that go around the cards, on a drawing rather than in the geometry.
 *
 * The arithmetic has its own tests. What this is about is the two ways a road
 * reached the drawing without having been planned at all — the case the router
 * was never asked about, and the case where the answer was thrown away — both
 * of which drew a line straight through the cards between its ends. The arrows
 * are under the cards, so what the reader saw was a line in pieces with no way
 * to tell which pieces belonged together, and no amount of correct pathfinding
 * fixed it because the pathfinding was not being run.
 */

function node(over: Partial<NodeView> = {}): NodeView {
  return {
    id: "n:a",
    path: "src/a.ts",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    column: 0,
    isTest: false,
    language: "typescript",
    untouched: false,
    status: "modified",
    ...over,
  };
}

function edge(over: Partial<EdgeView> = {}): EdgeView {
  return {
    id: "e:1",
    from: "n:a",
    to: "n:b",
    fromPath: "src/a.ts",
    toPath: "src/b.ts",
    fromLine: 12,
    toLine: 40,
    fromSide: "head",
    toSide: "head",
    change: "added",
    kind: "call",
    confidence: "certain",
    symbol: "read",
    fromSymbol: "read",
    label: "",
    ...over,
  };
}

/**
 * Three cards in a row: the two ends of every arrow here, and one standing
 * between them at exactly the height the road wants to run at.
 */
const PLACED: Record<string, Box> = {
  "n:a": { x: 0, y: 0, width: 400, height: 300 },
  "n:middle": { x: 700, y: 0, width: 400, height: 300 },
  "n:b": { x: 1400, y: 0, width: 400, height: 300 },
};

function change(edges: EdgeView[]): ViewModel {
  const nodes = [
    node(),
    node({ id: "n:middle", path: "src/middle.ts", column: 1 }),
    node({ id: "n:b", path: "src/b.ts", column: 2 }),
  ];
  const spots = Object.fromEntries(
    nodes.map((one) => [one.id, { ...PLACED[one.id]!, column: one.column }]),
  );
  return {
    width: 2000,
    height: 800,
    rowGap: 56,
    charWidth: 7.45,
    textLeft: 0,
    padding: 0,
    gutterWidth: 0,
    columnGap: 140,
    margin: 48,
    nodes,
    edges,
    parts: [],
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    arrangements: {
      withTests: { width: 2000, height: 800, nodes: spots },
      withoutTests: { width: 2000, height: 800, nodes: spots },
    },
    unified: false,
    canReview: false,
    review: "",
    viewer: "",
    viewerFace: "",
    comments: [],
  } as ViewModel;
}

const READING: Reading = {
  unified: false,
  showTests: true,
  showImports: true,
  showUnchanged: true,
  showInfra: true,
  hideViewed: false,
  part: null,
  viewed: new Set<string>(),
};

/** Every row at the same height, so every road is level and wants to go straight. */
const level = () => 150;

/** Whether a path passes through a box, read from the path's own numbers. */
function through(path: string, box: Box): boolean {
  const numbers = (path.match(/-?[\d.]+/g) ?? []).map(Number);
  const points: { x: number; y: number }[] = [];
  for (let at = 0; at + 1 < numbers.length; at += 2) {
    points.push({ x: numbers[at]!, y: numbers[at + 1]! });
  }
  return points.slice(1).some((point, at) => {
    const before = points[at]!;
    return !(
      Math.max(before.x, point.x) <= box.x ||
      Math.min(before.x, point.x) >= box.x + box.width ||
      Math.max(before.y, point.y) <= box.y ||
      Math.min(before.y, point.y) >= box.y + box.height
    );
  });
}

const drawnLines = (arrow: Arrow) => [arrow.stem, arrow.trunk].filter(Boolean);

describe("which side of a card a road leaves by", () => {
  /*
   * A wide destination whose middle sits to the left of a narrow source, and
   * whose right-hand edge is far to the right of it. Middles said "go left";
   * the road then had to travel right, across the card it had just left and
   * past its own beginning, to reach an edge on the far side of everything.
   * What that draws is a hook.
   */
  const OVERLAPPING: Record<string, Box> = {
    "n:a": { x: 900, y: 0, width: 200, height: 300 },
    "n:middle": { x: 4000, y: 4000, width: 10, height: 10 },
    "n:b": { x: 500, y: 400, width: 1400, height: 300 },
  };

  function road(boxes: Record<string, Box>) {
    const [arrow] = arrows({
      model: change([edge()]),
      reading: READING,
      boxes,
      lineAt: level,
    });
    const numbers = (arrow!.stem.match(/-?[\d.]+/g) ?? []).map(Number);
    return { arrow: arrow!, from: { x: numbers[0]!, y: numbers[1]! } };
  }

  it("sets off towards the edge it is going to land on", () => {
    const { arrow, from } = road(OVERLAPPING);
    const lands = arrow.wire.to.x;
    const leaves = arrow.wire.from.x;
    // The first thing it does and the last thing it does agree about direction.
    expect(Math.sign(lands - leaves)).toBe(Math.sign(from.x - leaves) || Math.sign(lands - leaves));
  });

  it("lands on the near edge of a card it overlaps", () => {
    const { arrow } = road(OVERLAPPING);
    const near = OVERLAPPING["n:b"]!;
    const leaves = arrow.wire.from.x;
    const nearest =
      Math.abs(near.x - leaves) <= Math.abs(near.x + near.width - leaves)
        ? near.x
        : near.x + near.width;
    expect(arrow.wire.to.x).toBe(nearest);
  });

  it("keeps the dot inside the card it arrives at", () => {
    // The dot marking where an arrow landed belongs just inside the border it
    // came through, whichever border that turned out to be.
    const { arrow } = road(OVERLAPPING);
    const card = OVERLAPPING["n:b"]!;
    expect(arrow.wire.home.x).toBeGreaterThan(card.x);
    expect(arrow.wire.home.x).toBeLessThan(card.x + card.width);
  });

  it("still leaves by the facing sides when the cards are clear of each other", () => {
    const apart: Record<string, Box> = {
      "n:a": { x: 0, y: 0, width: 400, height: 300 },
      "n:middle": { x: 4000, y: 4000, width: 10, height: 10 },
      "n:b": { x: 1400, y: 0, width: 400, height: 300 },
    };
    const { arrow } = road(apart);
    expect(arrow.wire.from.x).toBe(400);
    expect(arrow.wire.to.x).toBe(1400);
  });
});

describe("a road on a drawing with a card in the way", () => {
  it("goes around it", () => {
    const [arrow] = arrows({
      model: change([edge()]),
      reading: READING,
      boxes: PLACED,
      lineAt: level,
    });
    for (const line of drawnLines(arrow!)) {
      expect(through(line, PLACED["n:middle"]!)).toBe(false);
    }
  });

  it("goes around it for a gathered run too", () => {
    /*
     * The one that was missed. Several references to the same place are drawn
     * as one road, and that road — the longest line on the drawing — was laid
     * out straight while every single arrow around it was being planned. On a
     * change of a hundred files it is most of the long lines.
     */
    const run = [
      edge({ id: "e:1", fromLine: 10 }),
      edge({ id: "e:2", fromLine: 20 }),
      edge({ id: "e:3", fromLine: 30 }),
    ];
    const drawn = arrows({
      model: change(run),
      reading: READING,
      boxes: PLACED,
      lineAt: level,
    });

    const carrier = drawn.find((one) => one.carrier);
    expect(carrier).toBeDefined();
    expect(carrier!.trunk).not.toBe("");
    expect(through(carrier!.trunk, PLACED["n:middle"]!)).toBe(false);
  });

  it("keeps a run's slip roads short rather than drawing the whole road again", () => {
    /*
     * The bridges replace the line an arrow draws, and every arrow was assumed
     * to draw its own full road as its stem. A gathered arrow does not: its
     * stem is a slip road into the junction, and handing it the full road drew
     * a second copy of the trunk over the top of it.
     */
    const drawn = arrows({
      model: change([edge({ id: "e:1", fromLine: 10 }), edge({ id: "e:2", fromLine: 20 })]),
      reading: READING,
      boxes: PLACED,
      lineAt: level,
    });

    // The sweep runs when the page schedules it, which here is at once.
    secondPass.run = (go) => go();
    try {
      const again = arrows({
        model: change([edge({ id: "e:1", fromLine: 10 }), edge({ id: "e:2", fromLine: 20 })]),
        reading: READING,
        boxes: PLACED,
        lineAt: level,
      });
      for (const arrow of again) {
        if (arrow.run === null) continue;
        // A slip road ends at the junction, well short of the far card.
        expect(through(arrow.stem, PLACED["n:b"]!)).toBe(false);
      }
    } finally {
      secondPass.run = null;
    }
    expect(drawn.length).toBe(2);
  });
});
