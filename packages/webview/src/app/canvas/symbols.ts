import type { EdgeView } from "../model.js";
import type { Side } from "../marks/marks.js";

/**
 * The box drawn round the word an arrow is about.
 *
 * An arrow reaches a line; the box says which word on it — at the far end the
 * definition it resolved to, at the near end the call that resolved. Without it
 * an arrow landing on a line of forty characters is pointing at all of them,
 * and the reader has to guess which name the tool actually followed.
 *
 * All of it pure. The placement is arithmetic over the character width the
 * layout engine used, not a measurement of the browser's text: the arrows were
 * placed from that number, the box has to agree with them, and asking the
 * browser is asking a different question. It also means the box is there in the
 * markup rendered on the server, where there is nothing to measure with.
 */

/** One end of an arrow, as the row it lands on needs to know it. */
export interface SymbolMark {
  edgeId: string;
  /** The call that resolved, or the definition it reached. */
  role: "out" | "in";
  /** Whether the reference was added, removed, or was there all along. */
  change: string;
  /**
   * The spellings to look for on the line, in the order to try them.
   *
   * Usually one. Both ends of an arrow normally spell a name the same way and
   * generated code does not — a table called `account` is `ACCOUNT` in the
   * Kotlin that reads it — so the end that wrote the other spelling offers it
   * as a fallback, and the box lands on the word that is actually written.
   */
  words: string[];
}

/** What a line is called while these are being collected. */
function at(side: Side, line: number): string {
  return `${side}:${line}`;
}

/**
 * Every word this card should box, keyed by the line it is written on.
 *
 * Both ends of every edge, because a card is as much the thing pointed at as
 * the thing pointing — the definition an arrow reaches and the call that
 * reached it are both names worth pointing out, and the old renderer marked
 * both.
 *
 * Imports are left out. Their "symbol" is a module name on an import line, so
 * marking them would put a box on every import at the top of every card, which
 * is a wall of boxes around the part of a file nobody is reviewing.
 *
 * And only references whose arrow is drawn. `drawn` is the same question the
 * arrow layer asks, handed in rather than asked again here: the two must agree,
 * and the way they stop agreeing is boxes outliving a filter.
 */
export function symbolMarks(
  edges: readonly EdgeView[],
  nodeId: string,
  drawn: (edge: EdgeView) => boolean = () => true,
): Map<string, SymbolMark[]> {
  return allSymbolMarks(edges, drawn).get(nodeId) ?? new Map();
}

/**
 * The same answer for every card at once, in one pass over the edges.
 *
 * Asked per card it was the product of two large numbers — a hundred and thirty
 * cards each walking nine hundred edges — and it is not asked once. Every card
 * reads `drawn`, `drawn` reads which cards are on the canvas, and that changes
 * as the reader pans: one card coming into view redid the work for all of them.
 * On a large change that arithmetic was most of a thirty-second pause at boot,
 * during which the editor's window is not answering anybody.
 *
 * Walking the edges once and filing each end under its own card gives the same
 * marks for the same inputs, at a hundred and thirtieth of the cost.
 */
export function allSymbolMarks(
  edges: readonly EdgeView[],
  drawn: (edge: EdgeView) => boolean = () => true,
): Map<string, Map<string, SymbolMark[]>> {
  const byNode = new Map<string, Map<string, SymbolMark[]>>();

  const add = (nodeId: string, key: string, mark: SymbolMark) => {
    let marks = byNode.get(nodeId);
    if (!marks) byNode.set(nodeId, (marks = new Map()));
    const here = marks.get(key);
    if (here) here.push(mark);
    else marks.set(key, [mark]);
  };

  for (const edge of edges) {
    if (!edge.symbol || edge.kind === "import") continue;
    // Only a reference the reader can actually see an arrow for. A box is that
    // arrow naming its ends, and one without it marks a word that nothing
    // points at.
    if (!drawn(edge)) continue;

    add(edge.from, at(edge.fromSide, edge.fromLine), {
      edgeId: edge.id,
      role: "out",
      change: edge.change,
      words: edge.fromSymbol ? [edge.symbol, edge.fromSymbol] : [edge.symbol],
    });
    add(edge.to, at(edge.toSide, edge.toLine), {
      edgeId: edge.id,
      role: "in",
      change: edge.change,
      words: [edge.symbol],
    });
  }

  return byNode;
}

/** Where a box goes, measured in characters along the line's own code. */
export interface SymbolBox {
  /** One per name and role, however many arrows share it. */
  key: string;
  /**
   * The arrow this box is an end of, so pressing it can follow that arrow.
   *
   * The first, when a word is an end of several — a name called twice from one
   * line is one box, and the reader who presses it has asked to go where that
   * name goes rather than to choose between two arrows that land in the same
   * place. Kept as an id rather than the edge so this module goes on knowing
   * nothing about how an edge is drawn.
   */
  edgeId: string;
  role: "out" | "in";
  change: string;
  word: string;
  /**
   * Columns from the first character of the code, not pixels.
   *
   * The box is drawn in `ch`, the width of a character in the font the line is
   * set in, so it is the same measurement the browser laid the text out with.
   * Pixels came from the layout engine's `charWidth`, which is close to the
   * rendered advance and not equal to it: the error is a fraction of a
   * character per column and compounds along the line, so a name forty columns
   * in wore a box that started before it and ended well past it. Nothing here
   * has to agree with `charWidth` — the arrows are placed against card edges
   * and row heights, and where a word sits inside a line is the browser's
   * arithmetic, not the engine's.
   */
  from: number;
  span: number;
}

/** The characters a name can be made of, for telling a word from a fragment. */
const IDENTIFIER = /[A-Za-z0-9_$]/;

/**
 * Where a name is written on a line, as a whole word.
 *
 * A plain search finds `render` inside `renderHtml`, and the box then sits on
 * the first half of a different name — pointing out a word that is not there.
 * So an occurrence only counts when neither side of it is more of the same
 * name; a dot, a bracket or a space is a boundary, another letter is not.
 */
function wordAt(text: string, word: string): number {
  for (let from = text.indexOf(word); from >= 0; from = text.indexOf(word, from + 1)) {
    const before = from > 0 ? text[from - 1]! : "";
    const after = text[from + word.length] ?? "";
    if (!IDENTIFIER.test(before) && !IDENTIFIER.test(after)) return from;
  }
  return -1;
}

/**
 * The boxes for one line, placed.
 *
 * A box takes a character of room on the left, so that it does not sit on the
 * first glyph it is meant to be pointing out, and stops where the word stops.
 * The right edge is the word's own: a box that ran a character past it closed
 * over whatever followed — most often the bracket of the call being pointed at,
 * which reads as though the arguments were part of the name. Where the word
 * begins the line there is no room to take, and the box starts at the code's
 * own edge rather than reaching back into the gutter.
 *
 * One box per name and role, not per arrow. A definition is landed on by every
 * file that calls it, and a translucent box drawn ten times over is an opaque
 * one — the name it was pointing out disappears underneath it.
 */
export function boxesOn(
  text: string,
  marks: readonly SymbolMark[] | undefined,
): SymbolBox[] {
  if (!marks || marks.length === 0) return [];

  const boxes: SymbolBox[] = [];
  const seen = new Set<string>();

  for (const mark of marks) {
    for (const word of mark.words) {
      if (!word) continue;
      const column = wordAt(text, word);
      if (column < 0) continue;

      const key = `${mark.role}|${word}`;
      if (seen.has(key)) break;
      seen.add(key);

      /*
       * A quarter of a character of air on each side.
       *
       * The original kept a whole character to the left and none to the right,
       * which reads as a box that has slipped: an outline is understood as
       * surrounding a word, and one that hugs the last letter while standing
       * clear of the first looks misplaced rather than generous. A quarter each
       * way is enough to keep the stroke off the glyphs without the box
       * reaching far enough to suggest it contains the bracket after it.
       *
       * Clamped at the start of the line, where there is no room to give.
       */
      const air = 0.25;
      const from = Math.max(0, column - air);
      boxes.push({
        key,
        edgeId: mark.edgeId,
        role: mark.role,
        change: mark.change,
        word,
        from,
        span: column + word.length + air - from,
      });
      break;
    }
  }

  return boxes;
}

/** What a line is called in the map above, or nothing when it has no number. */
export function markKey(side: Side, line: number | undefined): string | null {
  return line === undefined ? null : at(side, line);
}
