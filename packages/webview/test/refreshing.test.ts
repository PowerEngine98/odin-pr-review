import { readFileSync } from "node:fs";
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
    // have to already be in a document that has never shown one. Named for the
    // badge in the corner, which is the only one now: the bar carried a second
    // copy of the same state, and two things saying "rebuilding" in one window
    // is one more than the reader needs.
    const html = page();
    expect(html).toContain("turn");
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

/**
 * What the composer is allowed to hand its editor.
 *
 * The preview walks the picked code and joins it, and an uncaught throw inside
 * a Svelte effect takes the component down with it — a composer that has lost
 * its own render cannot be typed in, submitted or cancelled, and the only way
 * out is reloading the window. That is what a line *range* being written into
 * the field that means the picked *code* did, under a cast that stopped the
 * compiler from mentioning it.
 */
describe("the code a suggestion starts from", () => {
  it("is only ever handed over as a list of lines", () => {
    const source = readFileSync(
      new URL("../src/app/panels/Composer.svelte", import.meta.url),
      "utf8",
    );
    // The guard, not the raw prop: `before: lines` was the crash.
    expect(source).toMatch(/before:\s*picked/);
    expect(source).toMatch(/Array\.isArray\(lines\)/);
  });

  it("is no longer given a range by the thing that opens it", () => {
    const source = readFileSync(
      new URL("../src/app/canvas/picking.svelte.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/lines:\s*\{\s*start,\s*end\s*\}/);
  });
});

/**
 * A suggestion knows what it is replacing.
 *
 * The forge draws a suggestion as a change — the lines it replaces above the
 * lines it proposes — so the composer has to be handed the picked code. It was
 * handed a line range instead, under a cast, which cost two things: the preview
 * threw on it and took the whole composer down, and no suggestion ever showed a
 * "before" because there was never any code in the field that carries it.
 */
describe("the code a suggestion replaces", () => {
  const read = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  it("is gathered from the card that holds the rows", () => {
    const card = read("../src/app/canvas/Card.svelte");
    // The card is the only thing that knows both the rows and the pick.
    expect(card).toMatch(/function picked\(/);
    expect(card).toMatch(/open\(\s*\{[^}]*\},\s*picked\(pick\)/s);
  });

  it("is carried to the composer rather than a range", () => {
    const picking = read("../src/app/canvas/picking.svelte.ts");
    expect(picking).toMatch(/export function open\([^)]*lines: string\[\]/s);
    expect(picking).not.toMatch(/lines:\s*\{\s*start,\s*end\s*\}/);
  });

  it("walks into folds, so an opened gap is part of the passage", () => {
    expect(read("../src/app/canvas/Card.svelte")).toMatch(/row\.kind === "gap"[\s\S]{0,120}walk\(row\.rows\)/);
  });
});

/**
 * What has become of the pull request, in the bar.
 *
 * A review outlives the window it was opened in: leave one open overnight and
 * somebody else merges it by morning. The bar used to be hardcoded to "Open"
 * unless the change was a draft, so a change that landed hours ago went on
 * inviting a review of finished work — and the view model never carried the
 * field that would have said otherwise, so no amount of asking the forge would
 * have helped.
 */
describe("a pull request that is over", () => {
  const bar = (state?: string) => {
    const graph: ChangeGraph = {
      schemaVersion: "0.1.0",
      meta: {
        baseRef: "main", headRef: "feat", generator: "test",
        pullRequest: {
          number: 157, title: "t", url: "https://x/157",
          ...(state ? { state } : {}),
        },
      },
      nodes: [], edges: [],
    };
    return renderHtml(graph, layoutGraph(graph), { canReview: true });
  };

  it("carries the forge's verdict into the page", () => {
    expect(bar("MERGED")).toContain('"state":"MERGED"');
  });

  it("says nothing about one the forge had no verdict on", () => {
    expect(bar()).not.toContain('"state"');
  });
});

/**
 * The surfaces are the reader's; the vocabulary is the drawing's.
 *
 * A card is a piece of a file and should look like that file does two panes
 * away. The editor publishes its own background, foreground and line-number
 * grey to a webview as variables it keeps in step with the theme, so they are
 * taken as they are — and the drawing's own colours are what a page with no
 * editor around it falls back to.
 */
describe("colouring a card the way the editor is coloured", () => {
  const page = () => {
    const graph: ChangeGraph = {
      schemaVersion: "0.1.0",
      meta: { baseRef: "main", headRef: "feat", generator: "test" },
      nodes: [], edges: [],
    };
    return renderHtml(graph, layoutGraph(graph));
  };

  it("takes the editor's surfaces, with its own as the fallback", () => {
    const html = page();
    expect(html).toContain("--vscode-editor-background");
    expect(html).toMatch(/--text: var\(--vscode-editor-foreground, var\(--vscode-foreground, #[0-9a-f]{6}\)\)/);
    expect(html).toMatch(/--gutter: var\(--vscode-editorLineNumber-foreground, #[0-9a-f]{6}\)/);
  });

  it("gives a card the file's own background, and nothing warmer", () => {
    /*
     * Not the editor's floating-panel colour, which was the first thing tried:
     * themes set it warmer or cooler than the editor on purpose, so every card
     * in the change picked up a tint that had nothing to do with the file in
     * it, and a reader looking at a hundred and thirty of them saw the tint
     * rather than the code.
     */
    const html = page();
    expect(html).toMatch(/--card-bg: var\(--vscode-editor-background, #[0-9a-f]{6}\)/);
    // The floating-panel colour is still named, but for panels — never for a
    // card, which is a piece of a file.
    expect(html).not.toMatch(/--card-bg:[^;]*editorWidget/);
  });

  it("gives a floating panel the colour the editor floats things on", () => {
    /*
     * Which is where `editorWidget.background` belongs — a find box, a hover,
     * a panel. On the cards it was a tint that had nothing to do with the file;
     * here it is the difference between a panel and the canvas behind it, and
     * without it the reviewers were the background laid over the background
     * with only a border to say they were there.
     */
    const html = page();
    expect(html).toMatch(/--panel: var\(--vscode-editorWidget-background/);
    expect(html).toMatch(/--panel-veil: color-mix\(in srgb, var\(--panel\) 92%, transparent\)/);
  });

  it("keeps the three surfaces the editor already has", () => {
    /*
     * The code, the page it sits on, and the widgets over both. The canvas was
     * briefly mixed with a little foreground to step it off the cards, and that
     * moved it the same way every theme moves its panels — so the canvas became
     * the colour of a panel and the panels disappeared into it.
     */
    const html = page();
    expect(html).toMatch(/--bg: var\(--vscode-editor-background, #[0-9a-f]{6}\)/);
    expect(html).not.toMatch(/--bg: color-mix/);
  });

  it("keeps the diff's own washes, which have to be solid", () => {
    /*
     * The editor's are translucent — a tint meant for one line at a time — and
     * a run of twenty is twenty translucent layers with a seam at every
     * boundary, which ruled a block of added code into lines like a
     * spreadsheet. Solid, mixed against this background, a run is one block.
     */
    const html = page();
    expect(html).toMatch(/--add-bg: #[0-9a-f]{6}/i);
    expect(html).toMatch(/--del-bg: #[0-9a-f]{6}/i);
    expect(html).not.toContain("--vscode-diffEditor");
  });

  it("keeps the vocabulary, which is the graph's rather than the theme's", () => {
    /*
     * The status colours and the diff's greens and reds say what happened to a
     * file and to a line. Taken from a theme they turn the whole change one
     * colour: an editor names those for small marks in a gutter, not for the
     * fill of every card on a canvas.
     */
    const html = page();
    expect(html).toMatch(/--status-added: #[0-9a-f]{6}/);
    expect(html).toMatch(/--status-modified: #[0-9a-f]{6}/);
    expect(html).not.toMatch(/--status-added: var\(--vscode/);
    expect(html).not.toMatch(/--added: var\(--vscode/);
  });
});

/**
 * The seam between the two readings of a card.
 *
 * Split, a card is two files side by side and nothing said where one ended and
 * the other began — the eye had to find the boundary from the line numbers, on
 * every row.
 */
describe("dividing the two panes of a split card", () => {
  const row = readFileSync(
    new URL("../src/app/canvas/Row.svelte", import.meta.url),
    "utf8",
  );

  it("draws a hairline down the join", () => {
    expect(row).toMatch(/\.row\.split \.side \+ \.side \{[\s\S]{0,120}?inset 1px 0 0 0/);
  });

  it("takes no width from a pane the layout already sized", () => {
    // A border would; an inset shadow does not.
    const rule = row.slice(row.indexOf(".row.split .side + .side {"));
    expect(rule.slice(0, 200)).not.toMatch(/border-left/);
  });

  it("keeps the seam that closes a run of changed lines", () => {
    /*
     * Two shadows on one element replace each other, so a row that both
     * divides its panes and closes the gap to the row above has to say both.
     */
    expect(row).toMatch(
      /\.side\.add \+ \.side\.add\) \{[\s\S]{0,200}?inset 1px[\s\S]{0,120}?var\(--add-bg\)/,
    );
  });
});
