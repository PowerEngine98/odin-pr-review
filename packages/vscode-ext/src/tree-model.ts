import type { ChangeGraph, FileNode } from "@odin/core";

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
 * `src/main/kotlin/com/labura/notifications` rather than six nested rows each
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

  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "today";
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
