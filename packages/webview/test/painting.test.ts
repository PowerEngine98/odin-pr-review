import { layoutGraph, type ChangeGraph } from "@odin/core";
import { describe, expect, it } from "vitest";

import { paintRows, renderHtml, type CodeHighlighter } from "../src/html.js";

/** A highlighter that colours nothing and remembers what it was asked. */
function recording() {
  const asked: string[] = [];
  const highlight: CodeHighlighter = {
    supports: () => true,
    missing: [],
    tokenize(_language, code) {
      asked.push(code);
      return code.split("\n").map((text) => [{ text, color: "#abcdef" }]);
    },
  };
  return { highlight, asked };
}

/** A change of `files` files, each with a line in it. */
function graph(files: number): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: Array.from({ length: files }, (_, at) => ({
      id: `n:${at}`,
      path: `src/file${at}.ts`,
      status: "modified" as const,
      language: "typescript",
      binary: false,
      stats: { additions: 1, deletions: 0 },
      symbols: [],
      hunks: [
        {
          header: "",
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ kind: "add" as const, text: `const a${at} = ${at};`, newLine: 1 }],
        },
      ],
    })),
    edges: [],
  };
}

/**
 * Colouring a change, a file at a time.
 *
 * It is two thirds of building the document and it was one synchronous stretch:
 * two and a half seconds on a change of a hundred and thirty files, during
 * which the extension host answers nobody — not the progress it is reporting,
 * not its own page, not the editor asking whether it is still alive.
 */
describe("painting a drawing before it is written out", () => {
  it("puts the colours on the rows", async () => {
    const change = graph(3);
    const layout = layoutGraph(change);
    const { highlight } = recording();

    await paintRows(layout, highlight);

    const rows = layout.nodes.flatMap((node) => node.rows);
    const code = rows.filter((row) => row.kind !== "gap");
    expect(code.length).toBeGreaterThan(0);
    for (const row of code) expect((row as { tokens?: unknown }).tokens).toBeDefined();
  });

  it("lets the editor answer between files", async () => {
    /*
     * The control kept as a test: a timer fires during the sliced pass. Without
     * the yield it fires zero times, which is what the whole exercise is about
     * — a loop that never hands back is indistinguishable from a hang.
     */
    const layout = layoutGraph(graph(40));
    const { highlight } = recording();

    let ran = 0;
    let queued: NodeJS.Immediate;
    const again = () => {
      ran += 1;
      queued = setImmediate(again);
    };
    queued = setImmediate(again);
    try {
      await paintRows(layout, highlight);
    } finally {
      clearImmediate(queued);
    }
    expect(ran).toBeGreaterThan(0);
  });

  it("says how many files are done, which is the only honest count", async () => {
    const layout = layoutGraph(graph(5));
    const { highlight } = recording();

    const seen: string[] = [];
    await paintRows(layout, highlight, (done, total) => seen.push(`${done}/${total}`));

    expect(seen).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
  });

  it("does not colour the same rows twice", async () => {
    // The document build colours what it is given; a drawing already painted
    // would be the same two seconds for the same answer.
    const change = graph(3);
    const layout = layoutGraph(change);
    const { highlight, asked } = recording();

    await paintRows(layout, highlight);
    const painting = asked.length;
    expect(painting).toBeGreaterThan(0);

    renderHtml(change, layout, { highlight });
    expect(asked.length).toBe(painting);
  });

  it("still colours a drawing nobody painted", async () => {
    // The command line renders in one go and has no reason to paint first.
    const change = graph(2);
    const { highlight, asked } = recording();

    renderHtml(change, layoutGraph(change), { highlight });
    expect(asked.length).toBeGreaterThan(0);
  });

  it("carries the colours into the document", async () => {
    const change = graph(2);
    const layout = layoutGraph(change);
    const { highlight } = recording();

    await paintRows(layout, highlight);
    expect(renderHtml(change, layout, { highlight })).toContain("#abcdef");
  });

  it("counts every file when there is nothing to colour with", async () => {
    // A page with no highlighter still finishes the phase, or the bar stops
    // short of the end and stays there.
    const layout = layoutGraph(graph(4));
    const seen: number[] = [];
    await paintRows(layout, undefined, (done) => seen.push(done));
    expect(seen).toEqual([4]);
  });
});

/**
 * The same shape in all three renderers.
 *
 * There are three: the page, the first paint the host writes into the document,
 * and the standalone SVG. An arrow that took one shape in the document and
 * another once the page booted is a picture moving for no reason anybody can
 * see — so the geometry is one function and this is what checks they all use it.
 */
describe("arrows in the document the host writes", () => {
  it("draws them as roads rather than curves", () => {
    const change = graph(3);
    change.edges = [
      {
        id: "e:1",
        kind: "call",
        change: "added",
        confidence: "resolved",
        from: { nodeId: "n:0", path: "src/file0.ts", side: "head", line: 1 },
        to: { nodeId: "n:2", path: "src/file2.ts", side: "head", line: 1 },
      },
    ];
    const html = renderHtml(change, layoutGraph(change), {});
    // The compiler scopes the class, so it is matched by its start rather than
    // whole — and both orders of the two attributes are written.
    const arrows = [
      ...html.matchAll(/class="(?:wire|hit|head)[^"]*"[^>]*?d="([^"]+)"/g),
      ...html.matchAll(/d="([^"]+)"[^>]*?class="(?:wire|hit|head)[^"]*"/g),
    ].map((found) => found[1]!);

    expect(arrows.length).toBeGreaterThan(0);
    for (const path of arrows) expect(path).not.toContain(" C ");
  });
});
