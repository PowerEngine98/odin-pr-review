import type { ParsedFile } from "../diff/parse.js";
import { nodeId } from "../model/ids.js";
import { isTestPath } from "./tests.js";
import { detectDialect, detectLanguage } from "../model/language.js";
import {
  SCHEMA_VERSION,
  type ChangeGraph,
  type Edge,
  type FileNode,
  type GraphMeta,
} from "../model/types.js";

export interface BuildOptions {
  meta: GraphMeta;
  /** Edges are attached by a later pass; empty is a valid graph. */
  edges?: Edge[];
}

/**
 * One record per path, however many the patch had.
 *
 * A vertex is named after its path, so two records for one path are two
 * vertices with one name — and every consumer that keys by id then has a
 * duplicate to choke on. The canvas is the loudest: it draws its cards keyed by
 * file id, and a repeated key takes the whole page down rather than drawing one
 * card badly.
 *
 * Git does hand out the same path twice. A combined diff over a merge lists a
 * path once per parent it differs from, and a patch stitched together from more
 * than one range can repeat one too. Neither is a broken repository, so neither
 * may be a blank screen: the records are folded into a single file, which is
 * what they always described.
 */
function byPath(files: ParsedFile[]): ParsedFile[] {
  const seen = new Map<string, ParsedFile>();

  for (const file of files) {
    const first = seen.get(file.path);
    if (!first) {
      seen.set(file.path, file);
      continue;
    }
    // The first record keeps the say on what happened to the file — a status
    // is not additive, and the earlier record is the one nearer the base.
    seen.set(file.path, {
      ...first,
      hunks: [...first.hunks, ...file.hunks],
      additions: first.additions + file.additions,
      deletions: first.deletions + file.deletions,
    });
  }

  return [...seen.values()];
}

/** Turns parsed patch records into graph vertices. */
export function filesToNodes(files: ParsedFile[]): FileNode[] {
  return byPath(files).map((f): FileNode => {
    const node: FileNode = {
      id: nodeId(f.path),
      path: f.path,
      status: f.status,
      // The diff's own text decides where the path cannot: a `.sql` file that
      // uses `plpgsql` or `EXECUTE FUNCTION` is Postgres, and only the Postgres
      // resolver knows what those point at.
      language: detectDialect(
        f.path,
        f.hunks.map((h) => h.lines.map((l) => l.text).join("\n")).join("\n"),
      ),
      binary: f.binary,
      stats: { additions: f.additions, deletions: f.deletions },
      hunks: f.hunks,
      symbols: [],
    };
    if (f.status === "renamed" && f.oldPath) node.prevPath = f.oldPath;
    return node;
  });
}

export function buildGraph(
  files: ParsedFile[],
  options: BuildOptions,
): ChangeGraph {
  return sortGraph({
    schemaVersion: SCHEMA_VERSION,
    meta: options.meta,
    nodes: filesToNodes(files),
    edges: options.edges ?? [],
  });
}

/**
 * Imposes the canonical ordering.
 *
 * Every producer must run this before serialising. Determinism is a product
 * requirement, not a nicety: the layout engine breaks ties by array order, so
 * an unstable order here would move nodes around between runs and destroy the
 * muscle memory the tool exists to preserve.
 */
export function sortGraph(graph: ChangeGraph): ChangeGraph {
  const nodes = [...graph.nodes].sort((a, b) =>
    a.path === b.path ? cmp(a.id, b.id) : cmp(a.path, b.path),
  );

  const edges = [...graph.edges].sort((a, b) =>
    cmp(a.from.nodeId, b.from.nodeId) ||
    a.from.line - b.from.line ||
    (a.from.column ?? 0) - (b.from.column ?? 0) ||
    cmp(a.to.nodeId, b.to.nodeId) ||
    a.to.line - b.to.line ||
    cmp(a.kind, b.kind) ||
    cmp(a.id, b.id),
  );

  return { ...graph, nodes, edges };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Adds vertices for files that are referenced by an edge but absent from the
 * diff. These render with a dimmed outline so a reviewer can tell at a glance
 * that the file itself was not touched.
 */
export function addPhantomNodes(
  graph: ChangeGraph,
  referenced: { nodeId: string; path: string }[],
): ChangeGraph {
  const known = new Set(graph.nodes.map((n) => n.id));
  const extra: FileNode[] = [];
  const seen = new Set<string>();

  for (const ref of referenced) {
    if (known.has(ref.nodeId) || seen.has(ref.nodeId)) continue;
    seen.add(ref.nodeId);
    extra.push({
      id: ref.nodeId,
      path: ref.path,
      status: "phantom",
      language: detectLanguage(ref.path),
      binary: false,
      stats: { additions: 0, deletions: 0 },
      hunks: [],
      symbols: [],
      // Phantoms arrive after the diff has been tagged, so they tag themselves.
      isTest: isTestPath(ref.path),
    });
  }

  if (extra.length === 0) return graph;
  return sortGraph({ ...graph, nodes: [...graph.nodes, ...extra] });
}
