import {
  cardTitle,
  differs,
  type ChangeGraph,
  type Edge,
  type FileNode,
  type LocalBranch,
  type PullRequestSummary,
} from "@odin/core";

import type {
  ChangeView,
  FileView,
  FolderView,
  PickerView,
  PullView,
  Query,
  RefView,
} from "./sidebar-model.js";

/** Files that moved since a reading the reader has already seen. */
export interface Fresh {
  paths: string[];
  means: "uncommitted" | "review";
}

/** A directory in the change, holding files and further directories. */
export interface Folder {
  /** Path segments this folder covers, joined for display. */
  label: string;
  folders: Folder[];
  files: FileNode[];
}

/**
 * Groups the changed files by directory, the way the project is laid out.
 *
 * Chains of directories with nothing else in them are joined into one row —
 * `src/main/kotlin/com/example/notifications` rather than six nested rows each
 * holding a single child. Without that, a Java-shaped tree spends most of its
 * width on indentation before reaching a file name.
 */
export function buildTree(nodes: readonly FileNode[]): Folder {
  const root: Folder = { label: "", folders: [], files: [] };

  for (const node of nodes) {
    const segments = node.path.split("/");
    const fileName = segments.pop()!;
    void fileName;

    let folder = root;
    for (const segment of segments) {
      let next = folder.folders.find((f) => f.label === segment);
      if (!next) {
        next = { label: segment, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(node);
  }

  compact(root);
  sortFolders(root);
  return root;
}

/**
 * Orders directories by name so the shape of the sidebar depends on the
 * project rather than on which file the diff happened to mention first.
 * Files keep the graph's order, which is already by path.
 */
function sortFolders(folder: Folder): void {
  folder.folders.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  for (const child of folder.folders) sortFolders(child);
}

/** Joins a folder with its only child when nothing else lives beside it. */
function compact(folder: Folder): void {
  for (const child of folder.folders) compact(child);

  while (
    folder.files.length === 0 &&
    folder.folders.length === 1 &&
    folder.label !== ""
  ) {
    const only = folder.folders[0]!;
    folder.label = `${folder.label}/${only.label}`;
    folder.files = only.files;
    folder.folders = only.folders;
  }
}

/** What the band at the top of the sidebar reports. */
export interface Progress {
  /** Files that can be marked off: everything the diff actually touched. */
  total: number;
  done: number;
  percent: number;
  additions: number;
  deletions: number;
  /** Contributors, abbreviated once there are more than two to name. */
  authors: string;
  /** Every contributor with their commit count, for the tooltip. */
  authorsFull: string;
}

/**
 * Reads the change's shape and the reviewer's progress through it.
 *
 * Untouched files are excluded from both halves of the fraction: they cannot be
 * marked off, so counting them would leave the bar permanently short of full
 * and make finishing look impossible.
 */
export function progressOf(
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
): Progress {
  const reviewable = graph.nodes.filter((n) => n.status !== "phantom");
  const done = reviewable.filter((n) => isViewed(n.path)).length;

  const totals = reviewable.reduce(
    (sum, node) => ({
      additions: sum.additions + node.stats.additions,
      deletions: sum.deletions + node.stats.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const authors = graph.meta.authors ?? [];
  const names = authors.map((a) => a.name);

  return {
    total: reviewable.length,
    done,
    percent: reviewable.length === 0 ? 0 : Math.round((done / reviewable.length) * 100),
    additions: totals.additions,
    deletions: totals.deletions,
    authors:
      names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`,
    authorsFull: authors.map((a) => `${a.name} (${a.commits})`).join(", "),
  };
}

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * A reviewer scanning a list wants "last week" or "months old", not a
 * timestamp; the exact moment is one hover away on the forge.
 */
export function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  // Hours and minutes matter now that the list is ordered by activity: the
  // difference between a branch pushed to ten minutes ago and one pushed to
  // this morning is the difference between joining a conversation and starting
  // one, and "today" said both.
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor((now - then) / 86_400_000);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

/**
 * What a file's row in the list is matched against.
 *
 * The name the row shows, and the name it had before a rename — not the path
 * it sits at. Matching the path meant a word appearing in a directory pulled in
 * every file beneath it: searching "page" in a tree with a `pages/app` folder
 * returned nearly everything, almost none of it carrying the word anywhere the
 * reader could see. A directory the reader wants to narrow to is one click on
 * its twisty away, which is a better answer than a filter that lies.
 */
export function rowSearchText(title: { name: string; was: string }): string {
  return `${title.name} ${title.was}`.trim().toLowerCase();
}

/**
 * The change narrowed to one part of itself.
 *
 * The panel splits a large change into the pieces that do not reach each
 * other, and the list follows: showing forty files beside a drawing of five is
 * two answers to one question. An edge survives only when both of its ends do,
 * so the references under a file are the ones that can be followed from where
 * the reader is standing.
 */
export function partOf(graph: ChangeGraph, paths?: readonly string[]): ChangeGraph {
  if (!paths) return graph;

  const inside = new Set(paths);
  const nodes = graph.nodes.filter((n) => inside.has(n.path));
  const ids = new Set(nodes.map((n) => n.id));

  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.from.nodeId) && ids.has(e.to.nodeId)),
  };
}

/**
 * The change, as something the view can draw without asking any more questions.
 *
 * Everything that needs the repository, the graph or this machine is settled
 * here; what crosses into the webview is plain data. What is deliberately *not*
 * settled is the reader's progress — the view counts the marks it is showing,
 * so the bar cannot disagree with the boxes under it.
 */
export function changeView(
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
  /**
   * The file the reader is standing on in the drawing, when the panel has said.
   *
   * Only ever a file that is in this graph. A part of the change on screen and a
   * reader standing outside it is a real situation — they opened the part after
   * arriving — and a mark naming a file the list is not showing would have the
   * tree opening folders to reveal a row that is not there.
   */
  here = "",
  /** Files that also moved in the narrower view, for the orange dot. */
  fresh?: Fresh,
): ChangeView {
  const totals = progressOf(graph, isViewed);
  const known = here !== "" && graph.nodes.some((node) => node.path === here);

  return {
    tree: folderView(buildTree(graph.nodes), graph, isViewed, freshNote(fresh)),
    ...(known ? { here } : {}),
    totals: {
      additions: totals.additions,
      deletions: totals.deletions,
      authors: totals.authors,
      authorsFull: totals.authorsFull,
    },
    reading: {
      ...(graph.meta.pullRequest ? { number: graph.meta.pullRequest.number } : {}),
      branch: graph.meta.headRef,
      // The head of a working-tree reading is the files themselves; anything
      // else is a commit, and a commit does not change while it is being read.
      local: graph.meta.worktree === true,
    },
  };
}

/** Why a path wears the dot, or nothing when it does not. */
function freshNote(fresh: Fresh | undefined): (path: string) => string | undefined {
  if (!fresh) return () => undefined;
  const paths = new Set(fresh.paths);
  const says =
    fresh.means === "uncommitted"
      ? "Has changes that are not committed yet"
      : "Changed since your last review";
  return (path) => (paths.has(path) ? says : undefined);
}

function folderView(
  folder: Folder,
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
  fresh: (path: string) => string | undefined = () => undefined,
): FolderView {
  return {
    label: folder.label,
    folders: folder.folders.map((child) => folderView(child, graph, isViewed, fresh)),
    files: folder.files.map((node) => fileView(node, graph, isViewed, fresh(node.path))),
  };
}

function fileView(
  node: FileNode,
  graph: ChangeGraph,
  isViewed: (path: string) => boolean,
  fresh?: string,
): FileView {
  const title = cardTitle(node);

  return {
    path: node.path,
    ...(fresh ? { fresh } : {}),
    name: title.name,
    status: node.status,
    viewed: isViewed(node.path),
    additions: title.additions,
    deletions: title.deletions,
    search: rowSearchText(title),
    // Said out loud rather than left as a file that quietly points nowhere: a
    // file with no arrows otherwise looks like a file that references nothing.
    ...(node.resolution === "unsupported"
      ? { note: `no ${node.language} resolver`, language: node.language }
      : {}),
    refs: graph.edges
      .filter((e) => e.from.nodeId === node.id)
      .map((edge) => refView(edge, graph)),
  };
}

function refView(edge: Edge, graph: ChangeGraph): RefView {
  const target = graph.nodes.find((n) => n.id === edge.to.nodeId);
  const where = target
    ? `${basename(target.path)}:${edge.to.line}`
    : `line ${edge.to.line}`;

  return {
    id: edge.id,
    symbol: edge.to.symbolName ?? "reference",
    where,
    change: edge.change,
    label: edge.label ?? "",
    search: `${edge.to.symbolName ?? ""} ${where} ${edge.label ?? ""}`.toLowerCase(),
  };
}

/**
 * The pull requests to choose from, before a graph has been built.
 *
 * Choosing what to review is the step before reviewing it, and doing that in
 * the browser and then finding the branch by hand is the part of the loop that
 * has nothing to do with reading code. What the forge is waiting on this reader
 * for goes first and under its own heading: everything else is context, and
 * this is the queue.
 */
export function pickerView(
  pulls: PullRequestSummary[],
  branch: string,
  moved: (pr: PullRequestSummary) => boolean,
  viewer = "",
  asked: Query = { state: "open", author: "" },
  reached = true,
  local: (pr: PullRequestSummary) => LocalBranch | undefined = () => undefined,
): PickerView {
  const mine = viewer
    ? pulls.filter((pr) => (pr.requestedFrom ?? []).includes(viewer))
    : [];
  const rest = pulls.filter((pr) => !mine.includes(pr));
  const row = (pr: PullRequestSummary) => pullView(pr, branch, moved(pr), local(pr));

  return {
    mine: mine.map(row),
    everythingElse: rest.map(row),
    asked,
    viewer,
    reached,
  };
}

function pullView(
  pr: PullRequestSummary,
  branch: string,
  moved: boolean,
  local: LocalBranch | undefined,
): PullView {
  /*
   * Whether this machine's copy is a second reading of the change.
   *
   * A change that has already landed has no branch to be ahead of anything, and
   * is read where it lies rather than checked out — whatever a stale local copy
   * of its branch says is not a choice worth offering. Settled here rather than
   * in the row, so the row has one fact to draw from rather than two rules to
   * apply.
   */
  const open = pr.state === undefined || pr.state === "open";
  const drifted = open && differs(local);

  return {
    pr,
    ...(drifted && local ? { local } : {}),
    current: pr.branch === branch,
    moved,
    when: ago(pr.updatedAt ?? pr.createdAt),
    opened: ago(pr.createdAt),
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
