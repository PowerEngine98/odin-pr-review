import { describe, expect, it } from "vitest";
import { layoutGraph, type ChangeGraph } from "@odin/core";

import { renderHtml } from "../src/html.js";

/**
 * A two-file change, optionally with a reference from one to the other.
 *
 * Rendered through the same path a webview is: the components compiled for the
 * server, with no document anywhere. What comes back is the markup a reader
 * sees before any script has run, which is the one place these invariants can
 * be checked without a browser.
 */
function page(withEdge: boolean, canReview = false): string {
  const graph: ChangeGraph = {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      {
        id: "n:one",
        path: "src/one.ts",
        status: "modified",
        language: "typescript",
        binary: false,
        stats: { additions: 1, deletions: 0 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [
              { kind: "context", text: "import { render } from './two';", oldLine: 1, newLine: 1 },
              { kind: "add", text: "  return render(x);", newLine: 2 },
            ],
          },
        ],
      },
      {
        id: "n:two",
        path: "src/two.ts",
        status: "modified",
        language: "typescript",
        binary: false,
        stats: { additions: 1, deletions: 0 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [
              { kind: "context", text: "// two", oldLine: 1, newLine: 1 },
              { kind: "add", text: "export function render() {}", newLine: 2 },
            ],
          },
        ],
      },
    ],
    edges: withEdge
      ? [
          {
            id: "e:1",
            from: { nodeId: "n:one", side: "head", line: 2, symbolName: "render" },
            to: { nodeId: "n:two", side: "head", line: 2, symbolName: "render" },
            change: "added",
            kind: "call",
            confidence: "high",
            resolver: "typescript",
          },
        ]
      : [],
  };

  return renderHtml(graph, layoutGraph(graph), canReview ? { canReview: true } : {});
}

/**
 * The markup, without the application that is pasted into it.
 *
 * The document carries the compiled components as a script, and their source
 * contains every class name and attribute they can render — so a search of the
 * whole page finds "symbol-box" whether or not one was drawn. Only what the
 * server actually rendered can answer that.
 */
function drawn(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
}

const rows = (html: string) => (html.match(/class="row /g) ?? []).length;

describe("the box round a referenced word", () => {
  it("is drawn on the line the arrow lands on", () => {
    const html = drawn(page(true));
    // Matched loosely because the components' styles are scoped: the compiler
    // adds a hash class to every element it styles.
    expect(html).toMatch(/class="[^"]*\bsymbol-box\b/);
    expect(html).toMatch(/data-change="added"/);
  });

  it("says nothing about a change with nothing pointing anywhere", () => {
    expect(drawn(page(false))).not.toMatch(/class="[^"]*\bsymbol-box\b/);
  });

  it("costs the card no rows, so no arrow below it moves", () => {
    // Card heights are counted in rows and every arrow below is placed from
    // that count. The box is an outline over glyphs that are already there.
    expect(rows(drawn(page(true)))).toBe(rows(drawn(page(false))));
  });
});

describe("the affordance for leaving a comment", () => {
  it("is not in the markup until a browser has hovered a gutter", () => {
    // Nothing under the server rendering may touch a pointer, and a button
    // baked into every row would be tens of thousands of them besides.
    expect(drawn(page(true))).not.toMatch(/class="[^"]*\bpick-hint\b/);
  });

  it("offers no rail on a page with no forge to send a review to", () => {
    // A page written from a working tree has nowhere to post a remark, and an
    // offer to write one there is an invitation to a dead end.
    expect(drawn(page(true))).not.toMatch(/data-gutter=/);
  });

  /**
   * The outermost column belongs to the arrows.
   *
   * A reference lands as a circle on the edge of the card, which is drawn over
   * the sign column. While that column also armed the comment rail it took
   * every press meant for the circle, so following a reference back was
   * impossible on any line the change had touched — and every line worth an
   * arrow is one the change touched.
   */
  it("does not begin a remark from the column an arrow lands on", () => {
    const row = firstRow(drawn(page(true, true)));
    const marker = row.slice(row.search(/class="[^"]*\bmarker\b/));
    const sign = marker.slice(0, marker.indexOf(">"));
    expect(sign).not.toMatch(/data-rail=/);
  });

  it("still begins one from the number and the strip beside it", () => {
    // Removing the sign from the rail must not remove the offer itself: the
    // reader reaches for the number, and the strip is the column kept clear for
    // exactly this.
    const row = firstRow(drawn(page(true, true)));
    expect(row).toMatch(/class="[^"]*\bnum\b[^>]*"[^>]*data-rail=/);
  });
});

/** The markup of the first row of the first card, and nothing around it. */
function firstRow(html: string): string {
  const body = html.slice(html.search(/class="[^"]*\bcard-body\b/));
  return body.split(/class="[^"]*\brow\b/)[1] ?? "";
}

describe("the column a row keeps for its picking marks", () => {
  it("sits between the line number and the code", () => {
    // Over the code it covered the first characters of every line in a chosen
    // range and ran the rail down through the text of all of them; over the
    // numbers it covered the digits the reader is reading while they decide how
    // far the range should reach. So it is beside both and on top of neither.
    const row = firstRow(drawn(page(true)));
    const num = row.search(/class="[^"]*\bnum\b/);
    const strip = row.search(/class="[^"]*\bpick-column\b/);
    const text = row.search(/class="[^"]*\btext\b/);

    expect(num).toBeGreaterThanOrEqual(0);
    expect(strip).toBeGreaterThan(num);
    expect(text).toBeGreaterThan(strip);
  });

  it("is there on a page where no remark can be started at all", () => {
    // The engine sized every card with this column in it, so it is not the
    // affordance's to bring and take away: without a forge there is nothing to
    // draw in it, and the code still has to begin where the card was measured
    // for. The same holds row by row — a line outside the patch cannot be
    // commented on, and the code beside it must not step sideways to say so.
    const html = drawn(page(true));
    expect(html).not.toMatch(/data-gutter=/);
    expect(html).toMatch(/class="[^"]*\bpick-column\b/);
  });
});
