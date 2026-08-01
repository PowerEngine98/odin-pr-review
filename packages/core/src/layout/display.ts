import type { DiffLine, FileNode, Hunk, Side } from "../model/types.js";

/** A row as it appears inside a card, top to bottom. */
export type DisplayRow =
  | {
      kind: "add" | "del" | "ctx";
      text: string;
      oldLine?: number;
      newLine?: number;
    }
  | {
      kind: "gap";
      /** How many source lines the row stands in for. */
      hidden: number;
      /** `@@ -a,b +c,d @@ enclosing symbol`, when the gap opens a hunk. */
      header?: string;
      text: string;
    };

/** A run of consecutive source lines pulled in to give an arrow something to
 *  land on. Produced by `enrichSnippets`, never by the diff itself. */
export interface Snippet {
  side: Side;
  /** 1-based line number of `lines[0]` on `side`. */
  startLine: number;
  lines: string[];
}

export interface DisplayOptions {
  /** Positions an arrow touches; these lines are never collapsed away. */
  anchors?: { side: Side; line: number }[];
  /** Unchanged lines kept on each side of a change or an anchor. */
  contextRadius?: number;
  /** Only runs longer than this are worth collapsing. */
  collapseThreshold?: number;
}

const DEFAULT_CONTEXT_RADIUS = 2;
const DEFAULT_COLLAPSE_THRESHOLD = 3;

/**
 * Flattens a node's hunks and snippets into the rows a card displays.
 *
 * Hunks win wherever the two overlap: a line that is part of the change should
 * be shown with its diff marker, not as anonymous context.
 *
 * Runs of unchanged code that no arrow touches are collapsed into a single gap
 * row, the way a diff viewer collapses the untouched middle of a file. A card
 * is a summary of what a change did, and a reviewer scanning a graph of them
 * has no use for twenty lines of code that neither moved nor got referenced.
 * Gaps also carry the hunk header, so the collapsed region still says which
 * declaration it came from.
 */
export function displayRows(
  node: FileNode,
  snippets: Snippet[] = [],
  options: DisplayOptions = {},
): DisplayRow[] {
  const side: Side = node.status === "deleted" ? "base" : "head";
  const rows = assemble(node, snippets, side);
  return collapse(rows, side, options);
}

// ------------------------------------------------------------------ assembly

interface Segment {
  start: number;
  end: number;
  /** Header shown on the gap that precedes this segment. */
  label?: string;
  rows: DisplayRow[];
}

function assemble(node: FileNode, snippets: Snippet[], side: Side): DisplayRow[] {
  const segments: Segment[] = [];

  for (const hunk of node.hunks) {
    const start = side === "base" ? hunk.oldStart : hunk.newStart;
    const span = side === "base" ? hunk.oldLines : hunk.newLines;
    segments.push({
      start,
      end: start + Math.max(span, 1) - 1,
      label: hunkHeader(hunk),
      rows: hunk.lines.map(toRow),
    });
  }

  for (const snippet of snippets) {
    if (snippet.side !== side || snippet.lines.length === 0) continue;
    const start = snippet.startLine;
    const end = start + snippet.lines.length - 1;
    // A snippet the diff already covers adds nothing but duplication.
    if (segments.some((s) => start >= s.start && end <= s.end)) continue;
    segments.push({
      start,
      end,
      rows: snippet.lines.map((text, i) => ({
        kind: "ctx" as const,
        text,
        ...(side === "base" ? { oldLine: start + i } : { newLine: start + i }),
      })),
    });
  }

  segments.sort((a, b) => a.start - b.start || a.end - b.end);

  const rows: DisplayRow[] = [];
  let previousEnd: number | undefined;

  for (const segment of segments) {
    if (previousEnd !== undefined) {
      if (segment.start <= previousEnd) continue; // covered by an earlier one
      const hidden = segment.start - previousEnd - 1;
      if (hidden > 0) rows.push(gapRow(hidden, segment.label));
    } else if (segment.start > 1) {
      rows.push(gapRow(segment.start - 1, segment.label));
    }
    rows.push(...segment.rows);
    previousEnd = segment.end;
  }

  return rows;
}

function hunkHeader(hunk: Hunk): string {
  const range =
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  return hunk.header ? `${range} ${hunk.header}` : range;
}

function gapRow(hidden: number, header?: string): DisplayRow {
  const row: DisplayRow = {
    kind: "gap",
    hidden,
    text: `⋯ ${hidden} unchanged ${hidden === 1 ? "line" : "lines"}`,
  };
  if (header) row.header = header;
  return row;
}

function toRow(line: DiffLine): DisplayRow {
  const row: DisplayRow = { kind: line.kind, text: line.text };
  if (line.oldLine !== undefined) row.oldLine = line.oldLine;
  if (line.newLine !== undefined) row.newLine = line.newLine;
  return row;
}

// ---------------------------------------------------------------- collapsing

function collapse(
  rows: DisplayRow[],
  side: Side,
  options: DisplayOptions,
): DisplayRow[] {
  const radius = options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;
  const threshold = options.collapseThreshold ?? DEFAULT_COLLAPSE_THRESHOLD;

  const anchored = new Set(
    (options.anchors ?? [])
      .filter((a) => a.side === side)
      .map((a) => a.line),
  );

  // Rows that earn surrounding context: the change itself, and anything an
  // arrow lands on. A gap earns none — it marks absent code, so padding around
  // it would drag back the very lines it stands in for.
  const seeds = rows.map((row) => {
    if (row.kind === "add" || row.kind === "del") return true;
    if (row.kind !== "ctx") return false;
    const line = side === "base" ? row.oldLine : row.newLine;
    return line !== undefined && anchored.has(line);
  });

  const keep = rows.map((row, i) => seeds[i] || row.kind === "gap");
  for (let i = 0; i < rows.length; i++) {
    if (!seeds[i]) continue;
    for (let j = Math.max(0, i - radius); j <= Math.min(rows.length - 1, i + radius); j++) {
      keep[j] = true;
    }
  }
  const padded = keep;

  const out: DisplayRow[] = [];
  let run: DisplayRow[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length > threshold) {
      out.push(gapRow(run.length));
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (padded[i]) {
      flush();
      out.push(row);
    } else {
      run.push(row);
    }
  }
  flush();

  return mergeAdjacentGaps(out);
}

/** Two gaps in a row read as a mistake; one gap with the total does not. */
function mergeAdjacentGaps(rows: DisplayRow[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  for (const row of rows) {
    const previous = out[out.length - 1];
    if (row.kind === "gap" && previous && previous.kind === "gap") {
      out[out.length - 1] = gapRow(
        previous.hidden + row.hidden,
        previous.header ?? row.header,
      );
      continue;
    }
    out.push(row);
  }
  return out;
}

// -------------------------------------------------------------------- title

/** The pieces of a card's header, in the order every renderer draws them. */
export interface CardTitle {
  /** File name, without directories. */
  name: string;
  /** `← oldName.ts` for a rename, otherwise empty. */
  was: string;
  /** `+3 −1`, or `untouched` for a file the diff never mentioned. */
  stats: string;
}

export function cardTitle(node: FileNode): CardTitle {
  return {
    name: basename(node.path),
    was: node.prevPath ? `← ${basename(node.prevPath)}` : "",
    stats:
      node.status === "phantom"
        ? "untouched"
        : `+${node.stats.additions} −${node.stats.deletions}`,
  };
}

/**
 * Width the header needs, in characters.
 *
 * Measuring the path alone is not enough: a renamed file also shows where it
 * came from, and every file shows its line counts. Under-measuring does not
 * clip the text, it overflows the card and reads as missing padding.
 */
export function titleLength(title: CardTitle): number {
  const parts = [title.name, title.was, title.stats].filter(Boolean);
  // One space of separation between parts, as the renderers lay them out.
  return parts.join("  ").length;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

// ------------------------------------------------------------------- lookup

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
