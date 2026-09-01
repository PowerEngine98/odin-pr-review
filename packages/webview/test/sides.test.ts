import { describe, expect, it } from "vitest";

import type { EdgeView, NodeView, ViewModel } from "../src/app/model.js";
import { arrows, type Box, type Reading } from "../src/app/canvas/wire.js";

/**
 * Which border of each card an arrow joins, on a drawing rather than in the
 * arithmetic.
 *
 * The obvious answer is to compare the two middles, and it is wrong whenever
 * two cards overlap in x — which on a drawing of files is common. The middle of
 * a wide destination can sit to the left of a narrow source while its
 * right-hand edge is far to the right, so the arrow left by the source's left
 * side and then travelled right across the card it had just left to reach an
 * edge on the far side of everything. What that draws is a hook, and it is the
 * one thing about an arrow's shape a reader cannot read past.
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

/** Three cards in a row: the two ends of every arrow here, and one between. */
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

/** Every row at the same height, so nothing about the answer is about heights. */
const level = () => 150;

/** The numbers a path is written from, in the order they were written. */
function numbersIn(path: string): number[] {
  return (path.match(/-?[\d.]+/g) ?? []).map(Number);
}

describe("which side of a card an arrow leaves by", () => {
  /*
   * A wide destination whose middle sits to the left of a narrow source, and
   * whose right-hand edge is far to the right of it. Middles said "go left";
   * the arrow then had to travel right, across the card it had just left and
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
    const numbers = numbersIn(arrow!.stem);
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

/**
 * Several references to one place, drawn as one line.
 *
 * A short stem from each row to a junction just clear of the card, and one
 * curve from there onwards. The fault this keeps out is the trunk beginning
 * somewhere the stems do not end — a line starting in mid-air, which readers
 * reported over and over as an arrow that does not render.
 */
describe("a run of arrows gathered into one", () => {
  const run = [
    edge({ id: "e:1", fromLine: 10 }),
    edge({ id: "e:2", fromLine: 20 }),
    edge({ id: "e:3", fromLine: 30 }),
  ];

  const gathered = () =>
    arrows({
      model: change(run),
      reading: READING,
      boxes: PLACED,
      // Spread down the card, so the junction is somewhere none of them
      // started and every stem has to reach it.
      lineAt: (_id, _side, line) => 40 + line * 4,
    });

  it("gives one of them the trunk and the head, and the rest neither", () => {
    const drawn = gathered();
    expect(drawn.filter((one) => one.carrier)).toHaveLength(1);
    expect(drawn.filter((one) => one.head !== "")).toHaveLength(1);
    for (const arrow of drawn) expect(arrow.run).not.toBeNull();
  });

  it("starts the trunk exactly where every stem ends", () => {
    const drawn = gathered();
    const carrier = drawn.find((one) => one.carrier)!;
    const trunk = numbersIn(carrier.trunk);
    const junction = { x: trunk[0]!, y: trunk[1]! };

    for (const arrow of drawn) {
      const stem = numbersIn(arrow.stem);
      const ends = { x: stem[stem.length - 2]!, y: stem[stem.length - 1]! };
      expect(Math.hypot(ends.x - junction.x, ends.y - junction.y)).toBeLessThan(1);
    }
  });

  it("draws every one of them as a curve", () => {
    const drawn = gathered();
    for (const arrow of drawn) expect(arrow.stem).toContain(" C ");
    expect(drawn.find((one) => one.carrier)!.trunk).toContain(" C ");
  });

  it("leaves each stem on its own row's dot", () => {
    // The dot says where an arrow sets off from. A stem that starts anywhere
    // else leaves the dot marking nothing, which is the fault the dots being
    // read from the line rather than remembered beside it exists to prevent.
    for (const arrow of gathered()) {
      const stem = numbersIn(arrow.stem);
      const port = arrow.wire.port;
      expect(Math.hypot(stem[0]! - port.x, stem[1]! - port.y)).toBeLessThan(8);
    }
  });
});
