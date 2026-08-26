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
    /** `OPEN`, `MERGED` or `CLOSED`, as the forge last said. */
    state?: string;
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
  /**
   * Written here and nowhere else.
   *
   * A conversation with an agent is working out what to do, not a review of
   * what was done, so the forge is never told about it. Drawn the same way as
   * everything else on purpose — a conversation about a passage is one
   * conversation — and marked rather than separated.
   */
  local?: boolean;
  /** The agent that wrote it, when an agent did. */
  agent?: string;
  /** How the work this message asked for is going. */
  task?: "queued" | "working" | "done" | "failed" | "asking" | "stopped";
  /**
   * A decision this remark is waiting on.
   *
   * In the thread rather than in a dialogue, so that what was asked, what was
   * decided and what happened next are one record. A modal settles the same
   * question and leaves nothing behind.
   */
  approval?: { id: string; what: string; state: "waiting" | "allowed" | "denied" };
}

/**
 * A coding agent this machine can run, as the panel shows it.
 *
 * Sent by the host rather than worked out here: whether a tool is installed is
 * a fact about the machine, and the page has no way to ask. Absent entirely
 * until the host has looked, which is not the same as an empty list — one means
 * "not asked yet" and the other means "asked, and there are none".
 */
export interface AgentView {
  id: string;
  name: string;
  /** Whatever the tool said when asked, for the hover. Often empty. */
  version: string;
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
  /** How the change stands against being merged, as the forge sees it. */
  merging?: unknown;
  /**
   * The agents this machine can run, once the host has looked.
   *
   * Undefined means it has not looked yet, which the panel draws as a wait.
   * An empty array means it looked and found none, which is a different thing
   * to say and a different thing to do about it.
   */
  agents?: AgentView[];
  canReview: boolean;
  /** What a half-written review is filed under between page loads. */
  review: string;
  viewer: string;
  viewerFace: string;
  comments: CommentView[];
  /**
   * How the last reader had the page set up, if the host remembered.
   *
   * A partial on purpose: what the host has stored is whatever it was told, and
   * a setting added later has nothing on disk under its name. Each one falls
   * back to its own default rather than the whole set being taken or dropped
   * together.
   */
  settings?: Partial<ReaderSettings>;
}

/** The reader's own choices about how to read, not about what is being read. */
export interface ReaderSettings {
  unified: boolean;
  showTests: boolean;
  showImports: boolean;
  showUnchanged: boolean;
  hideViewed: boolean;
  showInfra: boolean;
  hud: {
    reviewers: boolean;
    comments: boolean;
    map: boolean;
    checks: boolean;
    /** The checks panel folded to its head, as opposed to hidden altogether. */
    checksFolded: boolean;
    /** The pairing panel, which only ever appears over a live reading. */
    agents: boolean;
    agentsFolded: boolean;
  };
  /**
   * Which agents the reader has switched on, in the order they take work.
   *
   * An array rather than a set of flags, because the order is the whole of the
   * priority rule: the first one that is idle takes the next message. An id
   * naming a tool that is no longer installed is kept rather than dropped —
   * somebody who uninstalls a tool for an afternoon should not come back to
   * their ordering rearranged.
   */
  pairing?: string[];
  /**
   * Whose terminal is open.
   *
   * Kept with the rest of the reader's choices rather than only in the page,
   * because a window reload is not a decision to stop watching. The session
   * itself lives in the host and is asked for when a terminal appears.
   */
  terminals?: string[];
  /**
   * How much each agent may do without being asked, by agent id.
   *
   * Per agent rather than one switch for all of them, because the useful
   * setting is rarely the same for each: the tool doing the editing wants to
   * edit, and the one being asked to look something up does not need to touch
   * anything. Absent means the default, which the host decides.
   */
  agency?: Record<string, "read" | "ask" | "edits" | "full">;
  /**
   * How big the terminals are, once somebody has dragged one.
   *
   * One size for all of them rather than one each: they are stacked in a
   * column against the same edge, and terminals of differing widths would be a
   * ragged edge down the side of the drawing. Dragging any of them is a
   * statement about how much room a log needs, which is the same statement
   * whichever one is under the pointer.
   */
  terminalWidth?: number;
  terminalHeight?: number;
  /**
   * Terminals folded to their head.
   *
   * Kept apart from which are open, because they are different questions: a
   * folded terminal is still being watched — the reader wants to know the agent
   * is there and what it may do — they simply do not want its log taking half
   * the drawing while they read the code it is about.
   */
  terminalsFolded?: string[];
  /**
   * Diagrams the reader pinned to the drawing, by which reading they belong to.
   *
   * An agent asked how something is put together answers with a picture, and
   * the picture belongs next to the thing it is about rather than at the bottom
   * of a log that scrolls. Dropping one on the canvas keeps it: it is pinned in
   * the drawing's own coordinates, so it stays where it was put whatever the
   * reader does to the camera, and it stays until they throw it away.
   *
   * The source rather than the drawing. Mermaid is a few lines of text and the
   * SVG it becomes is not — and a picture stored as text redraws itself at
   * whatever size and theme the reader is in when they come back.
   *
   * Filed under the reading rather than kept in one list, because a picture
   * dropped beside a card is about the change it was dropped on. One list meant
   * the diagrams from one pull request turning up over the cards of the next.
   */
  diagrams?: Record<string, PinnedDiagram[]>;
}

/** One pinned drawing: what it says, where it is, and how big. */
export interface PinnedDiagram {
  /** Ours, so two identical drawings are still two drawings. */
  id: string;
  /** The mermaid source, exactly as the agent wrote it. */
  code: string;
  /** In the drawing's coordinates, not the window's. */
  x: number;
  y: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __ODIN__: ViewModel;
  }
}
