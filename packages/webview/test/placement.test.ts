import { describe, expect, it } from "vitest";

import type { Arrangement, NodeView, ViewModel } from "../src/app/model.js";
import { packed, place, type Standing } from "../src/app/canvas/placement.js";

/**
 * The arithmetic that decides how much canvas there is.
 *
 * Worth its own file because getting it wrong is not a wrong pixel: the canvas
 * is sized from this and `fit` frames the camera against it, so a width that
 * belongs to a different drawing mis-zooms the whole page. None of it needs a
 * browser — the placement is the model, the arrangement in force and whatever
 * the cards have measured, and all three can be written down.
 */

function node(over: Partial<NodeView> = {}): NodeView {
  return {
    id: "n:a",
    path: "src/a.ts",
    x: 0,
    y: 0,
    width: 100,
    height: 200,
    column: 0,
    isTest: false,
    language: "typescript",
    untouched: false,
    status: "modified",
    ...over,
  };
}

/** A change of however many files, with the layout engine's spacing on it. */
function change(nodes: NodeView[], over: Partial<ViewModel> = {}): ViewModel {
  return {
    width: 0,
    height: 0,
    rowGap: 56,
    charWidth: 8,
    textLeft: 0,
    padding: 0,
    gutterWidth: 0,
    columnGap: 140,
    margin: 48,
    nodes,
    edges: [],
    parts: [],
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    arrangements: { withTests: spread([]), withoutTests: spread([]) },
    unified: false,
    canReview: false,
    review: "",
    viewer: "",
    viewerFace: "",
    comments: [],
    ...over,
  } as ViewModel;
}

/** An arrangement, written out card by card. */
function spread(
  spots: { id: string; x: number; y: number; width: number; height: number; column: number }[],
  over: Partial<Arrangement> = {},
): Arrangement {
  const nodes: Arrangement["nodes"] = {};
  for (const spot of spots) {
    nodes[spot.id] = {
      x: spot.x,
      y: spot.y,
      width: spot.width,
      height: spot.height,
      column: spot.column,
    };
  }
  return { nodes, width: 0, height: 0, ...over };
}

const OPEN: Standing = {
  inPart: null,
  showInfra: true,
  hideViewed: false,
  viewed: new Set(),
  measured: () => undefined,
};

describe("how much canvas the drawing needs", () => {
  it("reaches past the rightmost card, not past the widest one", () => {
    // Two columns, and the wider card is in the left one. A width taken from a
    // running column offset rather than from where the cards actually end puts
    // the canvas's right edge in the middle of the drawing.
    const data = change([
      node({ id: "n:wide", path: "src/wide.ts" }),
      node({ id: "n:narrow", path: "src/narrow.ts" }),
    ]);
    const layout = place(
      data,
      spread([
        { id: "n:wide", x: 48, y: 48, width: 900, height: 200, column: 0 },
        { id: "n:narrow", x: 1088, y: 48, width: 300, height: 200, column: 1 },
      ]),
      OPEN,
    );
    expect(layout.width).toBe(1088 + 300 + 48);
  });

  it("is the engine's own figure when nothing has been filtered", () => {
    // The layout engine leaves exactly a margin past the last card, so deriving
    // the extent has to land on the number the engine published or every graph
    // that was framed correctly stops being.
    const spots = [
      { id: "n:a", x: 48, y: 48, width: 900, height: 200, column: 0 },
      { id: "n:b", x: 1088, y: 48, width: 300, height: 400, column: 1 },
    ];
    const engine = spread(spots, { width: 1436, height: 496 });
    const data = change([node({ id: "n:a" }), node({ id: "n:b", path: "src/b.ts" })]);
    const layout = place(data, engine, OPEN);
    expect(layout.width).toBe(engine.width);
    expect(layout.height).toBe(engine.height);
  });

  it("is the width the reader's arrangement gives, not the width baked into the file", () => {
    // The node carries the size the engine chose for the reading the page was
    // built in. Read the other way round, the arrangement in force is a
    // different one and its widths are the true ones: taking the node's instead
    // drew every card hundreds of pixels wider than the lane it was placed in,
    // overlapping its neighbours and leaving every arrow aimed at a border the
    // card no longer had.
    const data = change([node({ id: "n:a", width: 1645 })]);
    const layout = place(
      data,
      spread([{ id: "n:a", x: 48, y: 48, width: 886, height: 200, column: 0 }]),
      OPEN,
    );
    expect(layout.cards[0]!.width).toBe(886);
    expect(layout.width).toBe(48 + 886 + 48);
  });

  it("closes up behind a card the reader has filtered away", () => {
    // The engine's width counts the schema column. Hidden, that column is empty
    // canvas the drawing is framed against — the change ends up in a corner.
    const data = change([
      node({ id: "n:a" }),
      node({ id: "n:db", path: "database/schema.sql" }),
    ]);
    const arrangement = spread(
      [
        { id: "n:a", x: 48, y: 48, width: 400, height: 200, column: 0 },
        { id: "n:db", x: 588, y: 48, width: 300, height: 200, column: 1 },
      ],
      { width: 936, height: 296 },
    );
    expect(place(data, arrangement, OPEN).width).toBe(936);
    expect(place(data, arrangement, { ...OPEN, showInfra: false }).width).toBe(
      48 + 400 + 48,
    );
  });

  it("grows under a card that measured taller than it was counted at", () => {
    const data = change([node({ id: "n:a" })]);
    const arrangement = spread([
      { id: "n:a", x: 48, y: 48, width: 400, height: 200, column: 0 },
    ]);
    const layout = place(data, arrangement, {
      ...OPEN,
      measured: (id) => (id === "n:a" ? 640 : undefined),
    });
    expect(layout.cards[0]!.height).toBe(640);
    expect(layout.height).toBe(48 + 640 + 48);
  });

  it("falls back to the model when every card has gone", () => {
    // Not a canvas of two margins: an empty placement is a drawing that has not
    // arrived, and framing the camera against nothing is worse than framing it
    // against the change.
    const data = change([node({ id: "n:db", path: "database/schema.sql" })], {
      width: 1200,
      height: 800,
    });
    const arrangement = spread([
      { id: "n:db", x: 48, y: 48, width: 300, height: 200, column: 0 },
    ]);
    const layout = place(data, arrangement, { ...OPEN, showInfra: false });
    expect(layout.cards).toEqual([]);
    expect(layout).toMatchObject({ width: 1200, height: 800 });
  });
});

describe("a part of the change, laid out for itself", () => {
  /** Three files in two columns, of which two are one part. */
  const data = change([
    node({ id: "n:a" }),
    node({ id: "n:b", path: "src/b.ts" }),
    node({ id: "n:c", path: "src/c.ts" }),
  ]);
  const whole = spread(
    [
      { id: "n:a", x: 48, y: 48, width: 400, height: 200, column: 0 },
      { id: "n:b", x: 2000, y: 4000, width: 600, height: 200, column: 1 },
      { id: "n:c", x: 48, y: 9000, width: 900, height: 200, column: 0 },
    ],
    { width: 2648, height: 9248 },
  );

  it("brings the part back to the margin and closes the gaps behind it", () => {
    const part = packed(data, whole, new Set(["n:a", "n:b"]));
    expect(part.nodes["n:a"]).toMatchObject({ x: 48, y: 48 });
    // The two screens of nothing between them belonged to a file that is not
    // here; what is left is the clearance the engine keeps between neighbours.
    expect(part.nodes["n:b"]).toMatchObject({ x: 48 + 400 + 140, y: 48 + 200 + 56 });
  });

  it("stops the canvas at the last card rather than a column short of nothing", () => {
    // The offset was read after a column gap had been added to it, so every
    // packed part carried a lane's worth of empty canvas off its right edge and
    // framed as though it had one more column than it does.
    const part = packed(data, whole, new Set(["n:a", "n:b"]));
    expect(part.width).toBe(48 + 400 + 140 + 600 + 48);
  });

  it("keeps a narrow card centred in its column, and does not let that widen the canvas", () => {
    // A column is as wide as the widest card still in it and the others sit in
    // the middle of it, which is how the engine centres them and how arrows
    // between two of them stay level.
    const part = packed(data, whole, new Set(["n:a", "n:c"]));
    expect(part.nodes["n:c"]).toMatchObject({ x: 48 });
    expect(part.nodes["n:a"]).toMatchObject({ x: 48 + (900 - 400) / 2 });
    expect(part.width).toBe(48 + 900 + 48);
  });

  it("is what the canvas is sized from once a part is open", () => {
    const layout = place(data, whole, { ...OPEN, inPart: new Set(["n:a", "n:b"]) });
    expect(layout.cards.map((c) => c.node.id)).toEqual(["n:a", "n:b"]);
    expect(layout.width).toBe(48 + 400 + 140 + 600 + 48);
  });
});
