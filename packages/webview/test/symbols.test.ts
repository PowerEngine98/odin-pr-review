import { describe, expect, it } from "vitest";

import type { EdgeView } from "../src/app/model.js";
import { boxesOn, markKey, symbolMarks } from "../src/app/canvas/symbols.js";

const edge = (given: Partial<EdgeView>): EdgeView => ({
  id: "e:1",
  from: "n:caller",
  to: "n:callee",
  fromPath: "src/caller.ts",
  toPath: "src/callee.ts",
  fromLine: 10,
  toLine: 20,
  fromSide: "head",
  toSide: "head",
  change: "added",
  kind: "call",
  confidence: "high",
  symbol: "render",
  fromSymbol: "",
  label: "",
  ...given,
});

describe("the words a card should box", () => {
  it("collects both ends of every arrow it is an end of", () => {
    const edges = [edge({})];
    expect([...symbolMarks(edges, "n:caller").keys()]).toEqual(["head:10"]);
    expect([...symbolMarks(edges, "n:callee").keys()]).toEqual(["head:20"]);
    expect(symbolMarks(edges, "n:elsewhere").size).toBe(0);
  });

  it("leaves imports alone, which name a file rather than a word in it", () => {
    expect(symbolMarks([edge({ kind: "import" })], "n:caller").size).toBe(0);
    expect(symbolMarks([edge({ symbol: "" })], "n:caller").size).toBe(0);
  });

  it("offers the calling end its own spelling as a fallback", () => {
    // Generated code says ACCOUNT for a table called account, and the box has
    // to sit on the word that is written.
    const edges = [edge({ symbol: "account", fromSymbol: "ACCOUNT" })];
    expect(symbolMarks(edges, "n:caller").get("head:10")?.[0]?.words).toEqual([
      "account",
      "ACCOUNT",
    ]);
    // The far end wrote the canonical name, so it has nothing to fall back to.
    expect(symbolMarks(edges, "n:callee").get("head:20")?.[0]?.words).toEqual([
      "account",
    ]);
  });

  it("names a line only when it has a number on that side", () => {
    expect(markKey("base", 12)).toBe("base:12");
    expect(markKey("head", undefined)).toBeNull();
  });
});

describe("placing a box on a line", () => {
  const marks = (words: string[], change = "added") => [
    { edgeId: "e:1", role: "out" as const, change, words },
  ];

  /** Where the box ends, in columns: what the reader sees as its right edge. */
  const rightOf = (box: { from: number; span: number }) => box.from + box.span;

  it("stands a quarter of a character clear on each side", () => {
    const boxes = boxesOn("  return render(x);", marks(["render"]));
    expect(boxes).toHaveLength(1);
    // "render" is at column 9 and runs to 15.
    // A box is read as surrounding a word, so the air is symmetric: one that
    // hugged the last letter while standing clear of the first looked
    // misplaced rather than generous.
    expect(boxes[0]!.from).toBeCloseTo(8.75);
    expect(rightOf(boxes[0]!)).toBeCloseTo(15.25);
  });

  it("never closes over what follows the name", () => {
    // The box running a character past the word swallowed the bracket of the
    // call it was pointing at, which reads as though the arguments were part of
    // the name.
    const line = "  const { active, goToSection } = useNavigationItem(item)";
    const box = boxesOn(line, marks(["useNavigationItem"]))[0]!;
    expect(line.indexOf("useNavigationItem")).toBe(34);
    expect(box.from).toBeCloseTo(33.75);
    // Short of the bracket: a box reaching over it would claim the call
    // rather than the name.
    expect(rightOf(box)).toBeCloseTo(51.25);
    // Which is a quarter of a character past where the identifier ends — the
    // bracket is the next thing on the line, and the box stops short of it.
    expect(line[Math.floor(rightOf(box))]).toBe("(");
  });

  it("stops at the code's edge when the word begins the line", () => {
    // There is no character of room to take, and reaching back would put the
    // box in the gutter, over a line number it is not about.
    const box = boxesOn("render(x);", marks(["render"]))[0]!;
    // Clamped: at the start of a line there is no room to give.
    expect(box.from).toBe(0);
    expect(rightOf(box)).toBeCloseTo(6.25);
  });

  it("marks a whole name rather than the start of a longer one", () => {
    // A plain search finds "render" inside "renderHtml" and boxes the first
    // half of a different name, pointing out a word that is not there.
    expect(boxesOn("export function renderHtml() {}", marks(["render"]))).toEqual([]);
    const box = boxesOn("export function renderHtml() {}", marks(["renderHtml"]))[0]!;
    expect(box.from).toBeCloseTo(15.75);
    expect(rightOf(box)).toBeCloseTo(26.25);
  });

  it("counts a dot or a bracket as the end of a name", () => {
    const box = boxesOn("  obj.render(x)", marks(["render"]))[0]!;
    expect(box.from).toBeCloseTo(5.75);
    expect(rightOf(box)).toBeCloseTo(12.25);
  });

  it("falls back to the spelling that is actually written", () => {
    const box = boxesOn("  ACCOUNT.select()", marks(["account", "ACCOUNT"]))[0]!;
    expect(box.word).toBe("ACCOUNT");
  });

  it("says nothing when neither spelling is on the line", () => {
    expect(boxesOn("  something else", marks(["render"]))).toEqual([]);
    expect(boxesOn("render(x)", undefined)).toEqual([]);
  });

  it("draws one box per name however many arrows share it", () => {
    // A definition is landed on by every file that calls it, and a translucent
    // box drawn ten times over is an opaque one.
    const many = [
      { edgeId: "e:1", role: "in" as const, change: "added", words: ["render"] },
      { edgeId: "e:2", role: "in" as const, change: "added", words: ["render"] },
      { edgeId: "e:3", role: "in" as const, change: "added", words: ["render"] },
    ];
    expect(boxesOn("export function render() {", many)).toHaveLength(1);
  });

  it("keeps the two ends apart, since they are different journeys", () => {
    const both = [
      { edgeId: "e:1", role: "in" as const, change: "added", words: ["render"] },
      { edgeId: "e:2", role: "out" as const, change: "removed", words: ["render"] },
    ];
    expect(boxesOn("render()", both).map((b) => b.role)).toEqual(["in", "out"]);
  });

  it("takes its colour from the reference, not from the line", () => {
    // A line nobody touched can still be where an added call now lands.
    expect(boxesOn("render()", marks(["render"], "removed"))[0]!.change).toBe("removed");
  });
});
