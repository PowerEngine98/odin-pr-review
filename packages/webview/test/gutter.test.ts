import { describe, expect, it } from "vitest";
import { DARK_THEME, layoutGraph, toSvg, type ChangeGraph } from "@odin/core";

import { renderHtml } from "../src/html.js";
import { drawingOf } from "../src/app/svg/scene.js";

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
  it("sits between the sign and the line number", () => {
    // Over the code it covered the first characters of every line in a chosen
    // range and ran the rail down through the text of all of them; over the
    // numbers it covered the digits the reader is reading while they decide how
    // far the range should reach. So it is beside both and on top of neither —
    // and on the sign's side of the numbers rather than the code's, so the
    // offer is a couple of pixels from the mark that says the line changed
    // instead of a whole gutter away from it.
    const row = firstRow(drawn(page(true)));
    const marker = row.search(/class="[^"]*\bmarker\b/);
    const strip = row.search(/class="[^"]*\bpick-column\b/);
    const num = row.search(/class="[^"]*\bnum\b/);
    const text = row.search(/class="[^"]*\btext\b/);

    expect(marker).toBeGreaterThanOrEqual(0);
    expect(strip).toBeGreaterThan(marker);
    expect(num).toBeGreaterThan(strip);
    expect(text).toBeGreaterThan(num);
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


/**
 * A file whose lines step in and out, most of them inserted.
 *
 * The card this was read off was a run of additions, so every base gutter on it
 * was blank: the offer to begin a remark stood on the far side of that empty
 * column, a gutter's width from the sign and a couple of pixels from the first
 * character of the code, and was read as a mark on the line's own indentation.
 * Lines at four different depths are the shortest way to say that where the
 * offer sits is not a fact about the code.
 */
function stepped(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      {
        id: "n:deep",
        path: "src/deep.ts",
        status: "modified",
        language: "typescript",
        binary: false,
        stats: { additions: 3, deletions: 1 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 4,
            lines: [
              { kind: "context", text: "const x = 1;", oldLine: 1, newLine: 1 },
              { kind: "del", text: "      shallow();", oldLine: 2 },
              { kind: "add", text: "            deeper();", newLine: 2 },
              { kind: "add", text: "                        deepest();", newLine: 3 },
              { kind: "add", text: "done();", newLine: 4 },
            ],
          },
        ],
      },
    ],
    edges: [],
  };
}

/**
 * That change read as one column of code, as the server writes it.
 *
 * A page carries whichever reading it was laid out as; the other is built in
 * the browser when the reader switches. So a unified row can only be looked at
 * here by asking for a unified arrangement in the first place.
 */
function unifiedPage(): string {
  const graph = stepped();
  return drawn(
    renderHtml(graph, layoutGraph(graph, { unified: true }), { canReview: true }),
  );
}

/** The rows of the first card, each from its class list to the next. */
function cardRows(html: string): string[] {
  const body = html.slice(html.search(/class="[^"]*\bcard-body\b/));
  return body.split(/class="[^"]*\brow\b/).slice(1);
}

/** The columns a row is written out of, named in the order they appear. */
function columnsOf(row: string): string[] {
  return [...row.matchAll(/class="(marker|pick-column|num|text)\b/g)].map(
    (found) => found[1]!,
  );
}

/** How far into the row its first character of code sits. */
function depthOf(row: string): number {
  const clean = row.replace(/<!--[\s\S]*?-->/g, "");
  const text = clean.slice(clean.search(/class="text\b/));
  return /^ */.exec(text.slice(text.indexOf(">") + 1))![0].length;
}

/**
 * Where the offer to begin a remark stands on a row.
 *
 * It is a control on the row, not a mark on the line, and the reader has to
 * find it in the same place on every one of them. The failure this is about was
 * the opposite: on a card of inserted lines it sat beyond an empty gutter with
 * nothing between it and the first character of the code, which was read as
 * something the indentation had put there.
 */
describe("where a row offers to begin a remark", () => {
  it("is the column after the sign, however deep the line is indented", () => {
    const rows = cardRows(unifiedPage()).filter((row) => /^ flat\b/.test(row));

    // The fixture is only worth anything if its lines really do differ.
    expect(rows.length).toBeGreaterThan(3);
    expect(new Set(rows.map(depthOf)).size).toBeGreaterThan(2);

    for (const row of rows) {
      expect(columnsOf(row)).toEqual(["marker", "pick-column", "num", "text", "num"]);
    }
  });

  it("is armed by a gutter that has no number of its own", () => {
    // An inserted line has no place in the base, so the column of numbers to
    // the left of it is empty — and those are exactly the rows a review is
    // about. A gutter that stood for nothing meant hovering the numbers beside
    // an insertion offered nothing at all, and the reader had to find the
    // twenty pixels beside them before anything appeared. It answers for the
    // side the row does have instead, which is what the strip already did.
    const rows = cardRows(unifiedPage()).filter((row) => /^ flat add\b/.test(row));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const gutter = row.slice(row.search(/class="num old\b/));
      const span = gutter.slice(0, gutter.indexOf(">"));
      expect(span).toMatch(/data-rail="right"/);
      expect(span).toMatch(/data-gutter="head"/);
    }
  });
});

/**
 * One card, drawn three times over.
 *
 * The page the extension opens, the drawing it pins onto its own canvas and the
 * file an export writes are three renderings of the same measurements, and a
 * reader moves between them expecting to recognise what they are looking at. So
 * they have to agree about where a row's columns are — and they did not: the
 * two static renderings began their code where the gutter ends, a picking
 * column short of where the engine had measured the card and where the page
 * draws it, while cutting their lines as though the column were there and
 * leaving the difference as a blank strip at the end of every pane.
 */
describe("where the three renderings begin a row's code", () => {
  it("is one offset, in the page, in the drawing and in the exported file", () => {
    const graph = stepped();
    const layout = layoutGraph(graph);
    const { padding, gutterWidth, pickColumn } = layout.metrics;
    const expected = padding + gutterWidth + pickColumn;

    const html = renderHtml(graph, layout, { canReview: true });
    const at = html.indexOf("window.__ODIN__=");
    const model = JSON.parse(html.slice(at + 16, html.indexOf(";</script>", at)));
    expect(model.textLeft).toBe(expected);

    expect(drawingOf(layout, { theme: DARK_THEME, css: "" }).model.textLeft).toBe(
      expected,
    );

    const node = layout.nodes[0]!;
    const starts = [
      ...toSvg(layout).matchAll(/<text x="([-\d.]+)"[^>]*xml:space="preserve"/g),
    ]
      .map((found) => Number(found[1]))
      .filter((x) => x >= node.x && x < node.x + node.width);
    expect(starts.length).toBeGreaterThan(0);
    expect(Math.min(...starts) - node.x).toBe(expected);
  });
});
