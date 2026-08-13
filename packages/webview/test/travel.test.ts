import { describe, expect, it } from "vitest";

import type { EdgeView, NodeView, ViewModel } from "../src/app/model.js";
import { aimFor, type Spot } from "../src/app/canvas/keys.js";
import { arrows, type Box, type Reading } from "../src/app/canvas/wire.js";

/**
 * Being sent somewhere by the file list.
 *
 * Pressing a file in the side bar, or one of the references under it, ends in a
 * camera flight — and the flight itself needs a browser, so what is checked
 * here is the two answers it is composed from, both of which are arithmetic.
 * Where the camera lands a card, which is the walk's rule and has to stay the
 * walk's rule; and where a named line actually is, which is a question about
 * arrows that have already been placed and not about the model they came from.
 *
 * That second one is the trap. The model carries the layout engine's estimate
 * for the whole change, and the canvas moves the cards afterwards — it packs
 * them back to the margin with a part open and replaces estimated heights with
 * measured ones. Anything answering "where is that line" from the model is
 * answering about a drawing nobody is looking at.
 */

function node(over: Partial<NodeView> = {}): NodeView {
  return {
    id: "n:a",
    path: "src/a.ts",
    x: 0,
    y: 0,
    width: 400,
    height: 600,
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

/** A change of two files that reference each other, as the page holds it. */
function change(edges: EdgeView[]): ViewModel {
  const nodes = [node(), node({ id: "n:b", path: "src/b.ts", column: 1 })];
  const spots = {
    "n:a": { x: 0, y: 0, width: 400, height: 600, column: 0 },
    // Where the engine guessed this card would go, and — see below — not where
    // the canvas put it.
    "n:b": { x: 900, y: 900, width: 400, height: 600, column: 1 },
  };
  return {
    width: 1400,
    height: 1600,
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
      withTests: { width: 1400, height: 1600, nodes: spots },
      withoutTests: { width: 1400, height: 1600, nodes: spots },
    },
    unified: false,
    canReview: false,
    review: "",
    viewer: "",
    viewerFace: "",
    comments: [],
  } as ViewModel;
}

/** Everything showing, since the filters are a separate subject. */
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

/** Where the canvas actually put the cards, which is a different drawing. */
const PLACED: Record<string, Box> = {
  "n:a": { x: 0, y: 0, width: 400, height: 600 },
  "n:b": { x: 700, y: 120, width: 400, height: 600 },
};

/** A card that answers for its rows, the way a drawn one does. */
const rowAt = (offset: Record<string, number>) =>
  (nodeId: string, side: "base" | "head", line: number): number | null =>
    offset[`${nodeId}|${side}|${line}`] ?? null;

describe("finding the line the file list named", () => {
  it("takes the endpoint from where the cards are, not where they were counted", () => {
    const model = change([edge()]);
    const placed = arrows({
      model,
      reading: READING,
      boxes: PLACED,
      lineAt: rowAt({ "n:b|head|40": 150, "n:a|head|12": 90 }),
    })[0]!;
    const estimated = arrows({
      model,
      reading: READING,
      lineAt: rowAt({ "n:b|head|40": 150, "n:a|head|12": 90 }),
    })[0]!;

    // The arrow arrives at the left border of the destination as the canvas has
    // it standing, at the height of line forty on that card.
    expect(placed.wire.to).toEqual({ x: 700, y: 270 });
    // The same reference, read off the model, arrives seven hundred and eighty
    // units lower and two hundred further out — a flight to a card the reader
    // cannot see, at a line that is not there.
    expect(estimated.wire.to).toEqual({ x: 900, y: 1050 });
  });

  it("tells two references to the same file apart by line and side", () => {
    const model = change([
      edge(),
      edge({ id: "e:2", toLine: 40, toSide: "base" }),
      edge({ id: "e:3", toLine: 41 }),
    ]);
    const placed = arrows({
      model,
      reading: READING,
      boxes: PLACED,
      lineAt: rowAt({
        "n:b|head|40": 150,
        "n:b|base|40": 300,
        "n:b|head|41": 170,
        "n:a|head|12": 90,
      }),
    });

    const at = (id: string) => placed.find((arrow) => arrow.edge.id === id)!.wire.to.y;
    // The same line number on the other side of the diff is a different row and
    // a different place to be sent; so is the line under it.
    expect(at("e:1")).toBe(270);
    expect(at("e:2")).toBe(420);
    expect(at("e:3")).toBe(290);
  });

  it("offers both ends, so a line only pointed at can still be reached", () => {
    const model = change([edge()]);
    const [arrow] = arrows({
      model,
      reading: READING,
      boxes: PLACED,
      lineAt: rowAt({ "n:b|head|40": 150, "n:a|head|12": 90 }),
    });

    // Line twelve of the first file is never a destination — nothing in this
    // change points at it. It is still a real place on the canvas, at the
    // border the arrow sets out from.
    expect(arrow!.edge.fromLine).toBe(12);
    expect(arrow!.wire.from).toEqual({ x: 400, y: 90 });
  });
});

describe("landing on a card the reader means to start reading", () => {
  const CHROME = 80;
  const VIEWPORT = { width: 1728, height: 857 };

  /** Where the camera puts an aimed point: the middle of the *visible* canvas. */
  function screenTop(card: Spot, scale: number): number {
    const win = {
      left: 0,
      top: 0,
      width: VIEWPORT.width / scale,
      height: VIEWPORT.height / scale,
    };
    const point = aimFor(card, win, CHROME, scale);
    const y = CHROME + (VIEWPORT.height - CHROME) / 2 - point.y * scale;
    return y + card.y * scale;
  }

  const card = (height: number): Spot => ({ id: "n:a", x: 0, y: 4000, width: 400, height });

  it("pins a card taller than the view just under the chrome", () => {
    // A file is read from its first line down, and a tall card centred on its
    // middle opens halfway through itself with its beginning behind the bar.
    expect(Math.round(screenTop(card(4000), 0.54))).toBe(CHROME + 16);
  });

  it("asks the question at the scale being arrived at", () => {
    // Whether a card is tall is a question about how much of it fits, and that
    // is a different answer at the scale being flown to than at the one being
    // left. The same card is pinned to the top at a reading scale and centred
    // at the scale a whole change is fitted at — so an aim taken before the
    // lift is an aim taken about the wrong drawing.
    expect(Math.round(screenTop(card(2000), 0.54))).toBe(CHROME + 16);
    expect(Math.round(screenTop(card(2000), 0.06))).toBeGreaterThan(CHROME + 16);
  });

  it("centres a card that fits, leaving its top on screen", () => {
    const top = screenTop(card(400), 0.54);
    expect(top).toBeGreaterThan(CHROME);
    expect(top).toBeLessThan(VIEWPORT.height);
  });
});
