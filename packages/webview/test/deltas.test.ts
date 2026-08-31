import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { deltaOf } from "../src/app/canvas/deltas.js";

import type { RowView } from "../src/app/canvas/rows.js";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

/** A card's worth of rows, written as the lines they show. */
function rows(...lines: string[]): RowView[] {
  return lines.map((text) => ({ kind: "ctx", text }) as RowView);
}

/**
 * What a card says about the edit that has just landed on it.
 *
 * A live reading redraws itself whenever the working tree moves, and the redraw
 * is silent — the rows are simply different ones. On a two-hundred-line card
 * that is a change with nothing at all to see, which is no use to somebody
 * watching an agent work.
 */
describe("the difference between two readings of a card", () => {
  it("says nothing when nothing moved", () => {
    const delta = deltaOf(rows("a", "b", "c"), rows("a", "b", "c"));
    expect(delta.marks.size).toBe(0);
    expect(delta.gone).toEqual([]);
  });

  it("marks a rewritten line, and only that line", () => {
    const after = rows("a", "B", "c");
    const delta = deltaOf(rows("a", "b", "c"), after);
    expect(delta.marks.get(after[1]!)).toBe("changed");
    expect(delta.marks.size).toBe(1);
  });

  it("marks lines that arrived as arrivals, not as rewrites", () => {
    // Yellow says "this line is different"; green says "this line is new".
    const after = rows("a", "b", "new", "c");
    const delta = deltaOf(rows("a", "b", "c"), after);
    expect(delta.marks.get(after[2]!)).toBe("added");
    expect(delta.marks.size).toBe(1);
  });

  it("is not fooled by everything under an insertion moving down", () => {
    // The reason rows are matched by text rather than by line number: one line
    // inserted at the top renumbers the rest, and comparing numbers would call
    // the whole file rewritten for the sake of it.
    const after = rows("new", "a", "b", "c");
    const delta = deltaOf(rows("a", "b", "c"), after);
    expect(delta.marks.size).toBe(1);
    expect(delta.marks.get(after[0]!)).toBe("added");
  });

  it("leaves a box where a run of lines was taken from", () => {
    const after = rows("a", "d");
    const delta = deltaOf(rows("a", "b", "c", "d"), after);
    expect(delta.gone).toEqual([{ before: after[1], lines: 2 }]);
    expect(delta.marks.size).toBe(0);
  });

  it("hangs a removal from the end of the card on nothing", () => {
    // There is no row after the last line of a file, so the box has to know it
    // belongs at the bottom rather than above something.
    const after = rows("a", "b");
    const delta = deltaOf(rows("a", "b", "c"), after);
    expect(delta.gone).toEqual([{ before: undefined, lines: 1 }]);
  });

  it("reports a shrinking rewrite as both", () => {
    // Three lines replaced by one: the line that remains was rewritten, and two
    // lines' worth of space closes up under it.
    const after = rows("a", "one", "z");
    const delta = deltaOf(rows("a", "b", "c", "d", "z"), after);
    expect(delta.marks.get(after[1]!)).toBe("changed");
    expect(delta.gone).toEqual([{ before: after[2], lines: 2 }]);
  });

  it("says nothing about a card that was replaced wholesale", () => {
    // Switching branch changes every row. Painting all of them tells the reader
    // only that something happened, which they can already see.
    expect(deltaOf(rows("a", "b"), rows("x", "y")).marks.size).toBe(0);
  });

  it("says nothing about a card that had no rows to compare", () => {
    expect(deltaOf([], rows("a")).marks.size).toBe(0);
    expect(deltaOf(rows("a"), []).gone).toEqual([]);
  });

  it("treats bands by what they stand for rather than by their text", () => {
    const before: RowView[] = [
      { kind: "ctx", text: "a" },
      { kind: "gap", hidden: 10, text: "…" },
    ];
    const after: RowView[] = [
      { kind: "ctx", text: "a" },
      { kind: "gap", hidden: 10, text: "@@ different label @@" },
    ];
    expect(deltaOf(before, after).marks.size).toBe(0);
  });
});

/**
 * Where the difference is worked out, and when.
 *
 * Before the assignment that throws the old rows away, in both of the messages
 * that can carry new ones: the small patch a rebuild usually sends, and the
 * whole model it sends when the edit was structural.
 */
describe("noticing the edit as it lands", () => {
  const state = read("../src/app/state.svelte.ts");

  it("keeps the rows a card is holding before replacing them", () => {
    expect(state).toMatch(/const before = Array\.isArray\(fields\["rows"\]\)/);
  });

  it("compares against what the card will actually read", () => {
    // Not against the rows that arrived in the message: those are plain
    // objects, the card draws the proxied ones, and a mark filed under an
    // object nothing on the page holds matches nothing at all.
    expect(state).toMatch(/deltaOf\(before, node\.rows as RowView\[\]\)/);
  });

  it("does the same when a rebuild replaces the whole model", () => {
    expect(state).toMatch(/model\.current = next;[\s\S]{0,600}deltaOf\(before, node\.rows/);
  });

  it("keeps only the last rebuild's worth of marks", () => {
    expect(state).toMatch(/ui\.deltas = deltas/);
  });
});

/**
 * How it is drawn.
 *
 * A row that changed can be coloured where it is. A row that is gone has
 * nothing left to colour, so the space it took is drawn instead and then
 * closed — and that box must not push the card around while it plays, because
 * the card's height is what every arrow on the page is aimed at.
 */
describe("drawing what the rebuild did", () => {
  const card = read("../src/app/canvas/Card.svelte");
  const row = read("../src/app/canvas/Row.svelte");

  it("colours a rewrite and an arrival differently", () => {
    expect(row).toMatch(/\.row\.just-changed\s*\{\s*--touched:\s*var\(--warning\)/);
    expect(row).toMatch(/\.row\.just-added\s*\{\s*--touched:\s*var\(--added\)/);
  });

  it("fades on its own rather than waiting to be cleared", () => {
    expect(row).toMatch(/animation:\s*line-touched[^;]*forwards/);
    expect(row).toMatch(/100%\s*\{\s*box-shadow:\s*inset 0 0 0 999px transparent/);
  });

  it("closes the space removed lines were taking", () => {
    expect(card).toMatch(/@keyframes gone-closing[\s\S]{0,400}100% \{ height: 0/);
    expect(card).toMatch(/height:\s*calc\(var\(--gone\) \* var\(--line-height\)\)/);
  });

  it("draws that box over the rows rather than among them", () => {
    // In the flow it would grow the body, and the body's height is what the
    // arrows are placed against — every arrow on the card would move for as
    // long as the animation ran.
    expect(card).toMatch(/\.row-gone \{\s*position: relative;\s*height: 0;/);
    expect(card).toMatch(/\.row-gone > i \{\s*position: absolute/);
  });

  it("offers the same news to a reader who asked for less movement", () => {
    expect(card).toContain("prefers-reduced-motion");
    expect(row).toContain("prefers-reduced-motion");
  });
});
