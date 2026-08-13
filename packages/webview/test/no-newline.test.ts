import { describe, expect, it } from "vitest";
import { layoutGraph, type ChangeGraph, type DiffLine } from "@odin/core";

import { renderHtml } from "../src/html.js";

/** A one-file change whose last line is or is not terminated. */
function page(last: DiffLine): string {
  const graph: ChangeGraph = {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      {
        id: "n:one",
        path: "src/Media.kt",
        status: "modified",
        language: "kotlin",
        binary: false,
        stats: { additions: 2, deletions: 0 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [
              { kind: "context", text: "package a", oldLine: 1, newLine: 1 },
              last,
            ],
          },
        ],
      },
    ],
    edges: [],
  };

  return renderHtml(graph, layoutGraph(graph));
}

describe("a file that ends without a newline", () => {
  it("says so on the line git said it about", () => {
    // Git puts `\ No newline at end of file` in the patch and nothing in the
    // code shows it: the last line looks identical either way, and the
    // difference only appears when somebody appends to the file.
    const html = page({
      kind: "add",
      text: ") : StoredMediaElement",
      newLine: 2,
      noNewline: true,
    });
    // Matched loosely because the components' styles are scoped: the compiler
    // adds a hash class to every element it styles, so an exact class
    // attribute is a test of the compiler rather than of the mark.
    expect(html).toMatch(/class="[^"]*\bno-newline\b/);
    expect(html).toContain("No newline at end of file");
  });

  it("says nothing about a file that ends properly", () => {
    const html = page({ kind: "add", text: ") : StoredMediaElement", newLine: 2 });
    // The stylesheet always carries the rule; what must be absent is the mark.
    expect(html).not.toContain('class="no-newline"');
  });

  it("keeps the mark inside the row, so no card grows by a line", () => {
    // Card heights are counted in rows and every arrow below is placed from
    // that count; a mark on a row of its own would move all of them.
    const marked = page({ kind: "add", text: "x", newLine: 2, noNewline: true });
    const plain = page({ kind: "add", text: "x", newLine: 2 });
    const rows = (html: string) => (html.match(/class="row /g) ?? []).length;
    expect(rows(marked)).toBe(rows(plain));
  });
});
