/**
 * The view model the extension embeds in the page.
 *
 * This is the contract between the host and the application: the layout engine
 * and the syntax highlighter both run in the extension, where they have the
 * repository and a compiler to hand, and what crosses into the webview is
 * their answer as plain data. Nothing here is computed in the browser except
 * where a real measurement is needed.
 *
 * Positions are in canvas units. The canvas is one transformed layer, so a
 * card's `x`/`y` never change with pan or zoom — only the layer's transform
 * does.
 */

// Type-only, and therefore erased before anything runs: the row shapes are
// defined beside the code that draws them, and naming them here is what makes
// the host's payload and the card's props the same thing rather than two
// descriptions of it that drift.
import type { CardTitle, RowView } from "./canvas/rows.js";

/** A file's card, placed. */
export interface NodeView {
  id: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Which column the card belongs to. Cards are centred within a column, so
   * two in the same one rarely share an x — comparing x to decide what moves
   * together leaves the odd-width cards behind, and they collide.
   */
  column: number;
  isTest: boolean;
  /** For colouring a suggestion in a comment; the card knows it, a path does not. */
  language: string;
  /** In the picture only because something points at it. */
  untouched: boolean;
  status: string;
  /**
   * What this vertex stands for.
   *
   * A file, unless something assembled it. The database vertex is a drawing of
   * a schema rather than a thing on disk. The settings menu needs this to
   * decide for itself whether to offer the database switch — a control for
   * something the change does not have teaches the reader nothing.
   */
  kind?: "file" | "database";
  /**
   * The diff, as rows, already coloured.
   *
   * The grammar runs in the extension, where a compiler and the repository are
   * to hand; what crosses is its answer. Every row is sent, including the ones
   * behind the "show N more lines" bar — expanding is then revealing what is
   * already here rather than asking the host for it, and a reader who opens a
   * band is not waiting on a round trip to read three lines.
   */
  rows?: RowView[];
  /**
   * What the change says about this file: its counts, the name it had, and why
   * nothing could be read from it. Beside the placed node rather than on it,
   * because a placement is geometry and this is not.
   */
  title?: Partial<CardTitle>;
  /**
   * How many rows this card shows before the bar, per reading.
   *
   * Each mode caps its own card: a split card is shorter, having put pairs of
   * lines on one row, so the two disagree about how much is behind the bar.
   * Both are the layout engine's numbers — a card that worked out its own cap
   * would be measuring in a browser what was measured in the extension, and
   * the arrows are placed against the extension's answer.
   */
  splitCap?: number;
  unifiedCap?: number;
  /**
   * Drawn as one column of code rather than two. A file that exists on one
   * side only has one text to show, and a schema is not a diff at all.
   */
  single?: boolean;
}

/** One reference, from a line in one file to a line in another. */
export interface EdgeView {
  id: string;
  from: string;
  to: string;
  fromPath: string;
  toPath: string;
  fromLine: number;
  toLine: number;
  /** Which checkout each end lives in: a removed reference points at the base. */
  fromSide: "base" | "head";
  toSide: "base" | "head";
  change: string;
  kind: string;
  confidence: string;
  symbol: string;
  /**
   * What the far end is called here, when the two ends spell it differently.
   * Generated code says `ACCOUNT` for a table called `account`, and the mark
   * has to sit on the word that is written.
   */
  fromSymbol: string;
  label: string;
}

/** Where every card sits in one arrangement of the drawing. */
export interface Arrangement {
  width: number;
  height: number;
  nodes: Record<
    string,
    { x: number; y: number; width: number; height: number; column: number }
  >;
}

/**
 * The four arrangements a page carries.
 *
 * Tests can be hidden and the diff can be read split or unified, and each
 * combination is a different set of card sizes — so each is laid out by the
 * engine rather than guessed at in the browser.
 */
export interface Arrangements {
  withTests: Arrangement;
  withoutTests: Arrangement;
  otherWithTests?: Arrangement;
  otherWithoutTests?: Arrangement;
}

/** A group of files that reach each other, named for the tab strip. */
export interface PartView {
  id: string;
  nodes: string[];
  /**
   * What the strip calls it: the file the chain starts at.
   *
   * Sent rather than worked out in the browser. The id happens to be that
   * node's id today, so a tab could derive its own name from it — but that is
   * a convention of how parts are built, not a promise, and a strip that
   * silently loses its labels when the convention changes is worse than one
   * that is told.
   */
  label?: string;
}

/**
 * The forge's own facts about the change, for the bar across the top.
 *
 * Separate from the drawing: none of it places anything, and a page rendered
 * for a branch with no pull request behind it has a bar with a ref pair in it
 * and nothing else.
 */
export interface MetaView {
  baseRef: string;
  headRef: string;
  authors?: { name: string; commits: number }[];
  pullRequest?: {
    number: number;
    title: string;
    url: string;
    draft?: boolean;
    reviewDecision?: string;
    /**
     * Who has been asked to look, and what they have said so far.
     *
     * A webview refuses a remote image, so each face travels inside the
     * document as a data URI the host has already inlined. A team has no face
     * and no profile of its own.
     */
    reviewers?: {
      login: string;
      state: string;
      avatarUrl?: string;
      url: string;
      team?: boolean;
    }[];
  };
  /** The head of the diff is the working tree, so it carries uncommitted work. */
  worktree?: boolean;
}

export interface CommentView {
  id: string;
  path: string;
  line: number;
  startLine: number;
  side: string;
  body: string;
  author: string;
  avatar?: string;
  createdAt: string;
  inReplyTo?: string;
  reactions?: unknown;
  url: string;
  outdated: boolean;
  wholeFile?: boolean;
}

/**
 * Everything the page is drawn from.
 *
 * Replaced wholesale when the working tree changes and the graph is rebuilt.
 * That is the point of holding it in one place: the components that read a
 * field are the ones that redraw, and everything else — the reader's camera,
 * their scroll, an open thread — is untouched because nothing was thrown away
 * to apply it.
 */
export interface ViewModel {
  width: number;
  height: number;
  rowGap: number;
  /** The width of one character, for placing a mark without measuring text. */
  charWidth: number;
  /**
   * Where a row's first character sits: marker column, base number, padding,
   * and the strip between the numbers and the code that a row's picking marks
   * are drawn in.
   */
  textLeft: number;
  padding: number;
  gutterWidth: number;
  columnGap: number;
  margin: number;
  nodes: NodeView[];
  edges: EdgeView[];
  parts: PartView[];
  meta: MetaView;
  arrangements: Arrangements;
  unified: boolean;
  checks?: unknown;
  canReview: boolean;
  /** What a half-written review is filed under between page loads. */
  review: string;
  viewer: string;
  viewerFace: string;
  comments: CommentView[];
}

declare global {
  interface Window {
    __ODIN__: ViewModel;
  }
}
