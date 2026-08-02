/**
 * The Odin change-graph model.
 *
 * This file is the contract for everything else in the project: the diff parser
 * produces it, the layout engine consumes it, the exporters translate it, and
 * the webview renders it. It deliberately contains no behaviour and no imports
 * so that every package can depend on it.
 *
 * Design rules that callers may rely on:
 *  - Every collection is emitted in a deterministic order (see `sortGraph`).
 *  - Ids are derived from content, never from counters or randomness.
 *  - Nothing here is time-dependent unless the producer explicitly opts in.
 */

export const SCHEMA_VERSION = "0.1.0" as const;

/** How a file participates in the change set. */
export type FileStatus =
  /** Present in head, absent in base. */
  | "added"
  /** Present in both, contents differ. */
  | "modified"
  /** Present in base, absent in head. */
  | "deleted"
  /** Same content (or near enough) under a different path. */
  | "renamed"
  /** Not part of the diff at all; pulled in because an edge points at it. */
  | "phantom";

/**
 * Why a file does or does not have edges.
 *
 * Absence of arrows is ambiguous on its own — it could mean the change touches
 * nothing else, or that nothing was able to look. A reviewer has to be able to
 * tell those apart, so it is recorded rather than left to inference.
 */
export type ResolutionStatus =
  /** A resolver ran over this file's changed lines. */
  | "analysed"
  /** No resolver handles this language; the file has diff lines but no edges. */
  | "unsupported"
  /** Binary content; there is nothing to parse. */
  | "binary"
  /** Pulled in by an edge, never analysed in its own right. */
  | "untouched";

/** Which side of the comparison a position refers to. */
export type Side = "base" | "head";

/** The role a physical line plays inside a hunk. */
export type LineKind = "add" | "del" | "ctx";

/** Whether an edge exists only before, only after, or on both sides. */
export type EdgeChange = "added" | "removed" | "unchanged";

/** What kind of source-level relationship an edge represents. */
export type EdgeKind =
  | "call"
  | "import"
  | "type"
  | "instantiation"
  | "unknown";

/**
 * How much to trust an edge.
 *  - `resolved`  the language server named the target
 *  - `heuristic` matched by symbol name within the repo, plausibly right
 *  - `guess`     textual match only, may be wrong
 */
export type Confidence = "resolved" | "heuristic" | "guess";

/**
 * Identifier of the component that produced an edge.
 *  - `ts`   the TypeScript compiler API, running headlessly
 *  - `lsp`  a language server, via the editor
 */
export type ResolverId =
  | "ts"
  | "kotlin"
  | "lsp"
  | "tree-sitter"
  | "regex"
  | "manual";

/** One physical line inside a hunk. */
export interface DiffLine {
  kind: LineKind;
  /** Line content without the leading +/-/space marker, without newline. */
  text: string;
  /** 1-based line number in the base file; absent for added lines. */
  oldLine?: number;
  /** 1-based line number in the head file; absent for deleted lines. */
  newLine?: number;
  /**
   * Where this line sits on the side it does not exist on.
   *
   * An added line has no base-side line number, but it does have a base-side
   * position: the line it was inserted before. Recording it lets both gutters
   * stay populated down the whole card without inventing a line that never
   * existed — the number is a position, and renderers dim it to say so.
   */
  oldAnchor?: number;
  newAnchor?: number;
  /** True when git reported "\ No newline at end of file" for this line. */
  noNewline?: boolean;
}

/** A contiguous region of change, as emitted by `@@ -a,b +c,d @@`. */
export interface Hunk {
  /** Trailing text of the `@@` line, usually the enclosing symbol. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** A declaration discovered inside a file, used to anchor edges to symbols. */
export interface SymbolRef {
  /** Stable within its node: `s:<side>:<name>:<startLine>`. */
  id: string;
  name: string;
  /** LSP SymbolKind name, lowercased (`function`, `method`, `class`, ...). */
  kind: string;
  side: Side;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** Line the name itself sits on, for anchoring arrows. */
  selectionLine: number;
}

/** A file participating in the change graph. One vertex. */
export interface FileNode {
  /** `n:<sha1(path)[0..11]>`. Stable across runs and across PR revisions. */
  id: string;
  /** Head-side path, or base-side path when the file was deleted. */
  path: string;
  /** Base-side path; only set when `status === "renamed"`. */
  prevPath?: string;
  status: FileStatus;
  /** Best-effort language id, matching VS Code language ids where possible. */
  language: string;
  /** Git reported the blob as binary; `hunks` will be empty. */
  binary: boolean;
  stats: { additions: number; deletions: number };
  hunks: Hunk[];
  /** Populated by a resolver; empty until symbol information is available. */
  symbols: SymbolRef[];
  /** Whether anything was able to look for references in this file. */
  resolution?: ResolutionStatus;
  /** Matches this ecosystem's conventions for test code. */
  isTest?: boolean;
}

/** One end of an edge: a precise position inside a node. */
export interface Endpoint {
  nodeId: string;
  side: Side;
  /** 1-based line on `side`. */
  line: number;
  /** 0-based UTF-16 offset within the line, when known. */
  column?: number;
  /** `SymbolRef.id` of the enclosing (for `from`) or target (for `to`) symbol. */
  symbolId?: string;
  /** Human-readable symbol name, kept even when `symbolId` is unresolved. */
  symbolName?: string;
}

/** A reference from a call site to a definition. One directed edge. */
export interface Edge {
  /** `e:<sha1(from|to|kind)[0..11]>`. */
  id: string;
  from: Endpoint;
  to: Endpoint;
  change: EdgeChange;
  kind: EdgeKind;
  confidence: Confidence;
  resolver: ResolverId;
  /** Source text of the call site, trimmed. Shown on hover. */
  label?: string;
}

/** Provenance for the graph. Kept free of clocks unless explicitly stamped. */
export interface GraphMeta {
  /** Repository root path or remote URL, as supplied by the producer. */
  repo?: string;
  /** The ref the PR targets, e.g. `main`. */
  baseRef: string;
  /** The ref under review, e.g. `feature/x` or `HEAD`. */
  headRef: string;
  baseSha?: string;
  headSha?: string;
  /** Commit the diff was actually taken against (`git merge-base base head`). */
  mergeBase?: string;
  /** Tool and version that produced this document. */
  generator: string;
  /** ISO-8601. Opt-in only, since it breaks byte-for-byte reproducibility. */
  generatedAt?: string;
  /** What the resolvers could and could not reach. */
  coverage?: Coverage;
  /** Who wrote the commits in this range, most prolific first. */
  authors?: Author[];
  /** The pull request this branch belongs to, if one is open. */
  pullRequest?: PullRequest;
}

/** The forge's own record of the change under review. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  draft?: boolean;
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or absent. */
  reviewDecision?: string;
  /** Who has been asked to look, and what they have said so far. */
  reviewers?: Reviewer[];
}

/** Somebody asked to review the change, and where they have got to. */
export interface Reviewer {
  login: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, or `PENDING` for a request. */
  state: string;
  avatarUrl?: string;
  /** The forge's page for this account. */
  url: string;
  /** A team rather than a person; it has no face and no profile of its own. */
  team?: boolean;
}

/** An open pull request, as listed for choosing between. */
export interface PullRequestSummary extends PullRequest {
  /** Branch the pull request is built from. */
  branch: string;
  draft: boolean;
  author: string;
  /** ISO-8601, as the forge reports it. */
  createdAt: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or absent. */
  reviewDecision?: string;
}

/** One contributor to the change under review. */
export interface Author {
  name: string;
  commits: number;
}

/** A summary of how much of the change anything was able to analyse. */
export interface Coverage {
  analysed: number;
  unsupported: number;
  /** Languages present in the change, and whether a resolver handles each. */
  languages: LanguageCoverage[];
}

export interface LanguageCoverage {
  language: string;
  files: number;
  supported: boolean;
}

/** The whole document. This is what gets serialised to JSON. */
export interface ChangeGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  meta: GraphMeta;
  nodes: FileNode[];
  edges: Edge[];
}
