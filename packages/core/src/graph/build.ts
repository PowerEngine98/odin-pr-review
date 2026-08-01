import type { ParsedFile } from "../diff/parse.js";
import { nodeId } from "../model/ids.js";
import { isTestPath } from "./tests.js";
import { detectLanguage } from "../model/language.js";
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

/** Turns parsed patch records into graph vertices. */
export function filesToNodes(files: ParsedFile[]): FileNode[] {
  return files.map((f): FileNode => {
    const node: FileNode = {
      id: nodeId(f.path),
      path: f.path,
      status: f.status,
      language: detectLanguage(f.path),
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
