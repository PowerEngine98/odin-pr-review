import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { layoutGraph, type ChangeGraph } from "@odin/core";

import { renderHtml } from "../src/html.js";

/**
 * Saying something about a file rather than about a line in it.
 *
 * Nearly everything a reviewer wants to say is about a passage, and the gutter
 * starts one — but not "this file should not exist", and not "this belongs in
 * the other package". Those were reachable only by a keyboard shortcut, which
 * is to say only by somebody who already knew it was there, so the card's own
 * title bar now carries a button for it.
 *
 * Like the button that opens a file in the editor, it is not in the document
 * the host writes: whether there is a forge to send a remark to is something
 * only the running page learns, and a document opened from disk that offered to
 * write one would be an invitation to a dead end. So what is checked here is
 * that the first paint leaves the room and the component fills it.
 */
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
 * The document carries the compiled components as a string, and that string
 * holds a template for every element any of them can draw — so searching the
 * whole page finds a button whether or not it was written into the document.
 * That is the distinction these tests are about.
 */
function body(): string {
  const html = page();
  const from = html.indexOf('<div id="app">');
  const to = html.indexOf("<script", from);
  return html.slice(from, to === -1 ? undefined : to);
}

const read = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

describe("a button that comments on the file", () => {
  it("is not in the document the host writes", () => {
    // The same rule the button that opens a file follows, and for the same
    // reason: neither has anywhere to send anything until the page has a host.
    const html = body();
    expect(html).toContain("card-controls");
    expect(html).not.toContain("remark-file");
    expect(html).not.toContain('class="jump"');
  });

  it("is drawn by the card, with a plus and a label", () => {
    const card = read("../src/app/canvas/Card.svelte");
    const at = card.indexOf('class="remark-file"');
    expect(at).toBeGreaterThan(-1);

    const button = card.slice(at, card.indexOf("</button>", at));
    expect(button).toContain('data-hint="Comment on this file"');
    expect(button).toContain('title="Comment on this file"');
    expect(button).toContain('aria-label="Comment on this file"');

    // The count beside it opens the first remark on the file and wears the same
    // bubble. Without the cross the two controls are one icon twice.
    expect(button.match(/<path/g)).toHaveLength(2);
    expect(button).toContain("M8 5.6v3.6M6.2 7.4h3.6");
  });

  it("is on the card the page draws too, gated on being able to review", () => {
    const card = read("../src/app/canvas/Card.svelte");
    const at = card.indexOf('class="remark-file"');
    expect(at).toBeGreaterThan(-1);
    expect(card.slice(0, at)).toMatch(/\{#if model\.current\.canReview\}\s*<button\s*$/);
  });

  it("opens the composer on the file it is drawn on", () => {
    const card = read("../src/app/canvas/Card.svelte");
    expect(card).toContain("composeOnFile(node.id, node.path)");
  });


  it("gives the composer somewhere to hang when there is no line", () => {
    /*
     * The fault this shipped with, and the reason the keyboard shortcut had
     * never worked either. A remark about a file carries no line — that is what
     * makes it about the file — but the composer looked one up regardless, so
     * it asked the document for `.row[data-new="undefined"]`, found nothing and
     * returned null. The state changed, no box appeared, and nothing was
     * logged.
     */
    const composer = read("../src/app/panels/Composer.svelte");
    expect(composer).toContain("where.line === undefined");
    expect(composer).toMatch(/where\.line === undefined[\s\S]{0,120}card-title/);
  });

  it("and the keyboard shortcut opens the same one", () => {
    /*
     * One function, called twice. It reads the card's own box out of the
     * document to hang the composer under the title, and a second copy of that
     * would be a second answer to where the box goes — which is the drift that
     * put the same arrow at two different shapes before.
     */
    const keys = read("../src/app/canvas/keyboard.svelte.ts");
    expect(keys).toContain('import { composeOnFile, drop } from "./picking.svelte.js"');
    expect(keys).not.toContain("function composeOnFile");

    const picking = read("../src/app/canvas/picking.svelte.ts");
    expect(picking).toContain("export function composeOnFile");
  });
});
