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
 * reserve the same run of canvas in every column a folder reaches into, and
 * this is what says they do.
 *
 * A folder only reaches into the columns its own cards landed in, so two
 * folders standing over columns that do not touch share one run of canvas and
 * are drawn side by side. Every measurement below has to survive that: sharing
 * a row is the one thing that can put somebody else's card at the same height
 * as a box and within reach of its border.
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

const groupedWith = (data: ViewModel, extra: Partial<Standing> = {}) =>
  place(data, arrangement(data), { ...STANDING, clusters: true, ...extra });

const grouped = (data: ViewModel) => groupedWith(data);

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

/**
 * A folder that is only ever called, drawn to the right of the folder calling it.
 *
 * The failure this guards against is the one that made clustering expensive
 * enough to turn off. A folder of components that are called and never call back
 * — a wrapper round a UI library is the usual one — has every one of its cards
 * in a column to the right of the folder that uses them, because that is what
 * the column means. The old banding still gave it a full-width stripe of its own
 * below, so a reader scrolled past two screens of empty canvas to be told
 * something the columns had already said by standing the cards further right.
 *
 * Sharing is allowed exactly when it cannot lie: two folders whose column ranges
 * do not touch cannot overlap horizontally, so neither box can be drawn over the
 * other or swallow its cards. Folders that do share columns still queue, and the
 * second half of this says so — a rule that shared everything would put a box
 * over a card the very first time two folders met in one column.
 */
describe("two folders that stand over different columns", () => {
  /** A folder used in the left columns, and one only ever called from it. */
  function downstream(): ViewModel {
    const data = model();
    data.nodes = [
      card("p1", "src/page/one.ts", 0, 0),
      card("p2", "src/page/two.ts", 1, 0),
      card("m1", "src/mui/one.ts", 2, 0),
      card("m2", "src/mui/two.ts", 3, 0),
    ];
    return data;
  }

  /** The same two folders, with each one reaching into the other's columns. */
  function tangled(): ViewModel {
    const data = model();
    data.nodes = [
      card("p1", "src/page/one.ts", 0, 0),
      card("p2", "src/page/two.ts", 2, 0),
      card("m1", "src/mui/one.ts", 1, 0),
      card("m2", "src/mui/two.ts", 3, 0),
    ];
    return data;
  }

  it("puts the downstream folder to the right rather than below", () => {
    const boxes = grouped(downstream()).folders ?? [];
    const page = boxes.find((box) => box.path === "src/page")!;
    const mui = boxes.find((box) => box.path === "src/mui")!;

    // The same run of canvas, which is what makes it a row rather than a queue.
    expect(mui.y).toBe(page.y);
    expect(mui.x).toBeGreaterThan(page.x + page.width);
  });

  it("stacks two folders that do share a column", () => {
    /*
     * The half of the rule that says no. These two interleave — one has cards in
     * columns 0 and 2, the other in 1 and 3 — so a box round either spans the
     * lanes the other is standing in, and drawing them level would be drawing
     * each of them over the other's cards.
     */
    const boxes = grouped(tangled()).folders ?? [];
    const page = boxes.find((box) => box.path === "src/page")!;
    const mui = boxes.find((box) => box.path === "src/mui")!;

    const [first, second] = page.y <= mui.y ? [page, mui] : [mui, page];
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  it("spends less height on the same cards when they can share a row", () => {
    // The whole of the point, said as the number a reader actually feels.
    expect(grouped(downstream()).height).toBeLessThan(grouped(tangled()).height);
  });

  it("still draws no box over a card that is not its own", () => {
    /*
     * The invariant the sharing puts most at risk, measured again on a drawing
     * that shares. Two boxes at the same height are separated by one column gap
     * and nothing else, and each of them grows a corridor outwards from its own
     * cards — so a corridor wide enough would put a folder's border straight
     * through the leftmost card of the folder beside it.
     */
    const drawn = grouped(downstream());
    const trespass: string[] = [];

    for (const box of drawn.folders ?? []) {
      for (const placed of drawn.cards) {
        if (box.nodes.includes(placed.node.id)) continue;
        if (overlaps(box, placed)) trespass.push(`${box.path} over ${placed.node.path}`);
      }
    }

    expect(trespass).toEqual([]);
  });

  it("still keeps a folder's box inside its parent's on all four sides", () => {
    // The parent holds children in two lanes of one row now rather than in two
    // stripes, and a rectangle worked out from the wrong half of that would cut
    // one of them in two.
    const boxes = grouped(downstream()).folders ?? [];
    const parent = boxes.find((box) => box.path === "src")!;
    for (const child of boxes.filter((box) => box.path !== "src")) {
      expect(child.x).toBeGreaterThanOrEqual(parent.x);
      expect(child.y).toBeGreaterThanOrEqual(parent.y);
      expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it("still leaves every card in the column its chain put it in", () => {
    // Sharing a row is a claim about height. A drawing that bought it by moving
    // a card sideways would have changed what the arrows mean.
    const data = downstream();
    const plain = place(data, arrangement(data), STANDING);
    const shared = grouped(data);

    const columns = (drawn: typeof plain) =>
      drawn.cards.map((placed) => [placed.node.id, placed.x] as const);
    expect(columns(shared)).toEqual(columns(plain));
  });
});

/**
 * A folder made to queue by a card that is not on the canvas.
 *
 * The fault a reader saw as a column of folder boxes marching down the drawing,
 * each one starting a little further right than the one above it, where the
 * columns had already said they could stand side by side. Two of the switches on
 * the page take cards away — an untouched file that has been read, and an
 * untouched file with no arrow left pointing at it — and they take them away by
 * skipping them as the column is placed. The bands were settled before that, off
 * a set of columns that still held every one of them.
 *
 * A band is the one thing on this side worked out from every column at once, so
 * a card nobody was ever going to see still widened its folder's reach and still
 * reserved a run of canvas for itself. One untouched type module in a far-left
 * column was enough to make a folder of leaf components span most of the width
 * of the change, and everything that would have shared its row queued behind it
 * instead.
 */
describe("a card the drawing is going to leave out", () => {
  const untouched = (id: string, path: string, column: number, y: number) => ({
    ...card(id, path, column, y),
    untouched: true,
  });

  /** A downstream folder, haunted by one of its own files in column zero. */
  function haunted(): ViewModel {
    const data = model();
    data.nodes = [
      card("p1", "src/page/one.ts", 0, 0),
      card("p2", "src/page/two.ts", 1, 0),
      card("m1", "src/mui/one.ts", 2, 0),
      card("m2", "src/mui/two.ts", 3, 0),
      untouched("ghost", "src/mui/legacy.ts", 0, 400),
    ];
    return data;
  }

  const gone = { stranded: new Set(["ghost"]) };
  const read = { hideViewed: true, viewed: new Set(["src/mui/legacy.ts"]) };

  it("still queues while the card is really there", () => {
    /*
     * The control, and the half of the rule that has to keep saying no. With
     * the file on the canvas the folder genuinely does stand in column zero,
     * so a box round it genuinely does span the lane the other folder is in.
     */
    const boxes = grouped(haunted()).folders ?? [];
    const page = boxes.find((box) => box.path === "src/page")!;
    const mui = boxes.find((box) => box.path === "src/mui")!;

    const [first, second] = page.y <= mui.y ? [page, mui] : [mui, page];
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  it("does not widen a folder's reach once the card has gone", () => {
    for (const away of [gone, read]) {
      const boxes = groupedWith(haunted(), away).folders ?? [];
      const page = boxes.find((box) => box.path === "src/page")!;
      const mui = boxes.find((box) => box.path === "src/mui")!;

      // The same run of canvas, because the only thing that ever put the two
      // folders in one another's way is not being drawn.
      expect(mui.y).toBe(page.y);
      expect(mui.x).toBeGreaterThan(page.x + page.width);
    }
  });

  it("spends less height than it did when it counted the card", () => {
    // Said as the number a reader feels: a row shared rather than queued for,
    // and no run of canvas reserved for something that is not there.
    for (const away of [gone, read]) {
      expect(groupedWith(haunted(), away).height).toBeLessThan(grouped(haunted()).height);
    }
  });

  it("still draws no box over a card that is not its own", () => {
    // Narrowing a band is exactly the move that puts a box within reach of
    // somebody else's cards, so the invariant is measured again on the drawing
    // the narrowing produced.
    for (const away of [gone, read]) {
      const drawn = groupedWith(haunted(), away);
      const trespass: string[] = [];

      for (const box of drawn.folders ?? []) {
        for (const placed of drawn.cards) {
          if (box.nodes.includes(placed.node.id)) continue;
          if (overlaps(box, placed)) trespass.push(`${box.path} over ${placed.node.path}`);
        }
      }

      expect(trespass).toEqual([]);
    }
  });

  it("still leaves every card in the column its chain put it in", () => {
    for (const away of [gone, read]) {
      const data = haunted();
      const plain = place(data, arrangement(data), { ...STANDING, ...away });
      const bands = groupedWith(data, away);

      const columns = (drawn: typeof plain) =>
        drawn.cards.map((placed) => [placed.node.id, placed.x] as const);
      expect(columns(bands)).toEqual(columns(plain));
    }
  });
});

/**
 * Two folders that are nowhere near each other and still cannot share a row.
 *
 * Written down as a refusal rather than as a fault, because the obvious repair
 * is wrong and somebody will try it. A folder whose cards land in columns nought,
 * one and three does not have a card in column two — so a rule that packed on
 * the columns a folder actually occupies would happily stand a folder living
 * only in column two beside it, and save a row.
 *
 * It cannot. A box is a rectangle drawn from the leftmost card of the folder to
 * the rightmost, and a rectangle from column nought to column three covers
 * column two whether or not the folder has anything in it. Level with each
 * other, the wider folder's box would be drawn straight across the other
 * folder's cards. The gap in a folder's columns is a hole in the set and not a
 * hole in the rectangle, so the reach a row is packed on has to be the whole
 * span — and the only ways out of that are drawing a box as something other
 * than a rectangle, or moving a card into another column, which is the one
 * thing clustering may never do.
 */
describe("a folder with a gap in the columns it stands over", () => {
  /** One folder in columns 0, 1 and 3; another in column 2 alone. */
  function sparse(): ViewModel {
    const data = model();
    data.nodes = [
      card("g1", "src/grid/one.ts", 0, 0),
      card("g2", "src/grid/two.ts", 1, 0),
      card("g3", "src/grid/types.ts", 3, 0),
      card("m1", "src/mui/one.ts", 2, 0),
      card("m2", "src/mui/two.ts", 2, 200),
    ];
    return data;
  }

  it("queues behind it even though no column holds both", () => {
    const drawn = grouped(sparse());
    const boxes = drawn.folders ?? [];
    const grid = boxes.find((box) => box.path === "src/grid")!;
    const mui = boxes.find((box) => box.path === "src/mui")!;

    // No column is in both folders, which is what makes the repair tempting.
    const columns = (box: typeof grid) =>
      new Set(
        drawn.cards
          .filter((placed) => box.nodes.includes(placed.node.id))
          .map((placed) => placed.node.column),
      );
    for (const column of columns(mui)) expect(columns(grid).has(column)).toBe(false);

    const [first, second] = grid.y <= mui.y ? [grid, mui] : [mui, grid];
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  it("would be drawn over the other folder's cards if it did not", () => {
    // The reason, measured rather than asserted: the wider box's rectangle
    // reaches across the whole of the lane the narrower folder is standing in.
    const drawn = grouped(sparse());
    const grid = (drawn.folders ?? []).find((box) => box.path === "src/grid")!;

    const theirs = drawn.cards.filter((placed) => placed.node.path.startsWith("src/mui/"));
    expect(theirs.length).toBeGreaterThan(0);
    for (const placed of theirs) {
      expect(overlaps(grid, { ...placed, y: grid.y })).toBe(true);
    }
  });
});

/**
 * How much room a box may take, asked of the room that is actually beside it.
 *
 * A reader looking at five boxes around one run of cards — `frontend`, `common`,
 * `src`, `components`, `interfaces`, which is an ordinary enough path — saw five
 * borders ten units apart and could not say which of them any card was in. The
 * step said how deep a thing was, and a step the thickness of a border said
 * nothing.
 *
 * It was tiny because it was worked out once for the whole drawing and then
 * charged to every box in it. Two folders sharing a run of canvas are separated
 * by one column gap and may have half of it each, which is true of a box with a
 * neighbour beside it and true of nothing else — so a nest standing at the edge
 * of the drawing, with open canvas on one side and a sibling a column away on
 * the other, was held to the sibling on both sides and then had the sixty-eight
 * units that were left divided between its five levels.
 *
 * Asked per box and per side, the same drawing gives the deep nest its whole
 * step everywhere the room is really there and holds it off the neighbour only
 * where the neighbour really is. A box therefore comes out lopsided, and that is
 * the answer rather than a fault in it: a border is drawn where there was space
 * to draw it. What is not allowed to come out of this is a box over a card that
 * is not inside it, and that is measured again here on drawings whose boxes are
 * now many times wider than the ones it was first measured on.
 */
describe("how far a box may grow beside its neighbours", () => {
  /** The reader's screenshot: five boxes, one inside the next. */
  function nest(): ViewModel {
    const data = model();
    data.nodes = [
      card("a1", "frontend/app/main.ts", 0, 0),
      card("a2", "frontend/app/routes.ts", 0, 200),
      card("c1", "frontend/common/index.ts", 1, 0),
      card("s1", "frontend/common/src/setup.ts", 1, 200),
      card("k1", "frontend/common/src/components/Button.tsx", 2, 0),
      card("i1", "frontend/common/src/components/interfaces/Props.ts", 3, 0),
      card("i2", "frontend/common/src/components/interfaces/Theme.ts", 3, 200),
    ];
    return data;
  }

  /** Two folders sharing a row with one column gap between their cards. */
  function facing(): ViewModel {
    const data = model();
    data.nodes = [
      card("p1", "src/page/one.ts", 0, 0),
      card("p2", "src/page/two.ts", 1, 0),
      card("m1", "src/mui/one.ts", 2, 0),
      card("m2", "src/mui/two.ts", 3, 0),
    ];
    return data;
  }

  const chain = [
    "frontend",
    "frontend/common",
    "frontend/common/src",
    "frontend/common/src/components",
    "frontend/common/src/components/interfaces",
  ];

  /** What a box was measured from, before it grew: its own cards. */
  const around = (drawn: ReturnType<typeof grouped>, box: { nodes: string[] }) => {
    const mine = drawn.cards.filter((placed) => box.nodes.includes(placed.node.id));
    return {
      left: Math.min(...mine.map((placed) => placed.x)),
      right: Math.max(...mine.map((placed) => placed.x + placed.width)),
    };
  };

  it("gives each level a step a reader can see, where there is room for one", () => {
    /*
     * Measured on the side the room is on. Deliberately a floor rather than the
     * step itself: what matters is that a reader can tell five nested borders
     * apart at the zoom they are reading code at, and pinning the constant here
     * would make this a test of the constant rather than of what it is for.
     */
    const boxes = grouped(nest()).folders ?? [];
    const nested = chain.map((path) => boxes.find((box) => box.path === path)!);
    for (const box of nested) expect(box).toBeDefined();

    for (let at = 1; at < nested.length; at++) {
      const outer = nested[at - 1]!;
      const inner = nested[at]!;
      expect(outer.x + outer.width - (inner.x + inner.width)).toBeGreaterThan(150);
    }
  });

  it("asks the two sides separately rather than the worse of them", () => {
    /*
     * The whole of the repair. This nest has a sibling's cards one column to
     * its left and the rest of the canvas to its right, and a box that had to
     * be symmetrical would be held to the sibling on both sides — which is the
     * drawing-wide figure again, in miniature.
     */
    const drawn = grouped(nest());
    const common = (drawn.folders ?? []).find((box) => box.path === "frontend/common")!;
    const cards = around(drawn, common);

    const open = common.x + common.width - cards.right;
    const crowded = cards.left - common.x;
    expect(open).toBeGreaterThan(crowded);
  });

  it("charges a folder only for the levels drawn inside it", () => {
    /*
     * `frontend/app` holds no other folder, so there is nothing for it to stand
     * clear of and a plain edge is the whole of what it needs. Charged for the
     * deepest nesting anywhere in the drawing it would have grown a border two
     * columns wide to say nothing at all, and it sits beside the nest that is
     * five levels deep, so that is exactly what it would have been charged.
     */
    const drawn = grouped(nest());
    const app = (drawn.folders ?? []).find((box) => box.path === "frontend/app")!;
    const cards = around(drawn, app);

    expect(cards.left - app.x).toBeLessThan(60);
    expect(app.x + app.width - cards.right).toBeLessThan(60);
  });

  it("draws no box over a card that is not inside it", () => {
    // The invariant the generous step puts most at risk, measured on both the
    // deep nest and the two folders sharing a row.
    for (const data of [nest(), facing()]) {
      const drawn = grouped(data);
      const trespass: string[] = [];

      for (const box of drawn.folders ?? []) {
        for (const placed of drawn.cards) {
          if (box.nodes.includes(placed.node.id)) continue;
          if (overlaps(box, placed)) trespass.push(`${box.path} over ${placed.node.path}`);
        }
      }

      expect(trespass).toEqual([]);
    }
  });

  it("leaves two folders facing each other half the gap each", () => {
    /*
     * Neither may have all of it. Both are measuring the same gap outwards from
     * their own cards at the same moment, so a rule that let either take the
     * whole of it would draw one of them through the other's border the first
     * time two folders shared a row.
     */
    const boxes = grouped(facing()).folders ?? [];
    const page = boxes.find((box) => box.path === "src/page")!;
    const mui = boxes.find((box) => box.path === "src/mui")!;

    expect(page.y).toBe(mui.y);
    expect(mui.x).toBeGreaterThan(page.x + page.width);
  });

  it("keeps a folder's box inside its parent's on all four sides", () => {
    // Five levels of it, with every level given a different allowance on every
    // side. A child granted more room than the box around it would grow out
    // through its parent's own border.
    const boxes = grouped(nest()).folders ?? [];
    const inside = (a: string, b: string) => a.startsWith(`${b}/`);

    for (const child of boxes) {
      for (const parent of boxes.filter((box) => inside(child.path, box.path))) {
        expect(child.x).toBeGreaterThanOrEqual(parent.x);
        expect(child.y).toBeGreaterThanOrEqual(parent.y);
        expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width);
        expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height);
      }
    }
  });

  it("draws no box over a box it is not inside", () => {
    // Boxes many times wider than they were is exactly the way two unrelated
    // folders come to cross, and a reader cannot tell which box a card is in
    // when they do.
    const boxes = grouped(nest()).folders ?? [];
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

  it("still leaves every card in the column its chain put it in", () => {
    // The room a box takes is a claim about empty canvas. A drawing that bought
    // it by moving a card sideways would have changed what the arrows mean.
    const data = nest();
    const plain = place(data, arrangement(data), STANDING);
    const boxed = grouped(data);

    const columns = (drawn: typeof plain) =>
      drawn.cards.map((placed) => [placed.node.id, placed.x] as const);
    expect(columns(boxed)).toEqual(columns(plain));
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

    /*
     * Enough to read as a corridor rather than as a thick edge. Deliberately a
     * floor and not the step itself: what matters is that a reader can see
     * which box a card is in, and pinning the exact number here would make this
     * a test of a constant rather than of the thing the constant is for.
     */
    expect(child.x - parent.x).toBeGreaterThan(10);
    expect(parent.x + parent.width - (child.x + child.width)).toBeGreaterThan(10);
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
