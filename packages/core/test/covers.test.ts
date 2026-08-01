import { describe, expect, it } from "vitest";

import { displayRows } from "../src/layout/display.js";

import type { FileNode } from "../src/model/types.js";

/** A file whose diff shows two hunks with a long gap between them. */
function node(): FileNode {
  return {
    id: "n:src/Dao.kt",
    path: "src/Dao.kt",
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 2, deletions: 0 },
    symbols: [],
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        header: "",
        lines: [
          { kind: "context", text: "package a", oldLine: 1, newLine: 1 },
          { kind: "add", text: "import b", newLine: 2 },
          { kind: "context", text: "class Dao {", oldLine: 2, newLine: 3 },
        ],
      },
      {
        oldStart: 30,
        oldLines: 2,
        newStart: 31,
        newLines: 3,
        header: "class Dao",
        lines: [
          { kind: "context", text: "  fun save() {", oldLine: 30, newLine: 31 },
          { kind: "add", text: "    log()", newLine: 32 },
          { kind: "context", text: "  }", oldLine: 31, newLine: 33 },
        ],
      },
    ],
  };
}

describe("what a band stands in for", () => {
  it("records the lines between two hunks", () => {
    // Nobody ever read these lines — the diff skipped them — so nothing in the
    // document can be measured to work out what the band covers. It has to be
    // written down here or an arrow aimed into it has nowhere to land.
    const rows = displayRows(node());
    const bands = rows.filter((r) => r.kind === "gap");
    const between = bands.find((b) => b.kind === "gap" && b.covers?.head?.[0] === 4);

    expect(between).toBeDefined();
    expect(between!.kind === "gap" && between!.covers?.head).toEqual([4, 30]);
    expect(between!.kind === "gap" && between!.covers?.base).toEqual([3, 29]);
  });

  it("covers a run it actually holds the lines for", () => {
    const rows = displayRows(node(), [
      { side: "head", startLine: 4, lines: ["  val a = 1", "  val b = 2"] },
    ]);
    const bands = rows.filter(
      (r): r is Extract<typeof r, { kind: "gap" }> => r.kind === "gap",
    );
    // Whatever the collapse decides to fold, every band says what it hides.
    for (const band of bands) {
      expect(band.covers?.head ?? band.covers?.base).toBeDefined();
    }
  });

  it("gives both sides a range, since an arrow may aim at either", () => {
    const rows = displayRows(node());
    const band = rows.find((r) => r.kind === "gap" && r.covers?.head?.[1] === 30);
    expect(band && band.kind === "gap" && band.covers?.base).toBeDefined();
    expect(band && band.kind === "gap" && band.covers?.head).toBeDefined();
  });
});
