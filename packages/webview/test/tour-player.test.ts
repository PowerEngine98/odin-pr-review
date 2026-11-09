import { describe, expect, it } from "vitest";

import { frameSeconds, type Topic } from "@odin/core/tour/tour.js";

import type { RowView } from "../src/app/canvas/rows.js";
import { findAnchor, linesOf } from "../src/app/tour/anchors.js";
import { arrowPath, markBox } from "../src/app/tour/drawing.js";
import {
  cameraFrom,
  endOf,
  frameAt,
  keptFrom,
  startOf,
  step,
  wordBefore,
} from "../src/app/tour/playhead.js";

/**
 * The parts of the tour player that are arithmetic: finding a frame's lines on
 * a card by what they say, the clock a topic is played against, and where the
 * marks are drawn.
 */

const rows: RowView[] = [
  { kind: "ctx", text: "class Order {", oldLine: 1, newLine: 1 },
  { kind: "del", text: "  total() { return 0; }", oldLine: 2 },
  { kind: "add", text: "  total() {", newLine: 2 },
  { kind: "add", text: "    return this.items.sum();", newLine: 3 },
  { kind: "add", text: "  }", newLine: 4 },
  {
    kind: "gap",
    hidden: 3,
    text: "3 unchanged lines",
    covers: { base: [3, 5], head: [5, 7] },
    rows: [
      { kind: "ctx", text: "  // helpers", newLine: 5 },
      { kind: "ctx", text: "  clear() {", newLine: 6 },
      { kind: "ctx", text: "    this.items = [];", newLine: 7 },
    ],
  },
  { kind: "ctx", text: "  }", oldLine: 6, newLine: 8 },
  { kind: "ctx", text: "}", oldLine: 7, newLine: 9 },
];

describe("a card's lines for one side", () => {
  it("keeps insertions on the head and removals on the base", () => {
    expect(linesOf(rows, "head").texts).not.toContain("  total() { return 0; }");
    expect(linesOf(rows, "base").texts).toContain("  total() { return 0; }");
    expect(linesOf(rows, "base").texts).not.toContain("    return this.items.sum();");
  });

  it("reads the lines a band holds, numbered on each side", () => {
    const head = linesOf(rows, "head");
    expect(head.numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const base = linesOf(rows, "base");
    expect(base.numbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("finding an anchor", () => {
  it("answers with the real line numbers, not positions in the list", () => {
    expect(findAnchor(rows, { code: "clear() {\n  this.items = [];" })).toEqual({
      side: "head",
      start: 6,
      end: 7,
    });
  });

  it("finds a line renamed since the tour was written", () => {
    const found = findAnchor(rows, { code: "return this.items.total();" });
    expect(found?.start).toBe(3);
  });

  it("looks on the base for removed code, even when the side was not said", () => {
    expect(findAnchor(rows, { code: "total() { return 0; }" })).toEqual({
      side: "base",
      start: 2,
      end: 2,
    });
  });

  it("finds nothing rather than something wrong", () => {
    expect(findAnchor(rows, { code: "fetchCustomer(id)" })).toBeNull();
  });
});

const topic: Topic = {
  id: "totals",
  title: "Order totals",
  summary: "How a total is worked out.",
  frames: [
    { kind: "go", file: "src/Order.kt", say: "The order starts it." },
    { kind: "highlight", file: "src/Order.kt", code: "total()", label: "sum" },
    { kind: "arrow", keep: true, from: { file: "a", code: "x" }, to: { file: "b", code: "y" } },
    { kind: "pause", seconds: 3, keep: true },
    { kind: "focus", file: "src/Main.kt", code: "main()" },
  ],
};

describe("the clock a topic plays against", () => {
  it("gives each frame the stretch frameSeconds says, end to end", () => {
    expect(startOf(topic, 0)).toBe(0);
    expect(startOf(topic, 1)).toBeCloseTo(frameSeconds(topic.frames[0]!));
    expect(endOf(topic, 1)).toBeCloseTo(startOf(topic, 2));
  });

  it("maps a second to the frame on screen, clamped at either end", () => {
    expect(frameAt(topic, -4)).toBe(0);
    expect(frameAt(topic, startOf(topic, 2) + 0.01)).toBe(2);
    expect(frameAt(topic, startOf(topic, 2) - 0.01)).toBe(1);
    expect(frameAt(topic, 9999)).toBe(4);
  });

  it("redraws back to the last frame that did not keep", () => {
    expect(keptFrom(topic.frames, 3)).toBe(1);
    expect(keptFrom(topic.frames, 1)).toBe(1);
    expect(keptFrom(topic.frames, 4)).toBe(4);
  });

  it("puts the camera where the last go or focus left it", () => {
    expect(cameraFrom(topic.frames, 3)).toBe(0);
    expect(cameraFrom(topic.frames, 4)).toBe(4);
  });

  it("steps across topics and stops at either end", () => {
    const second = { ...topic, id: "second" };
    expect(step([topic, second], 0, 4, 1)).toEqual({ topic: 1, frame: 0 });
    expect(step([topic, second], 1, 0, -1)).toEqual({ topic: 0, frame: 4 });
    expect(step([topic, second], 1, 4, 1)).toBeNull();
    expect(step([topic, second], 0, 0, -1)).toBeNull();
  });

  it("moves an unread subtitle along by word", () => {
    expect(wordBefore("The order starts it.", 0)).toBe(0);
    expect(wordBefore("The order starts it.", 6)).toBe(4);
    expect(wordBefore("The order starts it.", 99)).toBe(17);
  });
});

describe("where a mark is drawn", () => {
  const card = { x: 100, y: 200, width: 400, height: 300 };
  const at = (line: number) => (line === 3 ? 50 : line === 5 ? 86 : null);

  it("boxes the rows between the first line and the last", () => {
    const box = markBox(card, at, 3, 5, 18, null);
    expect(box.y).toBeLessThan(200 + 50 - 9 + 0.01);
    expect(box.y + box.height).toBeGreaterThan(200 + 86 + 9 - 0.01);
  });

  it("is the whole card when the lines could not be found", () => {
    const box = markBox(card, at, 0, 0, 18, null);
    expect(box.width).toBeGreaterThan(card.width);
    expect(box.height).toBeGreaterThan(card.height);
  });

  it("keeps to its own half of a card in two columns", () => {
    expect(markBox(card, at, 3, 3, 18, "left").x + markBox(card, at, 3, 3, 18, "left").width).toBe(300);
    expect(markBox(card, at, 3, 3, 18, "right").x).toBe(300);
  });

  it("leaves from the side facing where it goes", () => {
    const right = arrowPath(card, { x: 700, y: 200, width: 100, height: 40 });
    expect(right.d.startsWith("M 500 ")).toBe(true);
    expect(right.head.angle).toBe(0);
    const left = arrowPath(card, { x: 0, y: 200, width: 50, height: 40 });
    expect(left.d.startsWith("M 100 ")).toBe(true);
    expect(left.head.angle).toBe(Math.PI);
  });
});
