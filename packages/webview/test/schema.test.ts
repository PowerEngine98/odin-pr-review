import { describe, expect, it } from "vitest";
import { layoutGraph, type ChangeGraph, type FileNode } from "@odin/core";

import { renderHtml } from "../src/html.js";

/**
 * The database card, and the switch that governs it.
 *
 * A schema is not a file anybody wrote, and everything the page does about that
 * hangs off one word travelling from the graph into the model: the card wears a
 * database beside it, the arrows into it are read as structural rather than as
 * references that did not change, and the settings panel offers the Database
 * switch only when there is a schema on the canvas to switch. Drop the word on
 * the way out and none of that is a visible fault — the schema draws as an
 * ordinary untouched file, and the reader is left with a switch that is not
 * there for a card they cannot explain.
 */

/** A one-table schema, as the database pass builds one. */
function schema(): FileNode {
  return {
    id: "n:db",
    path: "database/public",
    status: "phantom",
    language: "sql",
    binary: false,
    stats: { additions: 0, deletions: 0 },
    resolution: "untouched",
    kind: "database",
    symbols: [],
    hunks: [
      {
        header: "public",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [{ kind: "ctx", text: "table labor", oldLine: 1, newLine: 1 }],
      },
    ],
  };
}

/** The migration that made it, pointing at the row it made. */
function change(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      {
        id: "n:one",
        path: "db/001_labor.sql",
        status: "added",
        language: "postgres",
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
            lines: [
              { kind: "add", text: "CREATE TABLE labor (id uuid);", newLine: 1 },
            ],
          },
        ],
      },
      schema(),
    ],
    edges: [
      {
        id: "e:one",
        from: { nodeId: "n:one", side: "head", line: 1 },
        to: { nodeId: "n:db", side: "head", line: 1, symbolName: "labor" },
        change: "unchanged",
        kind: "type",
        confidence: "heuristic",
        resolver: "sql",
      },
    ],
  };
}

describe("a schema on the page", () => {
  it("says the vertex is a database, which is what offers the switch", () => {
    const graph = change();
    const html = renderHtml(graph, layoutGraph(graph));
    // The panel is built in the page rather than in the markup, and what it
    // asks is whether any vertex in the model calls itself a database.
    expect(html).toContain('"kind":"database"');
  });

  it("wears the mark that says its rows are tables", () => {
    const graph = change();
    const html = renderHtml(graph, layoutGraph(graph));
    // Loosely matched: the components' styles are scoped, so the compiler adds
    // a hash class to every element it draws.
    expect(html).toMatch(/class="[^"]*\bschema-mark\b/);
  });

  it("keeps the word off every other card", () => {
    // A file is a file. If `kind` were written unconditionally the page would
    // be told that every card is one thing or another, and the schema would
    // stop being the exception it is drawn as.
    const graph = change();
    const html = renderHtml(graph, layoutGraph(graph));
    expect((html.match(/"kind":"database"/g) ?? []).length).toBe(1);
  });
});
