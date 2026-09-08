import { describe, expect, it } from "vitest";

import { passageAt, spanText, standingOf, whereNow } from "../src/agents/anchor.js";

/**
 * A remark staying on the code it was written about.
 *
 * The failure this prevents is quiet and expensive. In a live reading the file
 * under a remark changes while the remark is open: the reader writes about line
 * 212, an agent takes an earlier message and inserts nine lines above it, and
 * 212 now names an import. Nothing says so. The mark sits where it was, and the
 * prompt built for the next agent says `src/a.ts:212` — so it edits whatever is
 * there now, confidently, and the reviewer finds out afterwards.
 */
const FILE = [
  "import { one } from './one';", // 1
  "", // 2
  "export function total(items) {", // 3
  "  let sum = 0;", // 4
  "  for (const item of items) {", // 5
  "    sum += item.price;", // 6
  "  }", // 7
  "  return sum;", // 8
  "}", // 9
  "", // 10
].join("\n");

describe("the code a remark was written against", () => {
  it("is the lines it covers", () => {
    expect(passageAt(FILE, { line: 4 })).toBe("  let sum = 0;");
    expect(passageAt(FILE, { line: 6, startLine: 5 })).toBe(
      "  for (const item of items) {\n    sum += item.price;",
    );
  });

  it("is nothing for a line the file does not have", () => {
    expect(passageAt(FILE, { line: 99 })).toBeUndefined();
    expect(passageAt(FILE, { line: 0 })).toBeUndefined();
  });

  it("is nothing for a blank line", () => {
    // Whitespace anchors nothing: a blank line is in every file, several times
    // over, and a remark anchored to one would move to whichever blank line the
    // search happened to reach first.
    expect(passageAt(FILE, { line: 2 })).toBeUndefined();
  });
});

describe("finding that code again", () => {
  it("follows it down the file when something is inserted above", () => {
    // The whole case. Nine lines go in at the top; every number below moves.
    const after = ["// a header", "// another", ...FILE.split("\n")].join("\n");
    expect(whereNow(after, "  let sum = 0;", 4)).toEqual({ line: 6 });
  });

  it("keeps a span a span", () => {
    const after = ["// a header", ...FILE.split("\n")].join("\n");
    expect(
      whereNow(after, "  for (const item of items) {\n    sum += item.price;", 5),
    ).toEqual({ line: 7, startLine: 6 });
  });

  it("says nothing when the passage has been rewritten", () => {
    /*
     * Which is the case that must not be guessed at. Something near enough
     * would keep more remarks anchored and would sometimes anchor one to code
     * it was never about — silently, in the one place where being silently
     * wrong means an agent editing the wrong lines.
     */
    const after = FILE.replace("  let sum = 0;", "  let total = 0;");
    expect(whereNow(after, "  let sum = 0;", 4)).toBeUndefined();
  });

  it("takes the nearest of several matches", () => {
    // Code moves short distances far more often than it is duplicated at a
    // distance, so where it used to be is the tie-breaker.
    const twice = ["  return sum;", "", ...FILE.split("\n")].join("\n");
    expect(whereNow(twice, "  return sum;", 8)).toEqual({ line: 10 });
    expect(whereNow(twice, "  return sum;", 1)).toEqual({ line: 1 });
  });
});

describe("whether a remark still stands where it says", () => {
  const span = { line: 4 };
  const passage = "  let sum = 0;";

  it("is here when nothing has moved", () => {
    expect(standingOf(FILE, passage, span)).toEqual({
      state: "here",
      span: { line: 4 },
    });
  });

  it("is moved when it is elsewhere, and says where it was", () => {
    const after = ["// a header", ...FILE.split("\n")].join("\n");
    expect(standingOf(after, passage, span)).toEqual({
      state: "moved",
      span: { line: 5 },
      from: { line: 4 },
    });
  });

  it("is gone when it is not in the file at all", () => {
    // Three answers rather than two, because "it is not where it was" and "it
    // is not anywhere" call for completely different things: one is a number to
    // correct, the other is a question only the reader can settle.
    const after = FILE.replace("  let sum = 0;", "  let total = 0;");
    expect(standingOf(after, passage, span)).toEqual({
      state: "gone",
      from: { line: 4 },
    });
  });
});

describe("how a span is written down", () => {
  it("is one number for one line and a range for several", () => {
    expect(spanText({ line: 12 })).toBe("12");
    expect(spanText({ line: 14, startLine: 12 })).toBe("12-14");
  });

  it("is one number when the range covers a single line", () => {
    // A remark on one line that happens to carry a start as well should not be
    // written `12-12` in a prompt.
    expect(spanText({ line: 12, startLine: 12 })).toBe("12");
  });
});
