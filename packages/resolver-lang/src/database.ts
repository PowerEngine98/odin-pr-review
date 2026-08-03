import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChangeGraph, Edge, FileNode, Hunk } from "@odin/core";

import { buildIndex } from "./index-build.js";
import { jooqReferences, type JooqReference } from "./jooq.js";
import { POSTGRES } from "./sql.js";
import type { Declaration } from "./types.js";

export interface DatabaseOptions {
  /** Where the head of the change is checked out. */
  root: string;
}

/**
 * The schema, drawn as a vertex of its own.
 *
 * A migration set is a graph of files, and read that way it answers the wrong
 * question. Nobody asks which migration mentions which other migration; they
 * ask what this change does to the `invoices` table, and what else touches it.
 * The table is the thing, and until now it was only ever implied — a name on a
 * line in one file and a name on a line in another.
 *
 * So the objects are lifted out and given a vertex: one card per schema, a row
 * per table, view, function, sequence or type, and every reference from the
 * change lands on the row it names rather than on the file that happens to
 * declare it. What creates each object still points at it, so the migration
 * that made a table is one arrow from the table, in the direction a reader asks
 * the question.
 *
 * Files that are not SQL are untouched: an application that talks to the
 * database through a driver says so in its own language, which is a different
 * problem and not one this pass pretends to solve.
 */
export function withDatabase(
  graph: ChangeGraph,
  options: DatabaseOptions,
): ChangeGraph {
  const sql = new Set(
    graph.nodes
      .filter((n) => n.language === "sql" || n.language === "postgres")
      .map((n) => n.id),
  );
  if (sql.size === 0) return graph;

  // Read once per file and kept, since a file is asked about as many times as
  // it has lines that name something.
  const texts = new Map<string, string | undefined>();
  const read = (path: string): string | undefined => {
    if (texts.has(path)) return texts.get(path);
    let text: string | undefined;
    try {
      text = readFileSync(join(options.root, path), "utf8");
    } catch {
      text = undefined;
    }
    texts.set(path, text);
    return text;
  };

  // Only the edges SQL produced: an arrow between two TypeScript files that
  // happens to end in a `.sql` name is not a schema reference.
  const schemaEdges = graph.edges.filter(
    (e) =>
      (e.resolver === "sql" || e.resolver === "postgres") &&
      sql.has(e.to.nodeId) &&
      e.to.symbolName,
  );
  if (schemaEdges.length === 0) return graph;

  const index = buildIndex(options.root, POSTGRES);
  const byPath = new Map(graph.nodes.map((n) => [n.path, n]));

  // Code that reaches the same tables through generated classes. jOOQ names an
  // object the way the database names it with the case changed, so the link is
  // read rather than guessed — and it is the link a reviewer cannot see, since
  // the two ends are in different languages under different spellings.
  const generated: JooqReference[] = jooqReferences(graph.nodes, index, read);

  // Which object each edge actually landed on, taken from the declaration the
  // resolver chose rather than guessed at again here.
  const wanted = new Map<string, Declaration>();
  for (const edge of schemaEdges) {
    const target = graph.nodes.find((n) => n.id === edge.to.nodeId);
    if (!target) continue;
    const found = (index.byName.get(edge.to.symbolName!) ?? []).find(
      (d) => d.path === target.path && d.line === edge.to.line,
    );
    if (found) wanted.set(`${found.scope}.${found.kind}.${found.name}`, found);
  }
  for (const reference of generated) {
    wanted.set(key(reference.object), reference.object);
  }
  // A schema names the card; it is not one of the things on it.
  for (const [id, object] of [...wanted]) {
    if (object.kind === "schema") wanted.delete(id);
  }
  if (wanted.size === 0) return graph;

  // One card per schema, since that is the boundary a database itself draws.
  const schemas = new Map<string, Declaration[]>();
  for (const object of wanted.values()) {
    const held = schemas.get(object.scope);
    if (held) held.push(object);
    else schemas.set(object.scope, [object]);
  }

  const nodes: FileNode[] = [...graph.nodes];
  const edges: Edge[] = graph.edges.filter((e) => !schemaEdges.includes(e));
  // Rows are placed in the order they are drawn, so the same schema always
  // comes out the same way whatever order the change was read in.
  const placement = new Map<string, { node: FileNode; line: number }>();

  for (const [schema, objects] of [...schemas].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...objects].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    );
    const node = schemaNode(schema, ordered);
    nodes.push(node);
    ordered.forEach((object, i) => {
      placement.set(key(object), { node, line: i + 1 });
    });

    // What made each object points at it. A reader looking at a table asks
    // where it came from, and the answer should be one arrow away.
    for (const object of ordered) {
      const source = byPath.get(object.path);
      if (!source) continue;
      edges.push(
        link(
          { nodeId: source.id, side: "head", line: object.line, column: object.column },
          {
            nodeId: node.id,
            side: "head",
            line: placement.get(key(object))!.line,
            symbolName: object.name,
          },
          "unchanged",
          "type",
        ),
      );
    }
  }

  // And every reference lands on the row it names.
  for (const edge of schemaEdges) {
    const target = graph.nodes.find((n) => n.id === edge.to.nodeId);
    const object = target
      ? (index.byName.get(edge.to.symbolName!) ?? []).find(
          (d) => d.path === target.path && d.line === edge.to.line,
        )
      : undefined;
    const seat = object ? placement.get(key(object)) : undefined;
    if (!seat) {
      // Nothing to point at: keep the arrow it had rather than dropping it.
      edges.push(edge);
      continue;
    }
    edges.push(
      link(
        edge.from,
        {
          nodeId: seat.node.id,
          side: "head",
          line: seat.line,
          symbolName: edge.to.symbolName!,
        },
        edge.change,
        edge.kind,
        edge.label,
      ),
    );
  }

  // And the code that names the same objects through generated classes.
  for (const reference of generated) {
    const seat = placement.get(key(reference.object));
    if (!seat || reference.node.id === seat.node.id) continue;
    edges.push(
      link(
        {
          nodeId: reference.node.id,
          side: reference.side,
          line: reference.line,
          symbolName: reference.written,
        },
        {
          nodeId: seat.node.id,
          side: "head",
          line: seat.line,
          symbolName: reference.object.name,
        },
        reference.side === "base" ? "removed" : "added",
        reference.kind,
        reference.label,
        "jooq",
      ),
    );
  }

  return { ...graph, nodes, edges };
}

function key(object: Declaration): string {
  return `${object.scope}.${object.kind}.${object.name}`;
}

/**
 * A schema as a card.
 *
 * Built as a file would be built, because everything downstream — the layout,
 * the renderer, the list — measures rows and knows nothing else. The rows are
 * the objects, one per line, spelled the way the database spells them.
 */
function schemaNode(schema: string, objects: Declaration[]): FileNode {
  const path = `database/${schema}`;
  const lines = objects.map((object, i) => ({
    kind: "ctx" as const,
    text: `${object.kind} ${object.name}`,
    oldLine: i + 1,
    newLine: i + 1,
  }));

  const hunk: Hunk = {
    header: schema,
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    lines,
  };

  return {
    id: `n:${createHash("sha1").update(path).digest("hex").slice(0, 12)}`,
    path,
    status: "phantom",
    language: "sql",
    binary: false,
    stats: { additions: 0, deletions: 0 },
    hunks: [hunk],
    symbols: [],
    resolution: "untouched",
    kind: "database",
  };
}

function link(
  from: Edge["from"],
  to: Edge["to"],
  change: Edge["change"],
  kind: Edge["kind"],
  label?: string,
  resolver: Edge["resolver"] = "sql",
): Edge {
  const id = createHash("sha1")
    .update(`${from.nodeId}:${from.line}|${to.nodeId}:${to.line}|${kind}`)
    .digest("hex")
    .slice(0, 12);
  return {
    id: `e:${id}`,
    from,
    to,
    change,
    kind,
    confidence: "heuristic",
    resolver,
    ...(label ? { label } : {}),
  };
}
