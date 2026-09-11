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

/**
 * The half of this that has nothing to do with SQL files.
 *
 * A migration in the diff is one way a change reaches the database. A query
 * written against the generated classes is the other, and the second is the
 * reason any of this exists: the link a reviewer cannot see is exactly the one
 * whose two ends are in different languages under different spellings. The pass
 * judged the change by its file extensions instead and turned away anything
 * with no `.sql` in it, which is most of the branches a backend produces — so
 * the schema card never appeared, the arrows from the code had nowhere to land
 * and were never drawn, and the database switch was missing from the settings
 * because there was nothing on the canvas for it to govern.
 *
 * The same mistake wearing different clothes is a migration that only creates
 * things. It names nothing, so it produced no SQL reference, so the pass gave
 * up a second time — and a new table with the code that reads it is the
 * commonest shape a database change has.
 */
describe("a change that reaches the schema without one migration naming another", () => {
  const CHECKOUT = {
    "db/001_schema.sql": "CREATE TABLE labor (id uuid);",
    // The import is what makes a capitalised word a schema object rather than
    // an ordinary class name, so the file on disk has to carry it.
    "src/Projection.kt": [
      "import com.labura.jooq.generated.Tables",
      "fun rows(labor: LaborRecord) = labor",
    ].join("\n"),
  };

  /** A Kotlin file whose one changed line names a generated class. */
  const projection = (): FileNode => ({
    id: "n:code",
    path: "src/Projection.kt",
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    hunks: [
      {
        header: "",
        oldStart: 2,
        oldLines: 0,
        newStart: 2,
        newLines: 1,
        lines: [{ kind: "add", text: "fun rows(labor: LaborRecord) = labor", newLine: 2 }],
      },
    ],
    symbols: [],
  });

  it("draws the schema for a change that only edits the queries", () => {
    const graph: ChangeGraph = { ...graphOf(), nodes: [projection()], edges: [] };
    const drawn = withDatabase(graph, { root: workspace(CHECKOUT) });
    const database = drawn.nodes.find((n) => n.kind === "database");

    // The objects are read out of the checkout, which holds the whole schema
    // whether or not this change touched any of it.
    expect(database?.hunks[0]?.lines.map((l) => l.text)).toEqual(["table labor"]);
    expect(
      drawn.edges
        .filter((e) => e.to.nodeId === database?.id)
        .map((e) => e.to.symbolName),
    ).toEqual(["labor"]);
  });

  it("draws it for a new table and the code that reads it", () => {
    const graph: ChangeGraph = {
      ...graphOf(),
      nodes: [node("n:migration", "db/001_schema.sql"), projection()],
      edges: [],
    };
    const drawn = withDatabase(graph, { root: workspace(CHECKOUT) });
    const database = drawn.nodes.find((n) => n.kind === "database")!;

    // Both ends of the story: what made the table, and what reads it.
    const reaching = drawn.edges
      .filter((e) => e.to.nodeId === database.id)
      .map((e) => e.from.nodeId);
    expect(reaching.sort()).toEqual(["n:code", "n:migration"]);
  });

  it("still leaves a change that never mentions the database alone", () => {
    // The gate is worth keeping rather than merely moving: behind it is a walk
    // of the whole checkout for SQL, and a repository with no database in it
    // should not pay for one on every rebuild.
    const plain: ChangeGraph = { ...graphOf(), nodes: [projection()], edges: [] };
    const root = workspace({ ...CHECKOUT, "src/Projection.kt": "fun rows() = 1" });
    expect(withDatabase(plain, { root })).toBe(plain);
  });
});

/**
 * Two arrows that are not the same arrow.
 *
 * A line that was changed carries its references twice: once removed from the
 * base and once added to the head, at the same line, naming the same thing.
 * The only thing telling those two apart is which side of the diff each end is
 * on — and the schema pass hashed its own summary of the ends, node and line
 * and nothing else, so both came out with one name.
 *
 * A duplicate key does not draw a wrong arrow. It throws while the page is
 * being built, and what the reader gets is a blank screen for a change that
 * resolved perfectly well.
 */
describe("naming an arrow the schema pass drew", () => {
  const sided = (side: "base" | "head", change: Edge["change"]): Edge => ({
    id: `e:seed-${side}`,
    from: { nodeId: "n:three", side, line: 1, symbolName: "invoices" },
    to: { nodeId: "n:two", side: "head", line: 1, symbolName: "invoices" },
    change,
    kind: "type",
    confidence: "heuristic",
    resolver: "postgres",
  });

  it("tells the removed reference from the added one", () => {
    const root = workspace(FILES);
    const graph: ChangeGraph = {
      ...graphOf(),
      edges: [sided("base", "removed"), sided("head", "added")],
    };

    const drawn = withDatabase(graph, { root });
    const ids = drawn.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves nothing out while doing it", () => {
    // The other way to have no duplicates is to have dropped one, which would
    // silently lose an arrow the reader is entitled to see.
    const root = workspace(FILES);
    const graph: ChangeGraph = {
      ...graphOf(),
      edges: [sided("base", "removed"), sided("head", "added")],
    };

    const drawn = withDatabase(graph, { root });
    expect(drawn.edges.filter((e) => e.change === "removed").length).toBeGreaterThan(0);
    expect(drawn.edges.filter((e) => e.change === "added").length).toBeGreaterThan(0);
  });
});
