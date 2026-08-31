import { layoutGraph, type ChangeGraph } from "@odin/core";
import { describe, expect, it } from "vitest";

import { renderHtml, type CodeHighlighter } from "../src/html.js";

/**
 * A highlighter that colours nothing and remembers everything it was asked.
 *
 * What matters here is not the colours but the text handed over: a grammar
 * lexes exactly what it is given, so the question this answers is whether it is
 * ever given something that is not a file.
 */
function recording() {
  const asked: string[] = [];
  const highlight: CodeHighlighter = {
    supports: () => true,
    missing: [],
    tokenize(_language, code) {
      asked.push(code);
      return code.split("\n").map((text) => [{ text }]);
    },
  };
  return { highlight, asked };
}

/** A file whose change rewrites one line of JSX in place. */
function graph(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      {
        id: "n:one",
        path: "src/Panel.tsx",
        status: "modified",
        language: "typescriptreact",
        binary: false,
        stats: { additions: 2, deletions: 2 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 4,
            newStart: 1,
            newLines: 4,
            lines: [
              { kind: "ctx", text: "export const Panel = () => (", oldLine: 1, newLine: 1 },
              { kind: "del", text: "  <Legacy>", oldLine: 2 },
              { kind: "add", text: "  <Continue>", newLine: 2 },
              { kind: "ctx", text: "    <span />", oldLine: 3, newLine: 3 },
              { kind: "del", text: "  </Legacy>", oldLine: 4 },
              { kind: "add", text: "  </Continue>", newLine: 4 },
              { kind: "ctx", text: ")", oldLine: 5, newLine: 5 },
            ],
          },
        ],
      },
    ],
    edges: [],
  };
}

/**
 * What the grammar is handed, when a card carries both sides of a change.
 *
 * A diff's rows are not a file. A deleted line and the line that replaced it
 * sit one above the other, so handing the stream straight to the grammar hands
 * it a file where the same element is opened twice and closed twice — and it
 * lexes what it is given. From the first mismatch on, everything is scoped
 * against the wrong thing, which on JSX draws a perfectly good closing tag in
 * the colour of a syntax error, several lines below anything that changed.
 */
describe("colouring a card that has both sides on it", () => {
  it("never lexes a deletion and its replacement as one file", () => {
    const { highlight, asked } = recording();
    renderHtml(graph(), layoutGraph(graph()), { highlight });

    expect(asked.length).toBeGreaterThan(0);
    for (const code of asked) {
      expect(code.includes("<Legacy>") && code.includes("<Continue>")).toBe(false);
    }
  });

  it("lexes each side as the file that side is", () => {
    const { highlight, asked } = recording();
    renderHtml(graph(), layoutGraph(graph()), { highlight });

    const head = asked.find((code) => code.includes("<Continue>"));
    const base = asked.find((code) => code.includes("<Legacy>"));
    expect(head).toBe(
      "export const Panel = () => (\n  <Continue>\n    <span />\n  </Continue>\n)",
    );
    expect(base).toBe(
      "export const Panel = () => (\n  <Legacy>\n    <span />\n  </Legacy>\n)",
    );
  });

  it("colours an unchanged line once, as the file being reviewed", () => {
    // Context is in both readings and drawn once. Two answers for one row is a
    // line whose colours depend on which side happened to be painted last.
    const { highlight } = recording();
    const page = renderHtml(graph(), layoutGraph(graph()), { highlight });
    const model = JSON.parse(
      page.slice(
        page.indexOf("window.__ODIN__=") + 16,
        page.indexOf(";</script>", page.indexOf("window.__ODIN__=")),
      ),
    );
    const all: { kind: string; tokens?: unknown; rows?: unknown[] }[] = [];
    const walk = (rows: { kind: string; rows?: unknown[] }[]) => {
      for (const row of rows) {
        all.push(row);
        if (row.rows) walk(row.rows as { kind: string; rows?: unknown[] }[]);
      }
    };
    walk(model.nodes[0].rows);
    const rows = all.filter((r) => r.kind === "ctx");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.tokens).toBeDefined();
  });

  it("lexes a card with no deletions only once", () => {
    // Both sides of an added file are the same text, so the second reading is
    // the same lexing — and a change is mostly cards like this one.
    const added: ChangeGraph = {
      ...graph(),
      nodes: [
        {
          ...graph().nodes[0]!,
          status: "added",
          hunks: [
            {
              header: "",
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 2,
              lines: [
                { kind: "add", text: "export const one = 1;", newLine: 1 },
                { kind: "add", text: "export const two = 2;", newLine: 2 },
              ],
            },
          ],
        },
      ],
    };
    const { highlight, asked } = recording();
    renderHtml(added, layoutGraph(added), { highlight });
    expect(asked).toHaveLength(1);
  });
});
