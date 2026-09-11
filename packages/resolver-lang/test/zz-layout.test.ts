import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { layoutGraph } from "@odin/core";
import type { ChangeGraph, Edge, FileNode } from "@odin/core";
import { withDatabase } from "../src/database.js";

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "odin-db-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const node = (id: string, path: string, language = "postgres"): FileNode => ({
  id, path, status: "modified", language, binary: false,
  stats: { additions: 1, deletions: 0 },
  hunks: [{ header: "", oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [
    { kind: "ctx", text: "line one", oldLine: 1, newLine: 1 },
    { kind: "add", text: "line two", newLine: 2 },
    { kind: "ctx", text: "line three", oldLine: 2, newLine: 3 },
  ] }],
  symbols: [],
});

const edge = (from: string, to: string, line: number, symbolName: string): Edge => ({
  id: `e:${from}${to}${line}`,
  from: { nodeId: from, side: "head", line: 1 },
  to: { nodeId: to, side: "head", line, symbolName },
  change: "added", kind: "type", confidence: "heuristic", resolver: "postgres",
});

const FILES = {
  "db/001_customers.sql": "CREATE TABLE customers (id uuid);\n\nCREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN END $$ LANGUAGE plpgsql;",
  "db/002_invoices.sql": "CREATE TABLE invoices (id uuid);",
  "db/003_totals.sql": "CREATE MATERIALIZED VIEW totals AS SELECT * FROM invoices;\nCREATE TRIGGER t BEFORE UPDATE ON invoices EXECUTE FUNCTION touch();",
};

describe("schema layout", () => {
  it("where does it land", () => {
    const base: ChangeGraph = {
      schemaVersion: "0.1.0",
      meta: { baseRef: "main", headRef: "feat", generator: "test" },
      nodes: [
        node("n:one", "db/001_customers.sql"),
        node("n:two", "db/002_invoices.sql"),
        node("n:three", "db/003_totals.sql"),
      ],
      edges: [edge("n:three", "n:two", 1, "invoices"), edge("n:three", "n:one", 3, "touch")],
    };
    const root = workspace(FILES);
    const g = withDatabase(base, { root });
    for (const e of g.edges) console.log("edge", e.from.nodeId, "->", e.to.nodeId, e.kind, e.to.symbolName);
    const layout = layoutGraph(g);
    for (const n of [...layout.nodes].sort((a, b) => a.rank - b.rank || a.y - b.y)) {
      console.log("rank", n.rank, "order", n.order, "x", n.x, "y", n.y, n.path);
    }
    rmSync(root, { recursive: true, force: true });
  });
});
