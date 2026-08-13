import type { EdgeView, NodeView } from "../model.js";

/**
 * The rows of a card, and the arithmetic a card does over them.
 *
 * All of it pure: given the same rows it gives the same answer, so a card can
 * derive from it as often as it likes and a test can call it without a
 * document. The reactive part is in the components; this is what they compute
 * with.
 */

/**
 * A coloured piece of a line, exactly as the highlighter produced it.
 *
 * Colouring happens in the extension, where a grammar and a theme are already
 * loaded, and arrives here as data. The browser has no highlighter to run and
 * should not grow one: the same change would then be coloured twice, by two
 * things that would eventually disagree.
 */
export interface CodeToken {
  text: string;
  color?: string;
  /** 1 italic, 2 bold, 4 underline. */
  fontStyle?: number;
}

/** A line of the file, on one side of the change or on both. */
export interface CodeRow {
  kind: "add" | "del" | "ctx";
  text: string;
  oldLine?: number;
  newLine?: number;
  /**
   * This line is in the patch, rather than source fetched around it.
   *
   * A comment can only be left where the forge can see the line — which is the
   * diff, not the file. Everything else on a card is context Odin went and read
   * so that an arrow had somewhere to land.
   */
  inDiff?: boolean;
  /**
   * The file stops here, without a newline to end on.
   *
   * Git says so in the patch and every forge draws it, because it is a real
   * difference between two files that no line of code shows: the last line
   * looks identical either way. It is also the sort of thing a reviewer asks
   * for a change to, so a card that hides it is hiding a remark.
   */
  noNewline?: boolean;
  /** How the host coloured this line, when anything could colour it. */
  tokens?: CodeToken[];
}

/** A run of the file the card is not showing, banded. */
export interface GapRow {
  kind: "gap";
  /** How many source lines the row stands in for. */
  hidden: number;
  /** `@@ -a,b +c,d @@ enclosing symbol`, when the gap opens a hunk. */
  header?: string;
  /** This gap stands for a file's import block rather than untouched code. */
  imports?: boolean;
  text: string;
  /**
   * The rows this gap stands in for, when they are known.
   *
   * Present for a run collapsed out of material already on hand, absent for a
   * jump between hunks, where the lines were never read. A band that knows what
   * it hides can be opened; one that does not must not pretend otherwise.
   */
  rows?: RowView[];
  /**
   * The lines this band stands in for, per side.
   *
   * Carried so an arrow aimed at a folded line can find the band covering it.
   * It cannot be worked out from what is on the page: a band for a jump between
   * hunks has no rows behind it at all, so there is nothing there to measure.
   */
  covers?: { base?: [number, number]; head?: [number, number] };
}

export type RowView = CodeRow | GapRow;

/**
 * One row of a card with the two sides of the change laid out side by side.
 *
 * A card shows the base of the change on the left and the head on the right, so
 * both gutters carry a real line number on the same row. In a single stream a
 * deleted line and the line that replaced it sit several rows apart, each with
 * one gutter filled and the other blank, and the two columns drift by however
 * many lines the change added — which reads as a numbering fault rather than as
 * what it is.
 *
 * A band spans both sides: it stands for lines nobody changed, so there is
 * nothing to compare.
 */
export interface RowPair {
  band?: GapRow;
  left?: RowView;
  right?: RowView;
}

/**
 * The rows of a card, paired.
 *
 * Context appears on both sides, being the same line. A run of changed lines is
 * paired off in order — first deletion against first insertion — which is what
 * the forge does and what a reader expects: a line rewritten in place should
 * read across, not down. A run with more of one than the other leaves the short
 * side empty for the remainder.
 *
 * Worked out here rather than embedded a second time. A pair is a regrouping of
 * rows the card already has and says nothing new about them, so a host that
 * sent both readings would be sending every line of every card twice for the
 * one the reader is not in.
 */
export function pairRows(rows: readonly RowView[]): RowPair[] {
  const pairs: RowPair[] = [];

  for (let i = 0; i < rows.length; ) {
    const row = rows[i]!;

    if (row.kind === "gap") {
      pairs.push({ band: row });
      i++;
      continue;
    }
    // Anything that is neither a band nor a change is a line both sides have.
    if (row.kind !== "add" && row.kind !== "del") {
      pairs.push({ left: row, right: row });
      i++;
      continue;
    }

    const removed: RowView[] = [];
    const added: RowView[] = [];
    for (; i < rows.length; i++) {
      const next = rows[i]!;
      if (next.kind === "del") removed.push(next);
      else if (next.kind === "add") added.push(next);
      else break;
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const pair: RowPair = {};
      if (removed[k]) pair.left = removed[k];
      if (added[k]) pair.right = added[k];
      pairs.push(pair);
    }
  }

  return pairs;
}

/**
 * The lines behind a band, each carrying both of its numbers.
 *
 * A band stands for code neither side touched, so every line in it exists in
 * both checkouts and has a number in each. The host sends them with one: it
 * read the run out of the head of the change, and each row carries the number
 * it had there. That is enough for a single column of code and not enough for
 * two, where the base gutter of every revealed line came up empty — a card that
 * had been opened showed a blank column against a numbered one, which reads as
 * the two sides having lost step with each other.
 *
 * The missing number is not a guess. The band already carries the range it
 * covers on each side, because an arrow aimed at a folded line needs it, and an
 * unchanged run advances in lockstep: the distance between the two ranges is
 * the distance between the two numbers, for every line in it.
 *
 * Only lines that are in both checkouts are filled in. A band of untouched code
 * holds nothing else, but an import block collapsed into one can hold a real
 * insertion or removal, and giving a deleted line a number in the head would be
 * inventing a place it never had.
 */
export function bandRows(band: GapRow): RowView[] {
  const rows = band.rows;
  if (!rows) return [];

  const base = band.covers?.base;
  const head = band.covers?.head;
  if (!base || !head) return rows;

  // Only a run that is the same length on both sides advances in lockstep, and
  // only then is one number a fixed distance from the other.
  //
  // The two ranges are not arrived at the same way. A band's rows are read out
  // of the head of the change, so they carry a head number and no base one —
  // which means the head range is the rows' own span while the base range is
  // inferred from the numbering either side of the band. Those agree for a run
  // nobody touched and part company as soon as anything was inserted in it: the
  // head span is then longer, and a distance taken from the two starts runs the
  // last rows past the end of the base range and onto lines the card is already
  // showing below. The same source then appeared twice, at consecutive numbers,
  // which reads as eight distinct lines of a file that only has four.
  //
  // There is no honest way to place those rows: `covers` says how far the run
  // reaches on each side and not where inside it the insertion fell. So the
  // number is left off, which is what the gutter showed before any of this.
  if (base[1] - base[0] !== head[1] - head[0]) return rows;

  const offset = head[0] - base[0];
  const within = (line: number, range: [number, number]) =>
    line >= range[0] && line <= range[1];

  return rows.map((row) => {
    if (row.kind !== "ctx") return row;
    if (row.oldLine === undefined && row.newLine !== undefined) {
      const line = row.newLine - offset;
      return within(line, base) ? { ...row, oldLine: line } : row;
    }
    if (row.newLine === undefined && row.oldLine !== undefined) {
      const line = row.oldLine + offset;
      return within(line, head) ? { ...row, newLine: line } : row;
    }
    return row;
  });
}

/**
 * Which lines of a card an arrow touches, as `side:line`.
 *
 * Both ends of every edge, because a card is as much the thing pointed at as
 * the thing pointing: a definition nothing on this card calls is still the row
 * an arrow lands on, and it has to stay on screen for the arrow to mean
 * anything.
 */
export function anchorsFor(
  edges: readonly EdgeView[],
  nodeId: string,
): Set<string> {
  const anchored = new Set<string>();
  for (const edge of edges) {
    if (edge.from === nodeId) anchored.add(`${edge.fromSide}:${edge.fromLine}`);
    if (edge.to === nodeId) anchored.add(`${edge.toSide}:${edge.toLine}`);
  }
  return anchored;
}

/** Whether a row must stay on screen: the change made it, or an arrow needs it. */
export function held(row: RowView | undefined, anchored: Set<string>): boolean {
  if (!row || row.kind === "gap") return false;
  if (row.kind === "add" || row.kind === "del") return true;
  return (
    (row.oldLine !== undefined && anchored.has(`base:${row.oldLine}`)) ||
    (row.newLine !== undefined && anchored.has(`head:${row.newLine}`))
  );
}

/** A stretch of a line that is all one colour. */
export interface CodeRun {
  text: string;
  color?: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

/**
 * One line of code, as the fewest coloured stretches that say the same thing.
 *
 * A grammar emits a token per lexical unit — a name, the dot after it, the
 * space after that — and most neighbours land on the same colour, so a line
 * arrives as a dozen tokens and needs three spans. Whitespace never needs one
 * at all: there is nothing in a run of spaces for a colour to show, and leaving
 * it in whichever run it finds itself in lets the plain stretches either side
 * join up.
 *
 * The characters are the file's, untouched. That matters for more than looks:
 * the browser's own search still finds a string inside a card, and the width
 * the layout engine measured is still the width the line takes.
 */
export function runs(row: CodeRow): CodeRun[] {
  const tokens = row.tokens;
  if (!tokens || tokens.length === 0) {
    return [{ text: row.text, italic: false, bold: false, underline: false }];
  }

  const out: CodeRun[] = [];
  let text = "";
  let key: string | undefined;
  let style: CodeToken | undefined;

  const flush = () => {
    if (!text) return;
    const bits = style?.fontStyle ?? 0;
    out.push({
      text,
      color: style?.color,
      italic: (bits & 1) !== 0,
      bold: (bits & 2) !== 0,
      underline: (bits & 4) !== 0,
    });
    text = "";
  };

  for (const token of tokens) {
    // Whitespace joins whichever run it finds itself in.
    const blank = /^\s*$/.test(token.text);
    const next = blank ? key : `${token.color ?? ""}|${token.fontStyle ?? 0}`;
    if (next !== key) {
      flush();
      key = next;
      style = blank ? undefined : token;
    }
    text += token.text;
  }
  flush();

  return out;
}

/**
 * What a row is called, for as long as it is the same row.
 *
 * The line numbers are the name: they are what the row shows and they survive
 * everything that happens to the list around it. Keyed by position instead, a
 * rebuilt graph with one line inserted at the top renames every row below it,
 * and the browser throws away and rebuilds a card that did not change — which
 * on a large file is the whole point of rendering from data undone.
 *
 * A band has no number of its own, so it falls back to where it sits. Nothing
 * collides: a band and a line can never claim the same name.
 */
export function rowKey(row: RowView, index: number): string {
  if (row.kind === "gap") return `gap:${index}`;
  if (row.oldLine === undefined && row.newLine === undefined) return `at:${index}`;
  return `b${row.oldLine ?? ""}h${row.newLine ?? ""}`;
}

/** The same, for a row of a split card, which is named by both its panes. */
export function pairKey(pair: RowPair, index: number): string {
  if (pair.band) return `gap:${index}`;
  const left = pair.left && pair.left.kind !== "gap" ? pair.left.oldLine : undefined;
  const right = pair.right && pair.right.kind !== "gap" ? pair.right.newLine : undefined;
  if (left === undefined && right === undefined) return `at:${index}`;
  return `b${left ?? ""}h${right ?? ""}`;
}

/** What a card writes across its title bar. */
export interface CardTitle {
  name: string;
  was: string;
  stats: string;
  /** The same counts split, so the header can colour them like the diff. */
  additions: string;
  deletions: string;
  /**
   * Why this card has no arrows, when the reason is not "it has none".
   *
   * Shown because a bare card is otherwise indistinguishable from a file that
   * genuinely references nothing, and a reviewer who cannot tell them apart
   * will read a blind spot as a clean bill of health.
   */
  note: string;
}

/**
 * A card's heading, from whatever the host had to say about the file.
 *
 * The counts, the old name and the note come from the change, which the view
 * model does not carry per card — so they are handed in, and what is missing
 * falls back to what a placed node knows on its own. A file the diff never
 * touched says so rather than showing "+0 −0", which reads as though something
 * was removed and invites a second look at a file nothing happened to.
 */
export function cardTitle(node: NodeView, given?: Partial<CardTitle>): CardTitle {
  const additions = given?.additions ?? "";
  const deletions = given?.deletions ?? "";
  const counts = [additions, deletions].filter(Boolean).join(" ");

  return {
    name: given?.name ?? node.path.slice(node.path.lastIndexOf("/") + 1),
    was: given?.was ?? "",
    stats: given?.stats ?? (node.untouched ? "untouched" : counts),
    additions,
    deletions,
    note: given?.note ?? "",
  };
}
