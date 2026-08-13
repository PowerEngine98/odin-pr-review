import { describe, expect, it } from "vitest";

import { bandRows, pairRows, type GapRow } from "../src/app/canvas/rows.js";

/** A band that knows what it hides, as the host sends one. */
const band = (given: Partial<GapRow> = {}): GapRow => ({
  kind: "gap",
  hidden: 3,
  text: "⋯ 3 unchanged lines",
  covers: { base: [1, 3], head: [1, 3] },
  rows: [
    { kind: "ctx", text: "one", newLine: 1 },
    { kind: "ctx", text: "two", newLine: 2 },
    { kind: "ctx", text: "three", newLine: 3 },
  ],
  ...given,
});

describe("the lines behind a band", () => {
  it("gives an unchanged line the number it has on each side", () => {
    // The host reads the run out of the head of the change, so every row
    // arrives with a head number and no base one. Two panes need both, and the
    // base gutter of every revealed line came up empty without this.
    expect(bandRows(band()).map((r) => (r.kind === "gap" ? null : [r.oldLine, r.newLine]))).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("counts from the distance between the two ranges", () => {
    // Lines added above this run push the head numbering down without moving
    // the base, and an unchanged run advances in lockstep from there.
    const shifted = band({ covers: { base: [1, 3], head: [11, 13] } });
    shifted.rows = [
      { kind: "ctx", text: "one", newLine: 11 },
      { kind: "ctx", text: "two", newLine: 12 },
    ];
    expect(bandRows(shifted).map((r) => (r.kind === "gap" ? null : [r.oldLine, r.newLine]))).toEqual([
      [1, 11],
      [2, 12],
    ]);
  });

  it("invents nothing for a line that exists on one side only", () => {
    // An import block collapsed into a band can hold a real insertion, and
    // giving a deleted line a number in the head is a place it never had.
    const mixed = band();
    mixed.rows = [
      { kind: "del", text: "gone", oldLine: 2 },
      { kind: "add", text: "new", newLine: 2 },
    ];
    expect(bandRows(mixed).map((r) => (r.kind === "gap" ? null : [r.oldLine, r.newLine]))).toEqual([
      [2, undefined],
      [undefined, 2],
    ]);
  });

  it("says nothing about a band that never read its lines", () => {
    // A jump between hunks has nothing behind it, and one with no range to
    // measure against is left exactly as it came.
    expect(bandRows(band({ rows: undefined }))).toEqual([]);
    const noRange = band({ covers: undefined });
    expect(bandRows(noRange)).toBe(noRange.rows);
  });

  it("pairs the filled-in rows across both panes", () => {
    // Which is what the split reading draws: one row, both numbers, in step.
    const pairs = pairRows(bandRows(band()));
    expect(pairs).toHaveLength(3);
    for (const [i, pair] of pairs.entries()) {
      expect(pair.left && pair.left.kind !== "gap" ? pair.left.oldLine : null).toBe(i + 1);
      expect(pair.right && pair.right.kind !== "gap" ? pair.right.newLine : null).toBe(i + 1);
    }
  });
});

describe("a band whose two sides are not the same length", () => {
  /**
   * The shape the user hit: five base lines hidden, but the rows behind the
   * band are the head's, and the head has more of them because something was
   * inserted in that run. `covers.head` is the rows' own span; `covers.base` is
   * inferred from the numbering either side of the band, so the two disagree.
   */
  const lopsided = (): GapRow => ({
    kind: "gap",
    hidden: 5,
    text: "⋯ 5 unchanged lines",
    covers: { base: [145, 149], head: [145, 153] },
    rows: [
      { kind: "ctx", text: "navigation: {", newLine: 145 },
      { kind: "ctx", text: "<LaborNavigation", newLine: 146 },
      { kind: "ctx", text: "id={id}", newLine: 147 },
      { kind: "ctx", text: "editMode={editMode}", newLine: 148 },
      { kind: "ctx", text: "noBackArrow={noBackArrow}", newLine: 149 },
      { kind: "ctx", text: "canManage={canManage}", newLine: 150 },
      { kind: "ctx", text: "/>", newLine: 151 },
      { kind: "ctx", text: "),", newLine: 152 },
      { kind: "ctx", text: "}}", newLine: 153 },
    ],
  });

  it("gives no base number rather than one belonging to another line", () => {
    // Taking the distance between the two starts and applying it to every row
    // ran the last four past the end of the base range and onto 150–153, which
    // the card is already showing below the band — so the same source appeared
    // twice, at consecutive numbers, and read as eight distinct lines.
    const filled = bandRows(lopsided());
    const bases = filled.map((r) => (r.kind === "gap" ? undefined : r.oldLine));
    expect(bases.every((b) => b === undefined)).toBe(true);
  });

  it("never numbers a revealed line outside the run the band stands for", () => {
    // The invariant that matters, whatever the arithmetic: a band covering base
    // 145–149 must not claim any line below 149.
    for (const band of [lopsided(), { ...lopsided(), covers: { base: [145, 153], head: [145, 153] } }]) {
      const base = band.covers!.base!;
      for (const row of bandRows(band)) {
        if (row.kind === "gap" || row.oldLine === undefined) continue;
        expect(row.oldLine).toBeGreaterThanOrEqual(base[0]);
        expect(row.oldLine).toBeLessThanOrEqual(base[1]);
      }
    }
  });

  it("still fills in a run that really is the same on both sides", () => {
    // The case that made this worth doing keeps working: the head numbering
    // shifted by a constant, every line present on both sides.
    const even: GapRow = {
      kind: "gap",
      hidden: 3,
      text: "⋯ 3 unchanged lines",
      covers: { base: [10, 12], head: [20, 22] },
      rows: [
        { kind: "ctx", text: "a", newLine: 20 },
        { kind: "ctx", text: "b", newLine: 21 },
        { kind: "ctx", text: "c", newLine: 22 },
      ],
    };
    expect(bandRows(even).map((r) => (r.kind === "gap" ? null : [r.oldLine, r.newLine]))).toEqual([
      [10, 20],
      [11, 21],
      [12, 22],
    ]);
  });
});
