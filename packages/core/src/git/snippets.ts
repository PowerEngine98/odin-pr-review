import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { displayRows, rowForLine, type Snippet } from "../layout/display.js";
import type { ChangeGraph, FileNode, Side } from "../model/types.js";
import { git, type GitOptions } from "./exec.js";

export interface SnippetOptions extends GitOptions {
  /** Lines of surrounding context to show around a target. */
  context?: number;
  /**
   * Largest run of untouched code fetched so a gap can be opened.
   *
   * Bounded because the text is embedded in the rendered document: without a
   * limit, one review of a small change to a large file would inline the whole
   * file. A gap longer than this stays closed, which is honest — it says how
   * many lines it stands for either way.
   */
  maxGapLines?: number;
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

  // Material behind the gaps: before the first hunk, between them, and under
  // the last one, so a reader can open any of them.
  const maxGap = options.maxGapLines ?? 400;
  for (const node of graph.nodes) {
    if (node.binary || node.hunks.length === 0) continue;
    const side = sideOf(node);
    const lines = await readBlob(node, side, graph, options, fileCache);
    if (!lines) continue;

    const collected = snippets.get(node.id) ?? [];
    for (const [from, to] of gapRanges(node, side, lines.length)) {
      // Never past the end of the file it was read from: the two sides of a
      // comparison are different lengths, and a band standing for lines that
      // are not there is a band that opens onto nothing.
      const end = Math.min(to, lines.length);
      if (end < from) continue;
      // A run too long to embed travels as a range with no text. The card can
      // still say how many lines stand there and simply cannot offer to open
      // them, which is the honest half of the answer; dropping the run outright
      // instead left the tail of a long file with nothing at all to say the
      // file went on past the change.
      const slice = end - from + 1 > maxGap ? [] : lines.slice(from - 1, end);
      collected.push({ side, startLine: from, lines: slice, hidden: true, endLine: end });
    }
    if (collected.length > 0) snippets.set(node.id, collected);
  }

  for (const [nodeId, perSide] of wanted) {
    const node = byId.get(nodeId)!;
    /*
     * Added to what is already here, not put in its place.
     *
     * The pass above fetches the material behind a file's gaps so a reader can
     * open them; this one fetches the few lines around where an arrow lands.
     * Starting a fresh list threw the first away — so a file with an arrow into
     * it lost every one of its gaps, and the twenty lines that had been
     * openable became a band standing in front of nothing.
     *
     * Which put the arrow's own target inside that band. The file was readable
     * until something pointed at it, and pointing at it is what a graph is for.
     */
    const collected: Snippet[] = [...(snippets.get(nodeId) ?? [])];

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

/**
 * The untouched runs of a file: before the first hunk, between them, and after
 * the last one.
 *
 * The run past the last hunk used to be left out, on the reckoning that a card
 * stops where the change does. What it meant was that the control offering to
 * show the whole file could not: a change to the middle of a file showed the
 * file from its first line to the end of the last hunk and nothing after, and
 * the reader had no way to tell a file that ended there from one that carried
 * on for another two hundred lines. The tail is fetched like any other gap and
 * bands over like any other gap, so it costs one row on a card nobody opens.
 */
function gapRanges(node: FileNode, side: Side, lineCount: number): [number, number][] {
  const spans = node.hunks
    .map((hunk): [number, number] => {
      const start = side === "base" ? hunk.oldStart : hunk.newStart;
      const span = side === "base" ? hunk.oldLines : hunk.newLines;
      return [start, start + Math.max(span, 1) - 1];
    })
    .sort((a, b) => a[0] - b[0]);

  const ranges: [number, number][] = [];
  let cursor = 1;
  for (const [start, end] of spans) {
    if (start > cursor) ranges.push([cursor, start - 1]);
    cursor = Math.max(cursor, end + 1);
  }
  if (lineCount >= cursor) ranges.push([cursor, lineCount]);
  return ranges;
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
  const path = side === "base" ? (node.prevPath ?? node.path) : node.path;

  /*
   * A live reading is of the working tree, so the head of it is the file on
   * disk and not the commit `HEAD` happens to name.
   *
   * Those are the same file only while nothing is uncommitted, which for a live
   * reading is the one case it was not built for: somebody watching an agent
   * work is watching a tree full of work that has not been committed and may
   * never be. The diff was measured against the tree, so every line on a card
   * is numbered by the tree — while the material behind the bands came out of
   * the commit, numbered by the tree all the same.
   *
   * What that looks like is not a missing line but a sliding one. Two lines
   * inserted near the top of a file put every line after them two out of step,
   * so opening a band showed real code from the file at numbers belonging to
   * the code two lines above it, and where the slide ran past the end of the
   * band it showed the lines the hunk below was already showing. The reader
   * sees one line of their file drawn twice, at two numbers, one of which it
   * has never had — on a file they are in the middle of editing, which is the
   * worst possible moment to be told something is there twice.
   *
   * It also means a file git has never been told about has context at all: a
   * `git show` of an untracked path fails, and the card for a file somebody has
   * just written could show nothing around its hunks.
   */
  const live = graph.meta.worktree === true && side === "head";
  const sha = side === "base" ? graph.meta.mergeBase : graph.meta.headSha;
  if (!live && !sha) return null;

  const key = live ? `worktree:${path}` : `${sha}:${path}`;
  if (cache.has(key)) return cache.get(key)!;

  let lines: string[] | null = null;
  try {
    const content = live
      ? await readFile(resolve(graph.meta.repo ?? options.cwd, path), "utf8")
      : await git(["show", key], options);
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
