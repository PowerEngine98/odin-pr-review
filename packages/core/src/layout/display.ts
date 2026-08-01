import type { DiffLine, FileNode, Side } from "../model/types.js";

/** A row as it appears inside a card, top to bottom. */
export type DisplayRow =
  | { kind: "add" | "del" | "ctx"; text: string; oldLine?: number; newLine?: number }
  | { kind: "gap"; text: string };

/** A run of consecutive source lines pulled in to give an arrow something to
 *  land on. Produced by `enrichSnippets`, never by the diff itself. */
export interface Snippet {
  side: Side;
  /** 1-based line number of `lines[0]` on `side`. */
  startLine: number;
  lines: string[];
}

/**
 * Flattens a node's hunks and snippets into the rows a card displays.
 *
 * Hunks win wherever the two overlap: a line that is part of the change should
 * be shown with its diff marker, not as anonymous context. Gaps are inserted
 * wherever the line numbering jumps, so a reader is never misled into thinking
 * two distant regions are adjacent.
 */
export function displayRows(node: FileNode, snippets: Snippet[] = []): DisplayRow[] {
  const side: Side = node.status === "deleted" ? "base" : "head";

  interface Segment { start: number; end: number; rows: DisplayRow[] }
  const segments: Segment[] = [];

  for (const hunk of node.hunks) {
    const start = side === "base" ? hunk.oldStart : hunk.newStart;
    const span = side === "base" ? hunk.oldLines : hunk.newLines;
    segments.push({
      start,
      end: start + Math.max(span, 1) - 1,
      rows: hunk.lines.map(toRow),
    });
  }

  for (const snippet of snippets) {
    if (snippet.side !== side || snippet.lines.length === 0) continue;
    const start = snippet.startLine;
    const end = start + snippet.lines.length - 1;
    // A snippet that the diff already covers adds nothing but duplication.
    if (segments.some((s) => start >= s.start && end <= s.end)) continue;
    segments.push({
      start,
      end,
      rows: snippet.lines.map((text, i) => ({
        kind: "ctx" as const,
        text,
        ...(side === "base"
          ? { oldLine: start + i }
          : { newLine: start + i }),
      })),
    });
  }

  segments.sort((a, b) => a.start - b.start || a.end - b.end);

  const rows: DisplayRow[] = [];
  let previousEnd: number | undefined;

  for (const segment of segments) {
    if (previousEnd !== undefined) {
      if (segment.start <= previousEnd) continue; // fully or partly covered
      if (segment.start > previousEnd + 1) {
        rows.push({ kind: "gap", text: `⋯ ${segment.start - previousEnd - 1} lines` });
      }
    }
    rows.push(...segment.rows);
    previousEnd = segment.end;
  }

  return rows;
}

function toRow(line: DiffLine): DisplayRow {
  const row: DisplayRow = { kind: line.kind, text: line.text };
  if (line.oldLine !== undefined) row.oldLine = line.oldLine;
  if (line.newLine !== undefined) row.newLine = line.newLine;
  return row;
}

/**
 * Index of the row showing a given line, or undefined when the line is not on
 * screen. Callers fall back to the card edge, which is honest: the arrow still
 * says which file, it just cannot say where.
 */
export function rowForLine(
  rows: DisplayRow[],
  side: Side,
  line: number,
): number | undefined {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === "gap") continue;
    const value = side === "base" ? row.oldLine : row.newLine;
    if (value === line) return i;
  }
  return undefined;
}
