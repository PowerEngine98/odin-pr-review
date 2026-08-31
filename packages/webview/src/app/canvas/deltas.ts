import type { RowView } from "./rows.js";

/**
 * What changed on a card, when the file under it changed.
 *
 * A live reading rebuilds itself whenever the working tree moves, and applying
 * the result is one assignment: the card's rows are replaced and the new ones
 * are simply there. Nothing says which of them are new. On a card of two
 * hundred lines that is a change the reader has no way of noticing — and while
 * an agent is working, noticing is the whole point of watching.
 *
 * So the two sets of rows are compared and the difference is handed back as
 * something to draw over them: lines that were rewritten, lines that arrived,
 * and — the one that leaves no trace of itself — lines that are gone, which are
 * marked at the place they were taken from.
 */
export type Mark = "changed" | "added";

export interface Delta {
  /** What to say about a row still on the card, by the row itself. */
  marks: Map<RowView, Mark>;
  /**
   * Lines that were removed, and the row they sat above.
   *
   * `undefined` means the end of the card: the last lines of a file are removed
   * as often as any others, and there is no row after them to hang it on.
   */
  gone: { before: RowView | undefined; lines: number }[];
}

const EMPTY: Delta = { marks: new Map(), gone: [] };

/**
 * The difference between two readings of one card.
 *
 * Matched from the ends inwards rather than by line number. A line inserted at
 * the top of a file renumbers everything under it, so comparing by number would
 * report the whole card as rewritten for the sake of one line — which is both
 * useless and, as a wash of colour over two hundred rows, unreadable. Text is
 * what the reader is watching, so text is what is compared.
 *
 * A run that shrank is a rewrite plus a removal, and a run that grew is a
 * rewrite plus an arrival. Both are drawn as one thing on the rows that remain
 * and, where lines went, one box in the gap they left.
 */
export function deltaOf(before: readonly RowView[], after: readonly RowView[]): Delta {
  if (before.length === 0 || after.length === 0) return EMPTY;

  let head = 0;
  while (head < before.length && head < after.length && same(before[head], after[head])) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    same(before[before.length - 1 - tail], after[after.length - 1 - tail])
  ) {
    tail += 1;
  }

  const wasThere = before.length - head - tail;
  const isThere = after.length - head - tail;
  if (wasThere === 0 && isThere === 0) return EMPTY;

  /*
   * A whole card replaced says nothing worth saying.
   *
   * Switching branch, or a rebuild that reads a different file into the same
   * card, changes every row. Painting all of them is a card that flashes
   * entirely and tells the reader only that something happened — which they can
   * see. The mark is for the edit small enough to miss.
   */
  if (isThere > 0 && head === 0 && tail === 0 && isThere === after.length) return EMPTY;

  const marks = new Map<RowView, Mark>();
  const mark: Mark = wasThere > 0 ? "changed" : "added";
  for (let at = head; at < head + isThere; at++) {
    const row = after[at];
    if (row) marks.set(row, mark);
  }

  const gone: Delta["gone"] = [];
  const lost = wasThere - isThere;
  if (lost > 0) gone.push({ before: after[head + isThere], lines: lost });

  return { marks, gone };
}

/** Two rows a reader would call the same line. */
function same(a: RowView | undefined, b: RowView | undefined): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "gap" || b.kind === "gap") {
    return a.kind === "gap" && b.kind === "gap" && a.hidden === b.hidden;
  }
  return a.text === b.text;
}
