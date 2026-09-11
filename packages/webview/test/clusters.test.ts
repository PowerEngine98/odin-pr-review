import { describe, expect, it } from "vitest";

import { place, type Standing } from "../src/app/canvas/placement.js";

import type { Arrangement, ViewModel } from "../src/app/model.js";

/**
 * Drawing the cards grouped into the folder they live in.
 *
 * The constraint this must not touch is the one that makes the drawing worth
 * looking at: which column a card is in is the dependency chain, read left to
 * right by call order. Clustering is only ever a question about the order of
 * cards *within* a column, which was free.
 *
 * The part that has to be measured rather than reasoned about is whether the
 * boxes come out disjoint. A folder's cards are kept together and the folders
 * are ordered the same way in every column — but a column holding no card for
 * some folder would pack the rest tighter, and a box spanning several columns
 * would then swallow a card belonging to somebody else. That is why the bands
 * reserve the same run of canvas in every column, and this is what says they do.
 */
function card(id: string, path: string, column: number, y: number) {
  return {
    id,
    path,
    x: column * 400,
    y,
    width: 300,
    height: 120,
    column,
    isTest: false,
    language: "typescript",
    untouched: false,
    status: "modified",
  };
}

/**
 * A change shaped like the ones this is for: several folders, and columns that
 * do not all hold a card from every folder.
 */
function model(): ViewModel {
  const nodes = [
    card("a1", "src/alpha/one.ts", 0, 0),
    card("a2", "src/alpha/two.ts", 1, 0),
    card("a3", "src/alpha/three.ts", 1, 200),
    card("b1", "src/beta/one.ts", 0, 200),
    card("b2", "src/beta/two.ts", 2, 0),
    card("c1", "src/gamma/one.ts", 1, 400),
    card("c2", "src/gamma/two.ts", 2, 200),
    card("loose", "root.ts", 0, 400),
  ];
  return {
    width: 2000,
    height: 2000,
    rowGap: 40,
    margin: 48,
    charWidth: 7,
    textLeft: 0,
    padding: 12,
    gutterWidth: 58,
    columnGap: 140,
    nodes,
    edges: [],
    parts: [],
    meta: { baseRef: "main", headRef: "topic" },
    arrangements: {
      withTests: { width: 0, height: 0, nodes: {} },
      withoutTests: { width: 0, height: 0, nodes: {} },
    },
    unified: false,
    canReview: false,
    review: "",
    viewer: "",
    viewerFace: "",
    comments: [],
  } as unknown as ViewModel;
}

function arrangement(data: ViewModel): Arrangement {
  return {
    width: data.width,
    height: data.height,
    nodes: Object.fromEntries(
      data.nodes.map((node) => [
        node.id,
        { x: node.x, y: node.y, width: node.width, height: node.height, column: node.column },
      ]),
    ),
  };
}

const STANDING: Standing = {
  inPart: null,
  showInfra: true,
  hideViewed: false,
  viewed: new Set(),
  stranded: new Set(),
  clusters: false,
  measured: () => undefined,
};

const grouped = (data: ViewModel) =>
  place(data, arrangement(data), { ...STANDING, clusters: true });

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  b.x + b.width > a.x &&
  b.x < a.x + a.width &&
  b.y + b.height > a.y &&
  b.y < a.y + a.height;

describe("asking for the cards to be grouped by folder", () => {
  it("draws nothing of the kind unless it is asked", () => {
    // Absent rather than empty: a drawing that was never clustered and one
    // whose folders came out empty are different facts, and only one of them is
    // worth a box.
    const data = model();
    expect(place(data, arrangement(data), STANDING).folders).toBeUndefined();
  });

  it("names one box per folder holding more than one file", () => {
    const named = (grouped(model()).folders ?? []).map((box) => box.path).sort();
    expect(named).toEqual(["src/alpha", "src/beta", "src/gamma"]);
  });

  it("leaves a folder holding one file alone", () => {
    /*
     * A box around a single card is a second frame a few pixels outside the
     * first. It reads as a rendering fault rather than as a grouping, and says
     * nothing the card does not already say with its own path.
     */
    const data = model();
    data.nodes = [...data.nodes, card("only", "src/lonely/one.ts", 2, 400)];
    const named = (grouped(data).folders ?? []).map((box) => box.path);
    expect(named).not.toContain("src/lonely");
  });

  it("does not move a card out of the column its chain put it in", () => {
    /*
     * The one thing clustering is not allowed to cost. Columns are the call
     * order, and a reader who turns this on to tidy the drawing has not asked
     * for the arrows to start meaning something else.
     */
    const data = model();
    const plain = place(data, arrangement(data), STANDING);
    const bands = grouped(data);

    const columns = (drawn: typeof plain) =>
      drawn.cards.map((placed) => [placed.node.id, placed.x] as const);
    expect(columns(bands)).toEqual(columns(plain));
  });

  it("puts every card of a folder inside that folder's box", () => {
    const drawn = grouped(model());
    for (const box of drawn.folders ?? []) {
      const mine = drawn.cards.filter((placed) => box.nodes.includes(placed.node.id));
      expect(mine.length).toBeGreaterThan(1);
      for (const placed of mine) expect(overlaps(box, placed)).toBe(true);
    }
  });

  it("draws no box over a card belonging to another folder", () => {
    /*
     * The measurement this file exists for, and the reason the bands reserve
     * the same run of canvas in every column rather than letting each column
     * pack tight. Without that, a box spanning three columns swallows whatever
     * the middle column moved up into the space.
     */
    const drawn = grouped(model());
    const trespass: string[] = [];

    for (const box of drawn.folders ?? []) {
      for (const placed of drawn.cards) {
        if (box.nodes.includes(placed.node.id)) continue;
        if (overlaps(box, placed)) trespass.push(`${box.path} over ${placed.node.path}`);
      }
    }

    expect(trespass).toEqual([]);
  });

  it("draws no box over another box", () => {
    const boxes = grouped(model()).folders ?? [];
    const clashes: string[] = [];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        if (overlaps(boxes[a]!, boxes[b]!)) {
          clashes.push(`${boxes[a]!.path} / ${boxes[b]!.path}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps the files that live at the top of the project out of every box", () => {
    // They are the odds and ends of a project rather than a folder, and a box
    // called nothing, drawn around whatever happened to be loose, is a grouping
    // that claims something nobody said.
    const drawn = grouped(model());
    const loose = drawn.cards.find((placed) => placed.node.path === "root.ts")!;
    for (const box of drawn.folders ?? []) {
      expect(box.nodes).not.toContain(loose.node.id);
      expect(overlaps(box, loose)).toBe(false);
    }
  });

  it("still stacks a column without overlapping cards", () => {
    // Reserving room per band must not leave two cards of one column sitting on
    // top of each other, whatever the bands say.
    const drawn = grouped(model());
    const byColumn = new Map<number, typeof drawn.cards>();
    for (const placed of drawn.cards) {
      const held = byColumn.get(placed.node.column);
      if (held) held.push(placed);
      else byColumn.set(placed.node.column, [placed]);
    }
    for (const column of byColumn.values()) {
      const sorted = [...column].sort((a, b) => a.y - b.y);
      for (let at = 1; at < sorted.length; at++) {
        expect(sorted[at]!.y).toBeGreaterThanOrEqual(
          sorted[at - 1]!.y + sorted[at - 1]!.height,
        );
      }
    }
  });
});
