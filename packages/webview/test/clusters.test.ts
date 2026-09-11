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

  it("names a box at every level that holds more than one thing", () => {
    /*
     * `src/media/grid` living inside `src/media` is a fact about the project,
     * and a drawing that flattened it into two boxes side by side would be
     * saying something untrue about where the code is.
     */
    const named = (grouped(model()).folders ?? []).map((box) => box.path).sort();
    expect(named).toEqual(["src", "src/alpha", "src/beta", "src/gamma"]);
  });

  it("puts a folder's box inside its parent's", () => {
    const boxes = grouped(model()).folders ?? [];
    const parent = boxes.find((box) => box.path === "src")!;
    for (const child of boxes.filter((box) => box.path !== "src")) {
      expect(child.x).toBeGreaterThanOrEqual(parent.x);
      expect(child.y).toBeGreaterThanOrEqual(parent.y);
      expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
      // And it says how deep it is, which is what stacks the headers rather
      // than piling them on one line.
      expect(child.depth).toBeGreaterThan(parent.depth);
    }
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
        // Its own, at any depth: a box around `src` holds `src/alpha`'s cards.
        if (box.nodes.includes(placed.node.id)) continue;
        if (overlaps(box, placed)) trespass.push(`${box.path} over ${placed.node.path}`);
      }
    }

    expect(trespass).toEqual([]);
  });

  it("draws no box over a box it is not inside", () => {
    /*
     * A parent overlapping its children is the whole point of nesting. Two
     * folders that are not related overlapping is the fault — a reader cannot
     * tell which box a card is in when two of them cross.
     */
    const boxes = grouped(model()).folders ?? [];
    const kin = (a: string, b: string) =>
      a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

    const clashes: string[] = [];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        if (kin(boxes[a]!.path, boxes[b]!.path)) continue;
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

describe("how far a name sits below the bar", () => {
  /*
   * Every header that is held against the top of the window has to sit below
   * the one that encloses it, and a card's own title below all of them — three
   * things sliding down to stay under one bar and all arriving on the same line
   * is a folder's name written over a file's.
   *
   * What decides the offset is how many names are actually above it, and that
   * is not how deep the path is. A file five folders down may be inside two
   * boxes, because the levels in between hold one thing each and a frame around
   * a frame says nothing. Counting path segments pushed the title down by three
   * headers that were never drawn, which is what a reader saw as a card whose
   * name had slid into the middle of its own code.
   */
  function deep(): ViewModel {
    const data = model();
    // Two files, five folders down, with nothing else at the levels between.
    data.nodes = [
      card("d1", "frontend/common/src/components/carousel/one.ts", 0, 0),
      card("d2", "frontend/common/src/components/carousel/two.ts", 1, 0),
    ];
    return data;
  }

  it("counts the boxes a card is in, not the folders in its path", () => {
    const drawn = grouped(deep());
    const boxes = drawn.folders ?? [];

    // One box: every folder above `carousel` holds exactly one thing.
    expect(boxes.map((box) => box.path)).toEqual([
      "frontend/common/src/components/carousel",
    ]);
    expect(boxes[0]?.depth).toBe(1);
  });

  it("counts each enclosing box once, however deep the nesting goes", () => {
    const drawn = grouped(model());
    const boxes = drawn.folders ?? [];

    const parent = boxes.find((box) => box.path === "src")!;
    const child = boxes.find((box) => box.path === "src/alpha")!;
    expect(parent.depth).toBe(1);
    expect(child.depth).toBe(2);
  });

  it("draws a parent before the child it contains", () => {
    // A box is behind the cards and behind its own children, so the order they
    // are handed over in is the order they must be painted in.
    const boxes = grouped(model()).folders ?? [];
    const at = (path: string) => boxes.findIndex((box) => box.path === path);
    expect(at("src")).toBeLessThan(at("src/alpha"));
  });
});

describe("the room between one box and the next", () => {
  it("gives a folder a corridor inside its parent rather than the same border", () => {
    /*
     * Every box is measured from the same cards, and a folder very often shares
     * its leftmost file with the folder inside it. Inset by a fixed amount they
     * came out with their borders drawn on top of one another, so three nested
     * folders read as one box with a thick edge and a reader could not tell
     * which of them a card was in.
     */
    const boxes = grouped(model()).folders ?? [];
    const parent = boxes.find((box) => box.path === "src")!;
    const child = boxes.find((box) => box.path === "src/alpha")!;

    expect(child.x - parent.x).toBeGreaterThan(20);
    expect(parent.x + parent.width - (child.x + child.width)).toBeGreaterThan(20);
  });

  it("does not take that room out of the band below", () => {
    /*
     * Sideways only. Down the page the room is already reserved — a band pays a
     * pad and a header for every box that opens at it — so growing a box
     * downwards to match would push it into a band nobody set aside for it,
     * which is a box drawn over somebody else's cards. That is what the first
     * attempt did, and three of the measurements above caught it.
     */
    const drawn = grouped(model());
    const loose = drawn.cards.find((placed) => placed.node.path === "root.ts")!;
    for (const box of drawn.folders ?? []) {
      expect(overlaps(box, loose)).toBe(false);
    }
  });
});
