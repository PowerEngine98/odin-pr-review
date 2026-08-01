import { sortGraph } from "./graph/build.js";
import type { ChangeGraph } from "./model/types.js";

/**
 * Serialises a graph reproducibly: canonical collection order, canonical key
 * order, stable indentation. Two runs over the same commits must produce
 * byte-identical output, which is what makes golden-file tests meaningful and
 * lets the graph be committed or diffed like any other artefact.
 */
export function serializeGraph(graph: ChangeGraph, indent = 2): string {
  return JSON.stringify(sortGraph(graph), orderKeys, indent) + "\n";
}

/** Key precedence; anything unlisted sorts after, alphabetically. */
const KEY_ORDER = [
  "schemaVersion", "meta", "nodes", "edges",
  "repo", "baseRef", "headRef", "baseSha", "headSha", "mergeBase",
  "generator", "generatedAt",
  "id", "path", "prevPath", "status", "language", "binary", "stats",
  "additions", "deletions", "hunks", "symbols",
  "header", "oldStart", "oldLines", "newStart", "newLines", "lines",
  "kind", "text", "oldLine", "newLine", "noNewline",
  "name", "side", "startLine", "endLine", "selectionLine",
  "from", "to", "change", "confidence", "resolver", "label",
  "nodeId", "line", "column", "symbolId", "symbolName",
];

const RANK = new Map(KEY_ORDER.map((k, i) => [k, i]));

function orderKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  entries.sort(([a], [b]) => {
    const ra = RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
  });
  return Object.fromEntries(entries);
}
