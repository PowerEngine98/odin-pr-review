import { displayRows, rowForLine, type Snippet } from "../layout/display.js";
import type { ChangeGraph, FileNode, Side } from "../model/types.js";
import { git, type GitOptions } from "./exec.js";

export interface SnippetOptions extends GitOptions {
  /** Lines of surrounding context to show around a target. */
  context?: number;
}

/**
 * Fetches the source an arrow needs to land on.
 *
 * An edge points at a definition, and that definition is very often nowhere
 * near the lines the diff touched — or, for a phantom file, nowhere in the diff
 * at all. Without this pass those arrows can only point at the edge of a card,
 * which tells a reviewer which file but not which function. Reading the blobs
 * straight out of git means no assumption that the working tree still matches
 * either side of the comparison.
 */
export async function enrichSnippets(
  graph: ChangeGraph,
  options: SnippetOptions,
): Promise<Map<string, Snippet[]>> {
  const context = options.context ?? 2;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // Rows as they would render with no help, to see what is already visible.
  const baseRows = new Map(
    graph.nodes.map((n) => [n.id, displayRows(n)] as const),
  );

  /** nodeId -> side -> requested line ranges */
  const wanted = new Map<string, Map<Side, [number, number][]>>();

  const request = (nodeId: string, side: Side, line: number) => {
    const node = byId.get(nodeId);
    if (!node || node.binary) return;
    // A card only ever shows one side, so a request for the other is moot.
    if (sideOf(node) !== side) return;
    if (rowForLine(baseRows.get(nodeId) ?? [], side, line) !== undefined) return;

    const perSide = wanted.get(nodeId) ?? new Map<Side, [number, number][]>();
    const ranges = perSide.get(side) ?? [];
    ranges.push([Math.max(1, line - context), line + context]);
    perSide.set(side, ranges);
    wanted.set(nodeId, perSide);
  };

  for (const edge of graph.edges) {
    request(edge.to.nodeId, edge.to.side, edge.to.line);
    request(edge.from.nodeId, edge.from.side, edge.from.line);
  }

  const snippets = new Map<string, Snippet[]>();
  const fileCache = new Map<string, string[] | null>();

  for (const [nodeId, perSide] of wanted) {
    const node = byId.get(nodeId)!;
    const collected: Snippet[] = [];

    for (const [side, ranges] of perSide) {
      const lines = await readBlob(node, side, graph, options, fileCache);
      if (!lines) continue;

      for (const [start, end] of merge(ranges)) {
        const from = Math.max(1, start);
        const to = Math.min(lines.length, end);
        if (to < from) continue;
        collected.push({ side, startLine: from, lines: lines.slice(from - 1, to) });
      }
    }

    if (collected.length > 0) {
      collected.sort((a, b) => a.startLine - b.startLine);
      snippets.set(nodeId, collected);
    }
  }

  return snippets;
}

/** Which side of the comparison a card displays. */
function sideOf(node: FileNode): Side {
  return node.status === "deleted" ? "base" : "head";
}

async function readBlob(
  node: FileNode,
  side: Side,
  graph: ChangeGraph,
  options: GitOptions,
  cache: Map<string, string[] | null>,
): Promise<string[] | null> {
  const sha = side === "base" ? graph.meta.mergeBase : graph.meta.headSha;
  if (!sha) return null;

  const path = side === "base" ? (node.prevPath ?? node.path) : node.path;
  const key = `${sha}:${path}`;
  if (cache.has(key)) return cache.get(key)!;

  let lines: string[] | null = null;
  try {
    const content = await git(["show", key], options);
    lines = content.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
  } catch {
    // The path may not exist on that side; an arrow to the card edge is a fine
    // fallback and better than failing the whole render.
    lines = null;
  }

  cache.set(key, lines);
  return lines;
}

/** Collapses overlapping or adjacent ranges so nothing is fetched twice. */
function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];

  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      out.push([range[0], range[1]]);
    }
  }
  return out;
}
