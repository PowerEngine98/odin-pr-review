import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { ChangeGraph, Edge, FileNode } from "@odin/core";

import { withDatabase } from "../src/database.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "odin-db-"));
  dirs.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const node = (id: string, path: string, language = "postgres"): FileNode => ({
  id,
  path,
  status: "modified",
  language,
  binary: false,
  stats: { additions: 1, deletions: 0 },
  hunks: [],
  symbols: [],
});

const edge = (
  from: string,
  to: string,
  line: number,
  symbolName: string,
): Edge => ({
  id: `e:${from}${to}${line}`,
  from: { nodeId: from, side: "head", line: 1 },
  to: { nodeId: to, side: "head", line, symbolName },
  change: "added",
  kind: "type",
  confidence: "heuristic",
  resolver: "postgres",
});

const FILES = {
  "db/001_customers.sql": [
    "CREATE TABLE customers (id uuid);",
    "",
    "CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN END $$ LANGUAGE plpgsql;",
  ].join("\n"),
  "db/002_invoices.sql": "CREATE TABLE invoices (id uuid);",
  "db/003_totals.sql": [
    "CREATE MATERIALIZED VIEW totals AS SELECT * FROM invoices;",
    "CREATE TRIGGER t BEFORE UPDATE ON invoices EXECUTE FUNCTION touch();",
  ].join("\n"),
};

function graphOf(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "main", headRef: "feat", generator: "test" },
    nodes: [
      node("n:one", "db/001_customers.sql"),
      node("n:two", "db/002_invoices.sql"),
      node("n:three", "db/003_totals.sql"),
    ],
    edges: [
      edge("n:three", "n:two", 1, "invoices"),
      edge("n:three", "n:one", 3, "touch"),
    ],
  };
}

describe("drawing the schema as a vertex of its own", () => {
  it("gives the schema a card, with a row per object", () => {
    const graph = withDatabase(graphOf(), { root: workspace(FILES) });
    const database = graph.nodes.find((n) => n.kind === "database");

    expect(database?.path).toBe("database/public");
    expect(database?.hunks[0]?.lines.map((l) => l.text)).toEqual([
      "function touch",
      "table invoices",
    ]);
  });

  it("lands each reference on the row it names", () => {
    const graph = withDatabase(graphOf(), { root: workspace(FILES) });
    const database = graph.nodes.find((n) => n.kind === "database")!;

    const rows = graph.edges
      .filter((e) => e.from.nodeId === "n:three" && e.to.nodeId === database.id)
      .map((e) => e.to.symbolName);
    expect(rows.sort()).toEqual(["invoices", "touch"]);
  });

  it("points each object at whatever created it", () => {
    const graph = withDatabase(graphOf(), { root: workspace(FILES) });
    const database = graph.nodes.find((n) => n.kind === "database")!;

    const made = graph.edges
      .filter((e) => e.to.nodeId === database.id && e.from.nodeId !== "n:three")
      .map((e) => `${e.from.nodeId} ${e.to.symbolName}`);
    expect(made.sort()).toEqual(["n:one touch", "n:two invoices"]);
  });

  it("takes the file-to-file arrows away, since the object now stands between", () => {
    const graph = withDatabase(graphOf(), { root: workspace(FILES) });
    expect(graph.edges.some((e) => e.to.nodeId === "n:two")).toBe(false);
  });

  it("leaves a change with no SQL in it exactly as it was", () => {
    const plain: ChangeGraph = {
      ...graphOf(),
      nodes: [node("n:a", "src/a.ts", "typescript")],
      edges: [],
    };
    expect(withDatabase(plain, { root: workspace(FILES) })).toBe(plain);
  });

  it("says nothing when the SQL references nothing", () => {
    const alone: ChangeGraph = { ...graphOf(), edges: [] };
    const graph = withDatabase(alone, { root: workspace(FILES) });
    expect(graph.nodes.some((n) => n.kind === "database")).toBe(false);
  });
});
