import type { ChangeGraph, Edge, FileNode, Hunk } from "../model/types.js";

/**
 * What happened to a change graph between two readings of it.
 *
 * A graph rebuilt from an unchanged working tree is a different object with
 * the same content, and treating every rebuild as news would mean redrawing
 * the page under a reader who pressed save on a file the diff does not even
 * touch. This says whether anything they could see actually moved, and what.
 */
export interface GraphDelta {
  /** Files now in the change that were not before. */
  added: string[];
  /** Files that have dropped out of it — reverted, or committed away. */
  removed: string[];
  /** Files still in it whose lines are not the lines they were. */
  changed: string[];
  /** References the resolvers found this time and not last time. */
  edgesAdded: string[];
  /** References that are no longer there. */
  edgesRemoved: string[];
}

/** Nothing a reader could see has moved. */
export function unchanged(delta: GraphDelta): boolean {
  return (
    delta.added.length === 0 &&
    delta.removed.length === 0 &&
    delta.changed.length === 0 &&
    delta.edgesAdded.length === 0 &&
    delta.edgesRemoved.length === 0
  );
}

/**
 * A file's contribution to the picture, as one string.
 *
 * Only the parts a reader is looking at. `symbols` and `resolution` are a
 * resolver's working notes and can differ between two runs over identical
 * bytes; including them would report a change on every rebuild and make the
 * whole comparison pointless. Hunk headers and line text are in, because a
 * moved line is exactly the thing this is meant to notice.
 */
function fingerprint(node: FileNode): string {
  return JSON.stringify([
    node.path,
    node.prevPath ?? "",
    node.status,
    node.binary,
    node.stats.additions,
    node.stats.deletions,
    node.hunks.map((hunk) => [
      hunk.header,
      hunk.oldStart,
      hunk.oldLines,
      hunk.newStart,
      hunk.newLines,
      hunk.lines.map((line) => [line.kind, line.text]),
    ]),
  ]);
}

/**
 * An edge's identity for this purpose.
 *
 * The id already hashes the two ends and the kind, but not the lines they sit
 * on: a call that has slid down the file because something was inserted above
 * it keeps its id and is drawn somewhere new. That is a change worth
 * redrawing for, so the line numbers are part of the comparison.
 */
function edgeKey(edge: Edge): string {
  return [
    edge.id,
    edge.from.nodeId,
    edge.from.line,
    edge.to.nodeId,
    edge.to.line,
    edge.change,
    edge.confidence,
  ].join("|");
}

/**
 * What changed between two graphs.
 *
 * Compared by node id rather than by path, so a rename is one file that
 * changed rather than one that vanished and another that appeared — the id is
 * derived from the head-side path and survives the move.
 */
export function graphDelta(
  before: ChangeGraph | undefined,
  after: ChangeGraph,
): GraphDelta {
  const delta: GraphDelta = {
    added: [],
    removed: [],
    changed: [],
    edgesAdded: [],
    edgesRemoved: [],
  };

  // Nothing to compare against: the first graph is not news, it is the graph.
  // Reporting every file in it as added would make the first build look like
  // the largest change that had ever happened.
  if (!before) return delta;

  const was = new Map(before.nodes.map((n) => [n.id, fingerprint(n)]));
  for (const node of after.nodes) {
    const previous = was.get(node.id);
    if (previous === undefined) delta.added.push(node.id);
    else if (previous !== fingerprint(node)) delta.changed.push(node.id);
    was.delete(node.id);
  }
  delta.removed = [...was.keys()];

  const edges = new Map(before.edges.map((e) => [e.id, edgeKey(e)]));
  for (const edge of after.edges) {
    const previous = edges.get(edge.id);
    // A reference that has moved to a different line is drawn somewhere new,
    // which for a page that has to redraw it is the same as a new one.
    if (previous === undefined || previous !== edgeKey(edge)) {
      delta.edgesAdded.push(edge.id);
    }
    edges.delete(edge.id);
  }
  delta.edgesRemoved = [...edges.keys()];

  return delta;
}

/**
 * Where a line's comment starts, or the end of the line when it has none.
 *
 * Quote-aware, because `"http://x"` is not a comment and cutting there would
 * hide the rest of the line from the comparison below — which is the one way
 * this could wave through an edit that matters. Escapes are honoured so that
 * `"a\"//b"` is one string rather than two.
 *
 * Only the marker each language actually uses. A language nothing is known
 * about gets no stripping at all, which costs a fast path and never a wrong
 * one.
 */
const COMMENT: Record<string, readonly string[]> = {
  typescript: ["//"], typescriptreact: ["//"], javascript: ["//"],
  javascriptreact: ["//"], kotlin: ["//"], java: ["//"], go: ["//"],
  rust: ["//"], c: ["//"], cpp: ["//"], csharp: ["//"], swift: ["//"],
  scala: ["//"], php: ["//", "#"], python: ["#"], ruby: ["#"], shell: ["#"],
  shellscript: ["#"], yaml: ["#"], toml: ["#"], sql: ["--"], clojure: [";"],
};

function codePart(line: string, language: string): string {
  const markers = COMMENT[language];
  if (!markers) return line;

  let quote = "";
  for (let at = 0; at < line.length; at++) {
    const ch = line[at]!;
    if (quote) {
      if (ch === "\\") at++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    for (const marker of markers) {
      if (line.startsWith(marker, at)) return line.slice(0, at);
    }
  }
  return line;
}

/**
 * The names on a line, as a sorted list.
 *
 * An identifier is the only thing a resolver can bind, so two versions of a
 * line carrying the same identifiers ask the same questions and get the same
 * answers — whatever happened to the numbers, the punctuation and the prose
 * between them. Taken from the whole code part rather than parsed, string
 * literals included: an import path that changed is an identifier that changed,
 * which is exactly the case that has to be noticed.
 */
function names(line: string, language: string): string[] {
  return (codePart(line, language).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).sort();
}

/** Two hunks covering the same lines, whatever those lines now say. */
function sameShape(before: Hunk, after: Hunk): boolean {
  return (
    before.oldStart === after.oldStart &&
    before.oldLines === after.oldLines &&
    before.newStart === after.newStart &&
    before.newLines === after.newLines &&
    before.lines.length === after.lines.length &&
    before.lines.every((line, at) => {
      const now = after.lines[at]!;
      return (
        line.kind === now.kind &&
        line.oldLine === now.oldLine &&
        line.newLine === now.newLine
      );
    })
  );
}

/**
 * Whether one file's rows are the only thing that moved.
 *
 * Everything else about the node has to be identical — the same hunks covering
 * the same line numbers, the same kind of line in each position — so that not
 * one anchor in the drawing has shifted. Then each line that reads differently
 * has to read differently only in ways nothing can resolve: same identifiers on
 * the code part of the line, so no reference appeared, none went away, and
 * nothing was renamed.
 */
function onlyRows(before: FileNode, after: FileNode): boolean {
  if (
    before.path !== after.path ||
    before.prevPath !== after.prevPath ||
    before.status !== after.status ||
    before.binary !== after.binary ||
    before.language !== after.language ||
    before.stats.additions !== after.stats.additions ||
    before.stats.deletions !== after.stats.deletions ||
    before.hunks.length !== after.hunks.length
  ) {
    return false;
  }

  for (let at = 0; at < before.hunks.length; at++) {
    const was = before.hunks[at]!;
    const now = after.hunks[at]!;
    // The header names the enclosing declaration. A different one means the
    // shape of the file changed under the hunk, whatever the hunk says.
    if (was.header !== now.header || !sameShape(was, now)) return false;

    for (let line = 0; line < was.lines.length; line++) {
      const old = was.lines[line]!;
      const fresh = now.lines[line]!;
      if (old.text === fresh.text) continue;
      const wasNames = names(old.text, before.language);
      const nowNames = names(fresh.text, after.language);
      if (wasNames.length !== nowNames.length) return false;
      if (wasNames.some((name, i) => name !== nowNames[i])) return false;
    }
  }

  return true;
}

/**
 * Which cards a rebuild has to redraw, when it can get away with only that.
 *
 * The expensive half of a build is resolving every reference and reading the
 * blobs behind the gaps; both are wasted on an edit that cannot have changed a
 * single arrow. This answers whether that is the situation, and if so names the
 * files whose rows are now different — which is all a rebuild has to touch.
 *
 * Deliberately unforgiving. Anything it is not certain about, it refuses: an
 * inserted line moves every anchor below it, a renamed symbol breaks a link,
 * and a new import makes one. All of those come back `undefined`, which means
 * the whole build, because the alternative is a picture that is quietly wrong.
 */
export function rowsOnly(
  before: ChangeGraph | undefined,
  after: ChangeGraph,
): string[] | undefined {
  if (!before) return undefined;

  // A commit, a rebase or a change of base moves what the diff is measured
  // against, and with it every blob behind every gap.
  if (
    before.meta.baseSha !== after.meta.baseSha ||
    before.meta.headSha !== after.meta.headSha ||
    before.meta.mergeBase !== after.meta.mergeBase ||
    before.meta.baseRef !== after.meta.baseRef ||
    before.meta.headRef !== after.meta.headRef
  ) {
    return undefined;
  }

  // Nodes the resolvers invented are not in a fresh diff and are not compared
  // here; they are carried over untouched, along with the arrows that reach
  // them, which is only sound because nothing below moved.
  const was = new Map(
    before.nodes.filter((n) => n.status !== "phantom" && n.kind !== "database")
      .map((n) => [n.id, n]),
  );
  if (was.size !== after.nodes.length) return undefined;

  const touched: string[] = [];
  for (const node of after.nodes) {
    const previous = was.get(node.id);
    if (!previous) return undefined;
    if (!onlyRows(previous, node)) return undefined;
    if (fingerprint(previous) !== fingerprint(node)) touched.push(node.id);
  }

  return touched;
}

/**
 * Which files this reading does not have the way the last one had them.
 *
 * Broader and much cheaper than `rowsOnly`, and asked for a different reason.
 * `rowsOnly` answers "may the expensive half be skipped entirely"; this answers
 * "which cards can I not vouch for until it has run" — the files that are new,
 * and the files whose lines have moved. Every arrow with an end in one of them
 * is drawn from line numbers that may no longer mean anything, which is why
 * something showing a diff before the resolver has caught up needs this list.
 */
export function movedNodes(
  before: ChangeGraph | undefined,
  after: ChangeGraph,
): string[] {
  if (!before) return after.nodes.map((node) => node.id);

  const was = new Map(before.nodes.map((n) => [n.id, fingerprint(n)]));
  return after.nodes
    .filter((node) => was.get(node.id) !== fingerprint(node))
    .map((node) => node.id);
}

/** The delta as a line a person would read, or nothing when it is empty. */
export function describeDelta(delta: GraphDelta): string {
  const parts: string[] = [];
  const say = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };

  say(delta.added.length, "file added", "files added");
  say(delta.removed.length, "file gone", "files gone");
  say(delta.changed.length, "file changed", "files changed");
  // The two edge counts are said as one number. A reader watching a graph
  // redraw wants to know that the arrows moved, not the arithmetic of it.
  const references = delta.edgesAdded.length + delta.edgesRemoved.length;
  say(references, "reference moved", "references moved");

  return parts.join(", ");
}
