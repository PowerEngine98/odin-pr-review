import { layoutGraph, type ChangeGraph, type Snippet } from "@odin/core";
import { describe, expect, it } from "vitest";

import { renderHtml } from "../src/html.js";
import { bandOpen } from "../src/app/canvas/rows.js";

/** A change to the first two lines of a file that carries on for ten more. */
function page(): string {
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
              { kind: "ctx", text: "const first = 1;", oldLine: 1, newLine: 1 },
              { kind: "add", text: "const second = 2;", newLine: 2 },
            ],
          },
        ],
      },
    ],
    edges: [],
  };

  const snippets = new Map<string, Snippet[]>([
    [
      "n:one",
      [
        {
          side: "head",
          startLine: 3,
          endLine: 12,
          hidden: true,
          lines: Array.from({ length: 10 }, (_, i) => `const below${i + 1} = ${i + 1};`),
        },
      ],
    ],
  ]);

  return renderHtml(graph, layoutGraph(graph, { snippets }), {});
}

/**
 * The markup, without the application that is pasted into it.
 *
 * The document carries the compiled components as a script, and their source
 * contains every class name a component can render — so only what the server
 * actually rendered can answer what is on the page.
 */
function drawn(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
}

/**
 * The control in a card's title bar that promises the whole file.
 *
 * It opens every band the card is holding and shows the rows behind the bar,
 * which for a long time was not the whole file: nothing had fetched the run
 * below the last hunk, so a card stopped where the change did. The lines are
 * fetched with the rest of the material behind the bands and travel in the
 * document like the rest of it, so pressing the control reveals markup that is
 * already on the page rather than asking the host for anything.
 */
describe("the control that shows the whole file", () => {
  it("writes the lines under the last hunk into the page", () => {
    const html = drawn(page());
    expect(html).toContain("const below1 = 1;");
    expect(html).toContain("const below10 = 10;");
  });

  it("says how much of the file is under the change", () => {
    expect(drawn(page())).toContain("10 unchanged lines");
  });

  it("leaves a band the reader opened open when the card folds again", () => {
    // The card's control is a toggle, and folding it back is an answer about
    // the card rather than about a run of code the reader chose to read. A
    // single flag for both shut that run, and the reader came back from a
    // glance at the whole file to a card that had closed the part they were in.
    expect(bandOpen({ opened: true, revealed: true })).toBe(true);
    expect(bandOpen({ opened: true, revealed: false })).toBe(true);
  });

  it("closes again the bands only the control had opened", () => {
    expect(bandOpen({ opened: false, revealed: true })).toBe(true);
    expect(bandOpen({ opened: false, revealed: false })).toBe(false);
  });
});
