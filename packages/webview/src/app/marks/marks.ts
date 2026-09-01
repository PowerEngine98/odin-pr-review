import { saidOf } from "../pictures.js";

import type { CommentView } from "../model.js";

/**
 * The arithmetic behind the marks in the margin.
 *
 * None of it touches the document or the reactive state, which is the point:
 * a mark is placed from screen coordinates, and screen coordinates are the one
 * thing in this application that cannot be reasoned about by reading the code
 * — they come out of a measurement. What is left once the measuring is taken
 * out is a handful of sums about where a face goes and which lines a remark
 * covers, and those are answerable at a desk and checkable in a test.
 *
 * The other half of what lives here is for the card rather than for the marks.
 * A commented line wears a bracket in its margin and a card's header wears a
 * tally, and both are facts about the comments; but the rows and the header
 * belong to the card, and the card is the wrong place to work out what the
 * comments say. It asks here and decorates itself.
 */

/** Which checkout a line belongs to, as a card's rows spell it. */
export type Side = "base" | "head";

/**
 * The side, however the thing that said it spells the word.
 *
 * The forge answers with LEFT and RIGHT, a draft written in this page carries
 * base and head, and the rows of a card are keyed by the second pair. Both
 * arrive in the same functions here, and a comparison against one spelling
 * quietly put every remark from the forge on the head side — which is right
 * far more often than not, so it read as an occasional off-by-a-file rather
 * than as a bug.
 */
export function sideOf(side: string): Side {
  return side === "LEFT" || side === "base" ? "base" : "head";
}

/** What a line is called when it is a key rather than a position. */
export function lineKey(path: string, side: Side, line: number): string {
  return `${path}|${side}|${line}`;
}

/** A passage of one file, on one side of the change. */
export interface Span {
  path: string;
  side: Side;
  start: number;
  end: number;
}

/**
 * The lines a remark is about.
 *
 * The forge hangs a multi-line comment off its last line and carries the first
 * one separately, and only when the two differ. A remark on a single line has
 * a start equal to its end rather than a missing one, so everything downstream
 * can loop from one to the other without asking which kind it is.
 */
export function spanOf(comment: {
  path: string;
  side: string;
  line: number;
  startLine?: number;
}): Span {
  const start =
    comment.startLine && comment.startLine < comment.line
      ? comment.startLine
      : comment.line;
  return { path: comment.path, side: sideOf(comment.side), start, end: comment.line };
}

/** Whether a passage reaches a particular line of a particular file. */
export function covers(
  span: Span | null,
  path: string,
  side: Side,
  line: number,
): boolean {
  if (!span) return false;
  return (
    span.path === path && span.side === side && line >= span.start && line <= span.end
  );
}

/* ------------------------------------------------------------ the card's own */

/**
 * How much has been said about each file, keyed by path.
 *
 * Every remark counts, replies included: the tally answers "how much
 * conversation is on this file", and a thread of six that shows as one is a
 * card the reader walks past. Counted per comment rather than per conversation
 * because the two give the same answer — a reply is on the same line of the
 * same file as the remark it answers — and counting per comment does not need
 * the comments grouped, which is somebody else's job and already done once.
 */
export function remarkCounts(comments: readonly CommentView[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const comment of comments) {
    totals[comment.path] = (totals[comment.path] ?? 0) + 1;
  }
  return totals;
}

/**
 * The conversation to open when a card's own remarks button is pressed.
 *
 * The first remark on the file that is not an answer to another one. Asked for
 * by id because that is what opening a conversation is: the thread derives
 * itself from the comments, and a caller holding a copy of one holds something
 * that is wrong as soon as anybody replies.
 *
 * A reply whose parent is not in the list counts as a beginning, which is the
 * same rule the grouping uses. Without it a page showing a fragment of a
 * conversation — everything after a remark that was deleted — has a mark in
 * the margin that nothing can open.
 */
export function firstThreadOn(
  comments: readonly CommentView[],
  path: string,
): string | null {
  const present = new Set(comments.map((comment) => comment.id));
  for (const comment of comments) {
    if (comment.path !== path) continue;
    if (!comment.inReplyTo || !present.has(comment.inReplyTo)) return comment.id;
  }
  return null;
}

/** A remark that has been written and not yet sent. */
export interface Draft {
  path: string;
  side: string;
  line: number;
  startLine?: number;
  body: string;
  author?: string;
}

/** What a row wears because something has been said about it. */
export interface RowMark {
  /** A remark on the forge covers this line. */
  commented: boolean;
  /** Something unsent covers it. */
  drafted: boolean;
  /** The first and last lines of a passage, so the margin draws one bracket. */
  start: boolean;
  end: boolean;
  /**
   * The badge on the first row, and what it says on hover. Empty unless a
   * draft is involved: a remark already on the pull request has a mark of its
   * own out in the margin, so the row keeps the bracket saying which lines are
   * being discussed and gives the badge up. A draft exists nowhere else yet.
   */
  badge: string;
  hint: string;
}

interface Passage {
  span: Span;
  drafted: boolean;
  said: string[];
}

/**
 * Every line something has been said about, and what it should wear.
 *
 * Grouped by the exact passage rather than by line, so two remarks on the same
 * lines share one badge while two on overlapping passages stay separate — the
 * alternative reads as a single conversation about a stretch of code that two
 * people are in fact discussing from different ends.
 *
 * A remark about the file itself belongs to no line and is left out. There is
 * nothing to bracket, and the card's own tally is where it shows.
 */
export function commentedRows(
  comments: readonly CommentView[],
  drafts: readonly Draft[] = [],
): Map<string, RowMark> {
  const passages = new Map<string, Passage>();

  const add = (
    remark: { path: string; side: string; line: number; startLine?: number; body: string },
    author: string,
    draft: boolean,
  ) => {
    if (remark.line === undefined) return;
    const span = spanOf(remark);
    const key = `${span.path}|${span.side}|${span.start}|${span.end}`;
    const where = span.start === span.end ? String(span.end) : `${span.start}–${span.end}`;
    const passage = passages.get(key) ?? { span, drafted: false, said: [] };
    passage.drafted = passage.drafted || draft;
    passage.said.push(`${author} (${where}): ${saidOf(remark.body)}`);
    passages.set(key, passage);
  };

  for (const comment of comments) {
    if (comment.wholeFile) continue;
    add(comment, comment.author || "?", false);
  }
  for (const draft of drafts) add(draft, draft.author ?? "you", true);

  const rows = new Map<string, RowMark>();
  for (const passage of passages.values()) {
    const { span } = passage;
    for (let line = span.start; line <= span.end; line++) {
      const key = lineKey(span.path, span.side, line);
      const mark = rows.get(key) ?? {
        commented: false,
        drafted: false,
        start: false,
        end: false,
        badge: "",
        hint: "",
      };
      // Overlapping passages share their lines, and a line covered by both a
      // sent remark and an unsent one is both: the reader is owed the colour
      // that says they still have something to post.
      mark.commented = mark.commented || !passage.drafted;
      mark.drafted = mark.drafted || passage.drafted;
      // Only a passage of more than one line has ends worth drawing; a bracket
      // around a single row is a bracket that is all corners.
      if (span.end > span.start) {
        mark.start = mark.start || line === span.start;
        mark.end = mark.end || line === span.end;
      }
      if (passage.drafted && line === span.start) {
        mark.badge = passage.said.length > 1 ? String(passage.said.length) : "";
        mark.hint = passage.said.join("\n\n");
      }
      rows.set(key, mark);
    }
  }
  return rows;
}

/**
 * The lines the open conversation is about.
 *
 * The bracket in the margin says where a remark starts and stops, which is
 * enough while reading and not enough while answering: the reader is looking
 * for the lines, and a mark four pixels wide is not the answer. The card
 * washes them instead, and the bands between them, which is why this is a
 * passage rather than a set of line numbers — a run of untouched code folded
 * into a band has no line number of its own for anybody to match on.
 *
 * Found by id without grouping anything: what a conversation is filed under is
 * the id of the remark that began it, so the comment with that id is its root.
 */
export function discussedSpan(
  comments: readonly CommentView[],
  openId: string | null,
): Span | null {
  if (!openId) return null;
  const root = comments.find((comment) => comment.id === openId);
  // A remark about the file is about no line, and washing the whole card would
  // say the opposite of what the reader asked.
  if (!root || root.wholeFile) return null;
  return spanOf(root);
}

/* ------------------------------------------------------------- the mark itself */

/**
 * How big a mark is drawn, at a given zoom.
 *
 * Between a legible minimum and a face rather than a portrait. Reading a
 * change closely is when a picture is worth its size; at the zoom a whole
 * change is taken in at, the mark is a dot beside a file and should stay one.
 * It does not scale with the canvas at all — a face drawn at a tenth of its
 * size is not a face, and a target seven pixels across is not a target.
 */
export function markSize(scale: number): number {
  return Math.max(26, Math.min(76, Math.round(28 * scale)));
}

/**
 * How far a mark stands off the card it belongs to.
 *
 * Room for the tail and a gap after it, measured from the mark's own size: a
 * fixed eight pixels was a clear margin on a small mark and no margin at all
 * on a large one, where the tail reached the card.
 */
export function reachOf(size: number): number {
  return Math.round(size * 0.31) + 10;
}

/**
 * What the mark says on hover: who spoke, and the beginning of what they said.
 *
 * A tooltip is text and cannot draw a picture, so a remark that carries one has
 * it said rather than spelled out — the alternative was a hundred and twenty
 * characters of temporary directory hanging off a face in the margin.
 */
export function hintOf(root: CommentView): string {
  return `${root.author || "?"}: ${saidOf(root.body || "").slice(0, 120)}`;
}

/** The screen, as far as a mark is concerned. */
export interface Room {
  /** How far down the chrome reaches; above it the mark is behind the bar. */
  ceiling: number;
  width: number;
  height: number;
}

export interface Spot {
  left: number;
  top: number;
}

/**
 * Where a mark goes, or nothing when it is not on screen at all.
 *
 * To the left of the file, because arrows leave a card on its right and a mark
 * over that traffic is both hard to see and hard to click.
 *
 * The ones that fall outside the window are dropped rather than placed and
 * hidden. A change carries hundreds of remarks and a reader looks at four
 * cards at a time; the rest are faces the browser would lay out, load pictures
 * for and composite, every frame of every pan, to put them somewhere nobody
 * can look.
 */
export function placeMark(
  card: { left: number; right: number },
  y: number,
  size: number,
  room: Room,
): Spot | null {
  if (y < room.ceiling || y > room.height) return null;
  if (card.right < 0 || card.left > room.width) return null;
  return {
    left: Math.round(card.left - size - reachOf(size)),
    top: Math.round(y - size / 2),
  };
}
