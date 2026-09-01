import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { numbered, pairRows, type GapRow, type RowView } from "../src/app/canvas/rows.js";

/** The two numbers a row shows, in the order the gutters do. */
const gutters = (rows: readonly RowView[]) =>
  rows.map((row) => (row.kind === "gap" ? "gap" : [row.oldLine, row.newLine]));

/**
 * The shape `GoogleMap.tsx` arrives in.
 *
 * Its first hunk is `@@ -24,7 +24,7 @@`, so everything above line 24 is
 * identical in both checkouts. The card still shows line 1, because an import
 * arrow lands on it — and that line was read out of the head of the change, so
 * it comes with a head number and nothing else. Behind it are the two bands the
 * card folds lines 2 to 23 into, whose rows were read the same way.
 */
const googleMap = (): RowView[] => [
  { kind: "ctx", text: "import { useEffect, useMemo, useRef } from 'react'", newLine: 1 },
  {
    kind: "gap",
    imports: true,
    hidden: 2,
    text: "⋯ 2 imports",
    covers: { base: [1, 23], head: [2, 3] },
    rows: [
      { kind: "ctx", text: "import { MapProps } from './types'", newLine: 2 },
      { kind: "ctx", text: "import { useGeoMap } from '../GeoMap'", newLine: 3 },
    ],
  },
  {
    kind: "gap",
    hidden: 20,
    text: "⋯ 20 unchanged lines",
    header: "@@ -24,7 +24,7 @@ export function GoogleMap(props: MapProps) {",
    covers: { base: [24, 23], head: [4, 23] },
    rows: Array.from({ length: 20 }, (_, i) => ({
      kind: "ctx" as const,
      text: `line ${i + 4}`,
      newLine: i + 4,
    })),
  },
  { kind: "ctx", text: "  const streetViewListenerRef = useRef(null)", oldLine: 24, newLine: 24, inDiff: true },
  { kind: "del", text: "  const { markers, setMapControl } = useGeoMap()", oldLine: 27, inDiff: true },
  { kind: "add", text: "  const { markers, setMapControl, setTilesLoaded } = useGeoMap()", newLine: 27, inDiff: true },
  { kind: "ctx", text: "", oldLine: 28, newLine: 28, inDiff: true },
];

describe("the number a fetched line arrives without", () => {
  it("fills in the base number of a line read out of the head", () => {
    // The fault in the picture: `GoogleMap.tsx` drew its first row numbered 1
    // on the right and blank on the left, for an import statement that has been
    // line 1 of both checkouts all along.
    const first = numbered(googleMap())[0]!;
    expect(first.kind === "gap" ? null : [first.oldLine, first.newLine]).toEqual([1, 1]);
  });

  it("fills in the lines a band stands for as well", () => {
    // The band covering lines 4 to 23 was handed the base range 24–23 by the
    // host, so every line revealed from it came up with an empty base gutter.
    // The rows either side of the band say what the distance really is.
    const band = numbered(googleMap())[2] as GapRow;
    expect(gutters(band.rows!)).toEqual(
      Array.from({ length: 20 }, (_, i) => [i + 4, i + 4]),
    );
  });

  it("counts from wherever the two numberings have parted company", () => {
    // Six lines added above means the head runs six ahead, and an unchanged
    // line below carries both numbers to say so.
    const rows: RowView[] = [
      { kind: "add", text: "one", newLine: 35 },
      { kind: "ctx", text: "useEffect(() => {", oldLine: 35, newLine: 41 },
      { kind: "ctx", text: "  if (!onMapEvent) return", newLine: 42 },
    ];
    expect(gutters(numbered(rows))).toEqual([[undefined, 35], [35, 41], [36, 42]]);
  });

  it("says nothing about a line the change made", () => {
    // An inserted line exists nowhere in the base and a removed one nowhere in
    // the head, and a number in the other gutter is a place it never had.
    const rows: RowView[] = [
      { kind: "ctx", text: "kept", oldLine: 10, newLine: 10 },
      { kind: "del", text: "gone", oldLine: 11 },
      { kind: "add", text: "new", newLine: 11 },
    ];
    expect(gutters(numbered(rows))).toEqual([[10, 10], [11, undefined], [undefined, 11]]);
  });

  it("will not carry a distance across an insertion", () => {
    // The line below the insertion is six further on in the head than in the
    // base; the line above it is not, and there is nothing above saying by how
    // much. Guessing is how a fetched line lands on a number belonging to
    // another line entirely, so the gutter stays as empty as it was.
    const rows: RowView[] = [
      { kind: "ctx", text: "above", newLine: 3 },
      { kind: "add", text: "one", newLine: 4 },
      { kind: "ctx", text: "below", oldLine: 4, newLine: 5 },
    ];
    expect(gutters(numbered(rows))).toEqual([[undefined, 3], [undefined, 4], [4, 5]]);
  });

  it("will not carry one across a band whose lines were never read", () => {
    // A jump between hunks has nothing behind it, so what it hides — and
    // whether any of it was added or taken away — is not known here.
    const rows: RowView[] = [
      { kind: "ctx", text: "above", newLine: 3 },
      { kind: "gap", hidden: 40, text: "⋯ 40 unchanged lines" },
      { kind: "ctx", text: "below", oldLine: 44, newLine: 44 },
    ];
    expect(gutters(numbered(rows))).toEqual([[undefined, 3], "gap", [44, 44]]);
  });

  it("carries one across a band that hides nothing but context", () => {
    // Which is what an unchanged run is, and the reason the card can fill in
    // the line above it at all.
    const rows: RowView[] = [
      { kind: "ctx", text: "above", newLine: 1 },
      {
        kind: "gap",
        hidden: 2,
        text: "⋯ 2 unchanged lines",
        rows: [
          { kind: "ctx", text: "a", newLine: 2 },
          { kind: "ctx", text: "b", newLine: 3 },
        ],
      },
      { kind: "ctx", text: "below", oldLine: 4, newLine: 4 },
    ];
    const out = numbered(rows);
    expect(gutters(out)).toEqual([[1, 1], "gap", [4, 4]]);
    expect(gutters((out[1] as GapRow).rows!)).toEqual([[2, 2], [3, 3]]);
  });

  it("leaves a stretch nothing can be worked out about exactly as it came", () => {
    // No line above the insertion carries both numbers, so there is no distance
    // to apply there and nothing honest to write in the empty gutter.
    const rows: RowView[] = [
      { kind: "ctx", text: "a", newLine: 1 },
      { kind: "ctx", text: "b", newLine: 2 },
      { kind: "add", text: "new", newLine: 3 },
    ];
    const out = numbered(rows);
    expect(gutters(out)).toEqual([[undefined, 1], [undefined, 2], [undefined, 3]]);
    expect(out[0]).toBe(rows[0]);
  });

  it("numbers both gutters of a file the change never touched", () => {
    // Odin draws a card for a file nothing happened to whenever an arrow has to
    // land on it, and every line of one is fetched context: nothing on the card
    // carries both numbers, and before this the whole base column was blank.
    // A file that is the same file on both sides is the same file line for line.
    const rows: RowView[] = [
      { kind: "ctx", text: "export const iconMap = {", newLine: 40 },
      { kind: "ctx", text: "  home: HomeIcon,", newLine: 41 },
    ];
    expect(gutters(numbered(rows))).toEqual([[40, 40], [41, 41]]);
  });

  it("assumes nothing of the sort once a line has been added or taken away", () => {
    // The distance is nought only because there is nothing on the card to move
    // the two numberings apart. One removal is enough to make it a question
    // again, and the answer is not on the card.
    const rows: RowView[] = [
      { kind: "del", text: "gone", oldLine: 1 },
      { kind: "ctx", text: "after", newLine: 8 },
    ];
    expect(gutters(numbered(rows))).toEqual([[1, undefined], [undefined, 8]]);
  });

  it("hands back the row itself wherever it had nothing to add", () => {
    // What a rebuild did to a card is remembered against the row objects it
    // compared, so a copy made for no reason is a line that stops lighting up
    // while an agent is working on it.
    const rows = googleMap();
    const out = numbered(rows);
    for (const at of [3, 4, 5, 6]) expect(out[at]).toBe(rows[at]);
  });

  it("gives the split reading a number in both panes", () => {
    // Which is the whole point: two gutters, one line, and neither of them
    // blank beside the other.
    const pairs = pairRows(numbered(googleMap()));
    const first = pairs[0]!;
    expect(first.left && first.left.kind !== "gap" ? first.left.oldLine : null).toBe(1);
    expect(first.right && first.right.kind !== "gap" ? first.right.newLine : null).toBe(1);
  });
});

describe("the hunk header on a band", () => {
  const row = readFileSync(
    new URL("../src/app/canvas/Row.svelte", import.meta.url),
    "utf8",
  );

  it("may shrink, so that the ellipsis it asks for can happen", () => {
    /*
     * A flex item's automatic minimum size is its own contents, so a header
     * with `text-overflow: ellipsis` and nothing else never shrank and never
     * ellipsised: on a card narrower than the label and the header side by
     * side it ran off the end, cut mid-word by the card's own clipping and
     * pressed against the count it was supposed to be apart from. Checked as
     * source because the rule and its absence look identical from outside.
     */
    const rule = row.match(/\.row\.gap \.header \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/min-width:\s*0/);
  });
});
