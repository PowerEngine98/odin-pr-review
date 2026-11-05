import type { Anchor } from "@odin/core/tour/tour.js";
import { locate } from "@odin/core/tour/tour.js";

import { bandRows, numbered, type RowView } from "../canvas/rows.js";

/**
 * Finding a tour's lines on a card, by what they say.
 *
 * A frame names a place by a few lines of code, never by a number, because a
 * live reading renumbers the file on every save. What a card has is rows, and
 * the rows are not the file: they are the patch, some context read around it,
 * and bands standing in for runs nobody changed. So the lines of one side are
 * gathered out of the rows in order, each with the number it has on that side,
 * and `locate` is run over their text. Its answer is an index into that list,
 * which is turned back into the numbers the card draws in its gutter — the ones
 * `lineAt` asks for.
 *
 * Pure, so it can be tested without a card.
 */

export type Side = "head" | "base";

/** The lines a card holds for one side, in order, and the number of each. */
export interface SideLines {
  texts: string[];
  numbers: number[];
}

/**
 * One side's lines, out of a card's rows.
 *
 * An unchanged line belongs to both sides, an insertion to the head and a
 * removal to the base. A band that knows what it hides gives up its rows too:
 * the lines are in the file whether or not the card is showing them, and the
 * card points at the band when asked for one inside it. A band that never read
 * its lines adds nothing, and the next line after it simply follows on, which
 * a window sliding past the jump gets slightly wrong and nothing worse.
 */
export function linesOf(rows: readonly RowView[], side: Side): SideLines {
  const out: SideLines = { texts: [], numbers: [] };
  const walk = (list: readonly RowView[]): void => {
    for (const row of list) {
      if (row.kind === "gap") {
        walk(bandRows(row));
        continue;
      }
      if (side === "head" && row.kind === "del") continue;
      if (side === "base" && row.kind === "add") continue;
      const number = side === "head" ? row.newLine : row.oldLine;
      if (number === undefined) continue;
      out.texts.push(row.text);
      out.numbers.push(number);
    }
  };
  walk(numbered(rows));
  return out;
}

/** Where an anchor's lines are on a card: the side, and the first and last line. */
export interface Found {
  side: Side;
  start: number;
  end: number;
}

/**
 * Where an anchor's code is in a card's rows, or nothing.
 *
 * Both sides are searched and the closer match wins, the side the anchor named
 * on a tie: an agent that forgot to say "base" for a removed line still meant
 * that line, and the line that replaced it — which usually shares half its
 * words — is not it.
 */
export function findAnchor(
  rows: readonly RowView[],
  anchor: Pick<Anchor, "code" | "side">,
): Found | null {
  const first: Side = anchor.side ?? "head";
  const order: Side[] = first === "head" ? ["head", "base"] : ["base", "head"];
  let best: (Found & { score: number }) | null = null;
  for (const side of order) {
    const lines = linesOf(rows, side);
    const hit = locate(lines.texts, anchor.code);
    if (!hit) continue;
    const start = lines.numbers[hit.start - 1];
    const end = lines.numbers[hit.end - 1];
    if (start === undefined || end === undefined) continue;
    if (best && hit.score <= best.score) continue;
    best = { side, start: Math.min(start, end), end: Math.max(start, end), score: hit.score };
  }
  if (!best) return null;
  return { side: best.side, start: best.start, end: best.end };
}
