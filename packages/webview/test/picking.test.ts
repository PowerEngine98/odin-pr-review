import { describe, expect, it } from "vitest";

import {
  commentOn,
  endAt,
  endsOf,
  forgeSide,
  holds,
  holdsBand,
  lineOn,
  patchOf,
  railSide,
  spanOf,
  type Pick,
} from "../src/app/canvas/picking.js";
import type { CodeRow } from "../src/app/canvas/rows.js";

const row = (given: Partial<CodeRow>): CodeRow => ({
  kind: "ctx",
  text: "",
  ...given,
});

const pick = (given: Partial<Pick> = {}): Pick => ({
  nodeId: "n:one",
  path: "src/a.ts",
  side: "head",
  from: 10,
  to: 10,
  ...given,
});

describe("the lines a gutter offers", () => {
  it("offers the base number on the left and the head number on the right", () => {
    const both = row({ oldLine: 12, newLine: 40, inDiff: true });
    expect(commentOn(both, "base", false)).toEqual({ side: "base", line: 12 });
    expect(commentOn(both, "head", false)).toEqual({ side: "head", line: 40 });
  });

  it("offers nothing where the line has no number on that side", () => {
    // An inserted line has no place in the base, so the gutter beside it is
    // blank and there is nothing there to point at.
    const added = row({ kind: "add", newLine: 40, inDiff: true });
    expect(commentOn(added, "base", false)).toBeNull();
    expect(commentOn(added, "head", false)).toEqual({ side: "head", line: 40 });
  });

  it("refuses a line the forge cannot see", () => {
    // Source Odin fetched so an arrow had somewhere to land is not in the
    // patch, and a remark on it is refused after it has been written.
    const context = row({ oldLine: 12, newLine: 12 });
    expect(commentOn(context, "head", false)).toBeNull();
    // The line is still nameable; only the offer to comment is withdrawn.
    expect(lineOn(context, "head", false)).toEqual({ side: "head", line: 12 });
  });

  it("gives a one-sided file the side it actually has, from either gutter", () => {
    // Both gutters of a wholly added file show the same number, and reading the
    // gutter instead would offer a base line on a file that has no base.
    const added = row({ kind: "add", newLine: 7, inDiff: true });
    expect(commentOn(added, "base", true)).toEqual({ side: "head", line: 7 });
    expect(commentOn(added, "head", true)).toEqual({ side: "head", line: 7 });

    const removed = row({ kind: "del", oldLine: 7, inDiff: true });
    expect(commentOn(removed, "head", true)).toEqual({ side: "base", line: 7 });
  });
});

describe("a range being chosen", () => {
  it("reads lowest first however it was dragged", () => {
    expect(spanOf(pick({ from: 40, to: 12 }))).toEqual({ start: 12, end: 40 });
    expect(spanOf(pick({ from: 12, to: 40 }))).toEqual({ start: 12, end: 40 });
  });

  it("reaches every line between its ends", () => {
    const dragged = pick({ from: 40, to: 12 });
    expect(holds(dragged, "n:one", "head", 12)).toBe(true);
    expect(holds(dragged, "n:one", "head", 26)).toBe(true);
    expect(holds(dragged, "n:one", "head", 40)).toBe(true);
    expect(holds(dragged, "n:one", "head", 41)).toBe(false);
  });

  it("stays on its own side and its own card", () => {
    // A range whose two ends are numbered against different checkouts is not
    // the ends of anything, and a line number is not unique across files.
    const chosen = pick({ from: 12, to: 40 });
    expect(holds(chosen, "n:one", "base", 20)).toBe(false);
    expect(holds(chosen, "n:two", "head", 20)).toBe(false);
    expect(holds(null, "n:one", "head", 20)).toBe(false);
  });

  it("reaches a band standing in for code inside it", () => {
    // Leaving the band unpainted breaks the block in half and reads as two
    // selections rather than one.
    const chosen = pick({ from: 12, to: 40 });
    expect(holdsBand(chosen, "n:one", { head: [20, 30] })).toBe(true);
    expect(holdsBand(chosen, "n:one", { head: [38, 60] })).toBe(true);
    expect(holdsBand(chosen, "n:one", { head: [41, 60] })).toBe(false);
    // A band that only says what it hides on the other side says nothing here.
    expect(holdsBand(chosen, "n:one", { base: [20, 30] })).toBe(false);
    expect(holdsBand(chosen, "n:one", undefined)).toBe(false);
  });
});

describe("the two spellings of a side", () => {
  it("says LEFT and RIGHT on the way out, which is all the forge accepts", () => {
    expect(forgeSide("base")).toBe("LEFT");
    expect(forgeSide("head")).toBe("RIGHT");
  });

  it("reads a rail back into the pair the cards are keyed by", () => {
    expect(railSide("base")).toBe("base");
    expect(railSide("head")).toBe("head");
    // Nothing said is not the same as "head", which is what a bare `sideOf`
    // would have answered for a missing attribute.
    expect(railSide(null)).toBeNull();
  });
});

describe("the two ends of a picked range", () => {
  it("finds them on the card the range belongs to, lowest first", () => {
    expect(endsOf(pick({ from: 40, to: 12 }), "n:one")).toEqual({
      side: "head",
      start: 12,
      end: 40,
    });
    expect(endsOf(pick(), "n:two")).toBeNull();
    expect(endsOf(null, "n:one")).toBeNull();
  });

  it("marks the first and last lines and nothing in between", () => {
    const ends = endsOf(pick({ from: 12, to: 40 }), "n:one");
    expect(endAt(ends, { side: "head", line: 12 })).toBe("start");
    expect(endAt(ends, { side: "head", line: 40 })).toBe("end");
    expect(endAt(ends, { side: "head", line: 26 })).toBeNull();
    // The other checkout's line 12 is a different line.
    expect(endAt(ends, { side: "base", line: 12 })).toBeNull();
  });

  it("gives a single line one handle rather than two on top of each other", () => {
    // Two grips stacked on one row are two things to take hold of that move
    // each other, with nothing between them to adjust.
    const ends = endsOf(pick({ from: 12, to: 12 }), "n:one");
    expect(endAt(ends, { side: "head", line: 12 })).toBe("start");
  });
});

describe("the one box a range is drawn as", () => {
  const piece = (top: number, left = 100, width = 200, across = true) => ({
    top,
    left,
    width,
    height: 18,
    across,
  });

  it("reaches from the top of the first piece to the bottom of the last", () => {
    // One box has no interior edge, which is the whole point: a tint per row
    // leaves a hairline at every boundary once the canvas is scaled.
    expect(patchOf([piece(0), piece(18), piece(36)])).toEqual({
      top: 0,
      left: 100,
      width: 200,
      height: 54,
      across: true,
    });
  });

  it("takes its width from the side the range is on", () => {
    // A band spans both panes because it stands for lines neither side
    // changed. It says how far the range reaches and nothing about which
    // column of it was chosen, so a pick on the base must not widen to cover
    // the head as well.
    const band = { top: 18, left: 0, width: 900, height: 12, across: false };
    expect(patchOf([piece(0), band, piece(30)])).toMatchObject({
      top: 0,
      left: 100,
      width: 200,
      height: 48,
    });
  });

  it("falls back to the full width when only a band is showing", () => {
    // Dragged from one side of a fold to the other with every picked line
    // folded away, the range still has to be drawn somewhere.
    const band = { top: 18, left: 0, width: 900, height: 12, across: false };
    expect(patchOf([band])).toMatchObject({ left: 0, width: 900 });
  });

  it("says nothing when none of the range is on screen", () => {
    expect(patchOf([])).toBeNull();
  });
});
