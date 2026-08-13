import { describe, expect, it } from "vitest";
import { layoutGraph, type ChangeGraph } from "@odin/core";

import { renderHtml } from "../src/html.js";
import { APP_SCRIPT } from "../src/generated/app.js";

function page(): string {
  const graph: ChangeGraph = {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      {
        id: "n:one",
        path: "src/a.ts",
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
            newLines: 1,
            lines: [{ kind: "add", text: "const a = 1;", newLine: 1 }],
          },
        ],
      },
    ],
    edges: [],
  };
  return renderHtml(graph, layoutGraph(graph));
}

/**
 * Just the markup, without the application embedded beneath it.
 *
 * The document now carries the compiled components as a string, and that
 * string contains a template for every element any of them can draw. Searching
 * the whole page for an element therefore finds it whether or not it was
 * rendered — which is exactly the distinction these tests are about.
 */
function body(): string {
  const html = page();
  const from = html.indexOf('<div id="app">');
  const to = html.indexOf("<script", from);
  return html.slice(from, to === -1 ? undefined : to);
}

describe("saying that the picture is being rebuilt", () => {
  it("is not in the page until there is something to say", () => {
    // The old renderer wrote the badge into every document and hid it. A
    // component renders it or does not, so an idle page simply has no badge —
    // which is the same thing to look at and one less thing to keep in step.
    expect(body()).not.toMatch(/<span class="[^"]*\brefreshing\b/);
  });

  it("carries the styles it will need when it appears", () => {
    // It arrives on a message rather than on a redraw, so the rules for it
    // have to already be in a document that has never shown one.
    const html = page();
    expect(html).toContain("spin-arc");
    expect(html).toContain("@keyframes");
  });

  it("spins, and stops spinning for a reader who asked it to", () => {
    const html = page();
    expect(html).toContain("prefers-reduced-motion");
  });

  it("is shown and hidden by the host, not by the page", () => {
    // The page cannot know a rebuild has started: the work happens in the
    // extension, and the only honest signal is the one it sends.
    expect(APP_SCRIPT).toContain("refreshing");
  });
});

/**
 * The same fact, said over the drawing.
 *
 * The bar's badge sits among the pull request's own facts at the top of the
 * window; a reader halfway down a seventy-file canvas is looking at a card, not
 * at the bar. This is the one that catches their eye where a stale card would
 * be noticed, so it has to be in the corner of the canvas and it has to be
 * fixed there — a badge inside the transformed canvas would shrink with the
 * zoom until the thing saying "out of date" was too small to read.
 */
describe("saying it on the canvas", () => {
  it("is not in an idle page either", () => {
    expect(body()).not.toMatch(/class="[^"]*\brebuilding\b/);
  });

  it("carries its rules, in the corner the map is not in", () => {
    const html = page();
    expect(html).toContain(".rebuilding");
    // The map has bottom left; this has bottom right. Both edges are named
    // because a fixed element given a left and a right is stretched between
    // them rather than positioned twice.
    expect(html).toMatch(/\.rebuilding[^}]*right:\s*12px/s);
    expect(html).toMatch(/\.rebuilding[^}]*left:\s*auto/s);
  });

  it("does not swallow a drag on the corner of the canvas", () => {
    // Nothing on it is pressable, and a badge that took the pointer would make
    // that corner of the drawing dead to the pan it is sitting on.
    expect(page()).toMatch(/\.rebuilding[^}]*pointer-events:\s*none/s);
  });
});

/**
 * The buttons on a card's header, when the card is wider than the window.
 *
 * A file being read is very often wider than the pane it is read in, and the
 * controls that act on it — copy the path, open it, mark it read, say something
 * about it — live at the far end of its header. They travel back along the bar
 * to stay reachable, and stop at the end of the file name: the name is the
 * answer to "which file is this" and is the one thing on a card that must stay
 * legible, so it is never shrunk to make room.
 */
describe("reaching a card's controls on a card wider than the window", () => {
  it("carries the rules for a group that has left its place", () => {
    const html = page();
    expect(html).toContain(".card-controls.slid");
    // It travels over the bar's own background rather than through the name.
    expect(html).toMatch(/\.card-controls\.slid[^}]*background-color/s);
  });

  it("refuses to let the name give ground", () => {
    // `flex: 0 0 auto` is the whole promise: the name keeps its natural width
    // whatever else is competing for the bar.
    expect(page()).toMatch(/\.title-name[^}]*flex:\s*0 0 auto/s);
  });

  it("does not borrow a class name that already places something", () => {
    // `card-name` is the label a shrunken card wears above itself, and it is
    // positioned absolutely. Reusing it lifted the file's name, its mark and
    // its counts out of the header and parked them over the card — which the
    // rule-exists tests above could not see, because both rules existed.
    const html = page();
    expect(html).toMatch(/\.card-name[^}]*position:\s*absolute/s);
    expect(html).not.toMatch(/\.title-name[^}]*position:\s*absolute/s);
  });

  it("holds the name in view from the other end", () => {
    // Pan right and the card's beginning leaves the window, taking its name,
    // its mark and its counts with it — the reader is then looking at code with
    // nothing saying whose it is. Same treatment, mirrored.
    const html = page();
    expect(html).toContain(".title-name.slid");
    expect(html).toMatch(/\.title-name\.slid[^}]*padding-right/s);
    // The buttons lean the other way, so the two read as a pair.
    expect(html).toMatch(/\.card-controls\.slid[^}]*padding-left/s);
  });

  it("sits still until there is a reason to move", () => {
    // No transform in a page nobody has panned: a card whose far end is on
    // screen looks exactly as it always did.
    expect(body()).not.toContain("card-controls slid");
    expect(body()).not.toContain("title-name slid");
  });
});
