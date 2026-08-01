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

describe("what a band may hide", () => {
  const importing = (kind: "context" | "add" | "del"): FileNode => ({
    id: "n:src/Dao.kt",
    path: "src/Dao.kt",
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    symbols: [],
    hunks: [
      {
        oldStart: 1,
        oldLines: 6,
        newStart: 1,
        newLines: 7,
        header: "",
        lines: [
          { kind: "context", text: "import a.b.C", oldLine: 1, newLine: 1 },
          { kind: "context", text: "import a.b.D", oldLine: 2, newLine: 2 },
          { kind: kind === "context" ? "context" : kind, text: "import a.b.E",
            ...(kind === "del" ? { oldLine: 3 } : kind === "add" ? { newLine: 3 } : { oldLine: 3, newLine: 3 }) },
          { kind: "context", text: "import a.b.F", oldLine: 4, newLine: 4 },
          { kind: "context", text: "import a.b.G", oldLine: 5, newLine: 5 },
          { kind: "context", text: "class Dao {", oldLine: 6, newLine: 6 },
          // A change right below, so the imports are inside the context radius
          // and survive as rows for the import fold to act on. Without one the
          // whole file collapses into a plain untouched band first.
          { kind: "add", text: "  val added = 1", newLine: 7 },
        ],
      },
    ],
  });

  // A wide radius so the imports survive the untouched-code collapse and reach
  // the import fold, which is what these tests are about.
  const open = { contextRadius: 99, collapseThreshold: 99 };

  it("folds a block of untouched imports", () => {
    const rows = displayRows(importing("context"), [], open);
    const band = rows.find((r) => r.kind === "gap" && r.imports);
    expect(band).toBeDefined();
    expect(band!.kind === "gap" && band!.hidden).toBe(5);
    expect(rows.some((r) => r.kind !== "gap" && r.text.includes("import"))).toBe(false);
  });

  it("never folds an import the change added", () => {
    // Folding it would hide the very thing the card exists to show.
    const rows = displayRows(importing("add"), [], open);
    const added = rows.find((r) => r.kind === "add" && r.text.includes("import"));
    expect(added).toBeDefined();
    expect(added!.text).toBe("import a.b.E");
  });

  it("never folds an import the change removed", () => {
    const rows = displayRows(importing("del"), [], open);
    expect(rows.some((r) => r.kind === "del" && r.text === "import a.b.E")).toBe(true);
  });

  it("still folds the untouched imports around a changed one", () => {
    const rows = displayRows(importing("add"), [], open);
    const bands = rows.filter((r) => r.kind === "gap" && r.imports);
    expect(bands.length).toBeGreaterThan(0);
  });
});

describe("a line an arrow points at", () => {
  /** One hunk covering 10–14, and fetched material from 13 to 17. */
  const overlapping = (): FileNode => ({
    id: "n:src/Dao.kt",
    path: "src/Dao.kt",
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    symbols: [],
    hunks: [
      {
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 5,
        header: "class Dao",
        lines: [
          { kind: "context", text: "  fun a() {", oldLine: 10, newLine: 10 },
          { kind: "add", text: "    log()", newLine: 11 },
          { kind: "context", text: "  }", oldLine: 11, newLine: 12 },
          { kind: "context", text: "", oldLine: 12, newLine: 13 },
          { kind: "context", text: "  fun b() {", oldLine: 13, newLine: 14 },
        ],
      },
    ],
  });

  const snippet = {
    side: "head" as const,
    startLine: 13,
    lines: ["", "  fun b() {", "    return 1", "  }", ""],
  };

  it("keeps the part of a snippet the hunk does not already show", () => {
    // The material a reference needs routinely starts a line or two inside the
    // hunk above it. Dropping the whole snippet for that overlap took the lines
    // past it too — including, often, the very line being pointed at.
    const rows = displayRows(overlapping(), [snippet], {
      anchors: [{ side: "head", line: 16 }],
    });
    const target = rows.find((r) => r.kind !== "gap" && r.newLine === 16);
    expect(target).toBeDefined();
    expect(target!.text).toBe("  }");
  });

  it("does not repeat the lines the hunk already showed", () => {
    const rows = displayRows(overlapping(), [snippet], {
      anchors: [{ side: "head", line: 16 }],
    });
    const fourteens = rows.filter((r) => r.kind !== "gap" && r.newLine === 14);
    expect(fourteens).toHaveLength(1);
  });

  it("survives the import fold", () => {
    // An anchored import is still an anchor: an arrow into a folded band says
    // which file and not where, which is the precision the graph exists for.
    const node: FileNode = {
      ...overlapping(),
      hunks: [
        {
          oldStart: 1,
          oldLines: 5,
          newStart: 1,
          newLines: 6,
          header: "",
          lines: [
            { kind: "context", text: "import a.b.C", oldLine: 1, newLine: 1 },
            { kind: "context", text: "import a.b.D", oldLine: 2, newLine: 2 },
            { kind: "context", text: "import a.b.E", oldLine: 3, newLine: 3 },
            { kind: "context", text: "import a.b.F", oldLine: 4, newLine: 4 },
            { kind: "add", text: "class Dao {", newLine: 5 },
          ],
        },
      ],
    };
    const rows = displayRows(node, [], {
      anchors: [{ side: "head", line: 3 }],
      contextRadius: 99,
      collapseThreshold: 99,
    });
    expect(rows.some((r) => r.kind !== "gap" && r.newLine === 3)).toBe(true);
  });
});
