import { describe, expect, it } from "vitest";

import type { ChangeGraph, Edge, FileNode } from "../src/model/types.js";
import { describeDelta, graphDelta, rowsOnly, unchanged } from "../src/graph/delta.js";

function node(over: Partial<FileNode> = {}): FileNode {
  return {
    id: "n:aaa",
    path: "src/a.ts",
    status: "modified",
    language: "typescript",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    hunks: [
      {
        header: "function a",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [{ kind: "add", text: "  return 1;" }],
      },
    ],
    symbols: [],
    ...over,
  } as FileNode;
}

function edge(over: Partial<Edge> = {}): Edge {
  return {
    id: "e:xxx",
    from: { nodeId: "n:aaa", line: 3, side: "head" },
    to: { nodeId: "n:bbb", line: 9, side: "head" },
    change: "added",
    kind: "call",
    confidence: "high",
    resolver: "ts",
    ...over,
  } as Edge;
}

function graph(nodes: FileNode[], edges: Edge[] = []): ChangeGraph {
  return {
    nodes,
    edges,
    meta: { baseRef: "main", headRef: "topic", generator: "test" },
  } as ChangeGraph;
}

describe("comparing two readings of the same change", () => {
  it("reports nothing when nothing moved", () => {
    // The case that matters most: a rebuild provoked by saving a file the diff
    // does not touch. Redrawing here would take the reader's place on the page
    // away from them in exchange for nothing.
    const delta = graphDelta(graph([node()]), graph([node()]));
    expect(unchanged(delta)).toBe(true);
  });

  it("does not call the first graph news", () => {
    // Otherwise opening a review would report every file in it as added, and
    // the first build would look like the largest change ever made.
    expect(unchanged(graphDelta(undefined, graph([node()])))).toBe(true);
  });

  it("notices a file that has joined the change", () => {
    const delta = graphDelta(
      graph([node()]),
      graph([node(), node({ id: "n:bbb", path: "src/b.ts" })]),
    );
    expect(delta.added).toEqual(["n:bbb"]);
    expect(delta.removed).toEqual([]);
  });

  it("notices a file that has dropped out of it", () => {
    // Reverted, or committed away — either way it is no longer on the canvas.
    const delta = graphDelta(
      graph([node(), node({ id: "n:bbb", path: "src/b.ts" })]),
      graph([node()]),
    );
    expect(delta.removed).toEqual(["n:bbb"]);
  });

  it("notices a line that was not there before", () => {
    const edited = node({
      hunks: [
        {
          header: "function a",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 3,
          lines: [
            { kind: "add", text: "  return 1;" },
            { kind: "add", text: "  // and again" },
          ],
        },
      ],
    });
    expect(graphDelta(graph([node()]), graph([edited])).changed).toEqual(["n:aaa"]);
  });

  it("ignores a resolver's own working notes", () => {
    // Symbols and resolution status can differ between two runs over identical
    // bytes. Counting them would report a change on every rebuild and make the
    // whole comparison pointless.
    const same = node({
      symbols: [{ name: "a", line: 1, kind: "function" }],
      resolution: "analysed",
    } as Partial<FileNode>);
    expect(unchanged(graphDelta(graph([node()]), graph([same])))).toBe(true);
  });

  it("notices a reference that has appeared", () => {
    const delta = graphDelta(graph([node()]), graph([node()], [edge()]));
    expect(delta.edgesAdded).toEqual(["e:xxx"]);
  });

  it("notices a reference that has gone", () => {
    const delta = graphDelta(graph([node()], [edge()]), graph([node()]));
    expect(delta.edgesRemoved).toEqual(["e:xxx"]);
  });

  it("notices a reference that has slid down the file", () => {
    // Same id — the id hashes the ends and the kind, not the lines — but it is
    // drawn somewhere new, and drawing it somewhere new is a redraw.
    const moved = edge({ from: { nodeId: "n:aaa", line: 40, side: "head" } });
    const delta = graphDelta(graph([node()], [edge()]), graph([node()], [moved]));
    expect(delta.edgesAdded).toEqual(["e:xxx"]);
    expect(delta.edgesRemoved).toEqual([]);
  });
});

describe("saying what moved", () => {
  it("counts in the plural only when it has to", () => {
    expect(
      describeDelta({
        added: ["a"],
        removed: [],
        changed: ["b", "c"],
        edgesAdded: [],
        edgesRemoved: [],
      }),
    ).toBe("1 file added, 2 files changed");
  });

  it("says the arrows moved rather than the arithmetic of it", () => {
    expect(
      describeDelta({
        added: [],
        removed: [],
        changed: [],
        edgesAdded: ["a", "b"],
        edgesRemoved: ["c"],
      }),
    ).toBe("3 references moved");
  });

  it("says nothing about nothing", () => {
    expect(
      describeDelta({
        added: [],
        removed: [],
        changed: [],
        edgesAdded: [],
        edgesRemoved: [],
      }),
    ).toBe("");
  });
});

/**
 * The shortcut, and everything it has to refuse.
 *
 * Every case below that comes back `undefined` is a case where the cheap answer
 * would be a wrong picture rather than a slow one, so the cost of getting this
 * wrong is not a slow rebuild — it is a graph that says a reference exists when
 * it does not, or is silent about one that now does.
 */
describe("deciding whether only the rows moved", () => {
  const one = (text: string, over: Partial<FileNode> = {}) =>
    graph([
      node({
        hunks: [
          {
            header: "function a",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [{ kind: "add", text, newLine: 2 }],
          },
        ],
        ...over,
      }),
    ]);

  it("has no shortcut without something to compare against", () => {
    expect(rowsOnly(undefined, one("  return 1;"))).toBeUndefined();
  });

  it("names nothing when nothing moved at all", () => {
    expect(rowsOnly(one("  return 1;"), one("  return 1;"))).toEqual([]);
  });

  it("takes it when a comment was rewritten", () => {
    // The case a reviewer hits constantly: iterating on their own new code with
    // the graph open beside it. Nothing a resolver can bind changed.
    const before = one("  const x = 1; // test x4");
    const after = one("  const x = 1; // test x5");
    expect(rowsOnly(before, after)).toEqual(["n:aaa"]);
  });

  it("takes it when only a literal changed", () => {
    expect(rowsOnly(one("  return 1;"), one("  return 2;"))).toEqual(["n:aaa"]);
  });

  it("refuses when a name on the line changed", () => {
    // The arrow leaving this line points at whatever `one` resolves to, and
    // after this edit it points at whatever `two` does — or at nothing.
    const before = one("  return one();");
    const after = one("  return two();");
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("refuses when a name was added to the line", () => {
    const before = one("  return one();");
    const after = one("  return one(extra);");
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("refuses a comment marker inside a string", () => {
    // `"http://a"` is not a comment. Cutting the line there would hide the rest
    // of it from the comparison, which is the one way this could wave an edit
    // through that matters.
    const before = one('  fetch("http://a", one);');
    const after = one('  fetch("http://a", two);');
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("refuses a language whose comments it does not know", () => {
    const before = one("  keep % note four", { language: "erlang" });
    const after = one("  keep % note five", { language: "erlang" });
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("refuses when a line was inserted", () => {
    // Every anchor below an inserted line has moved, so every arrow that lands
    // there is drawn somewhere new.
    const before = one("  return 1;");
    const after = graph([
      node({
        hunks: [
          {
            header: "function a",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 3,
            lines: [
              { kind: "add", text: "  // note", newLine: 2 },
              { kind: "add", text: "  return 1;", newLine: 3 },
            ],
          },
        ],
      }),
    ]);
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("refuses when a file joined or left the change", () => {
    const before = one("  return 1;");
    const after = graph([node(), node({ id: "n:bbb", path: "src/b.ts" })]);
    expect(rowsOnly(before, after)).toBeUndefined();
    expect(rowsOnly(after, before)).toBeUndefined();
  });

  it("refuses when a file was renamed under it", () => {
    const before = one("  return 1;");
    const after = one("  return 1;");
    after.nodes[0]!.prevPath = "src/old.ts";
    after.nodes[0]!.status = "renamed";
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("refuses when the commits underneath moved", () => {
    // A commit, a rebase or a change of base moves what the diff is measured
    // against, and with it every blob behind every gap.
    const before = one("  return 1;");
    const after = one("  return 1;");
    after.meta.headSha = "beef";
    expect(rowsOnly(before, after)).toBeUndefined();
  });

  it("does not compare the vertices a resolver invented", () => {
    // A phantom is not in a fresh diff, so counting it would make every
    // shortcut look like a file had vanished.
    const before = graph([
      ...one("  return 1;").nodes,
      node({ id: "n:ccc", path: "src/c.ts", status: "phantom", hunks: [] }),
    ]);
    expect(rowsOnly(before, one("  return 1;"))).toEqual([]);
  });
});
