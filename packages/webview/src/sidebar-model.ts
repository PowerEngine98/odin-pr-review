import type { FileStatus, LocalBranch, PullRequestSummary } from "@odin/core";

/**
 * What the sidebar is drawn from.
 *
 * The contract between the extension and the view, and the same object on both
 * sides of it: the host renders these components to text and embeds this
 * alongside, and the script that wakes the markup up reads it back. Rendering
 * from anything else would produce markup the script did not expect to adopt.
 *
 * It lives outside `src/app` because the host has to be able to build one, and
 * `src/app` is compiled by the bundler rather than by `tsc`. The components
 * import it back through `app/sidebar/model.ts`, so there is one description of
 * the payload rather than two that drift.
 *
 * What is *not* here is anything the page can work out for itself. Progress is
 * the clearest case: the old renderer sent a fraction and then spent a script
 * keeping it in step with the boxes, because the two were separate facts. Here
 * the fraction is derived from the marks, so it cannot disagree with them.
 */
export interface SidebarModel {
  /** Something is being fetched, and the view says so rather than sitting blank. */
  loading: boolean;
  /** The change as a tree, when there is a change to show. */
  change?: ChangeView;
  /** What to choose from when there is not. */
  picker: PickerView;
}

/** The change under review, grouped the way the project is laid out. */
export interface ChangeView {
  /** The root, whose own label is never drawn. */
  tree: FolderView;
  /** The shape of the change: how big it is and who wrote it. */
  totals: TotalsView;
}

export interface TotalsView {
  additions: number;
  deletions: number;
  /** Contributors, abbreviated once there are more than two to name. */
  authors: string;
  /** Every contributor with their commit count, for the hover. */
  authorsFull: string;
}

export interface FolderView {
  /** Path segments this folder covers, joined. Empty at the root. */
  label: string;
  folders: FolderView[];
  files: FileView[];
}

export interface FileView {
  path: string;
  /** The name the row shows. */
  name: string;
  status: FileStatus;
  /** Whether it was marked read when the page was built. */
  viewed: boolean;
  /** Already formatted, and empty where a count would say nothing. */
  additions: string;
  deletions: string;
  /**
   * What the filter box matches this row against, lowercased.
   *
   * The name and the name it had before a rename — not the path. Matching the
   * path meant a word in a directory dragged in every file beneath it.
   */
  search: string;
  /** Why this file has no references, where that is worth saying out loud. */
  note?: string;
  /** What that note is about, for the hover. */
  language?: string;
  /** Where this file points, of the references that survived the part filter. */
  refs: RefView[];
}

export interface RefView {
  /** The edge, so pressing the row can ask the host to follow it. */
  id: string;
  symbol: string;
  /** The file and line it lands in. */
  where: string;
  /** `added`, `removed` or `unchanged`, for the arrow's colour. */
  change: string;
  /** The whole call site, for the hover. */
  label: string;
  search: string;
}

/**
 * The pull requests to choose from, before there is a change to look at.
 *
 * Split rather than sorted: what the forge is waiting on this reader for is a
 * queue, and everything else is context. A single list with the queue at the
 * top says the same thing far more quietly.
 */
export interface PickerView {
  /** Waiting on this reader. */
  mine: PullView[];
  everythingElse: PullView[];
  /** What the list last asked the forge for. */
  asked: Query;
  /** Who is reading, for the "Mine" chip. */
  viewer: string;
  /** Whether the forge answered at all, as opposed to answering with nothing. */
  reached: boolean;
}

export interface PullView {
  pr: PullRequestSummary;
  /**
   * This machine's copy of the branch, and only when it is worth offering as a
   * second reading of the change.
   *
   * Being behind is not: a branch the reader has simply not pulled is still the
   * pull request, and a fold offering "yours" and "theirs" for it would be a
   * choice between a thing and an older version of itself. Nor is a stale
   * branch left lying around under the name of a change that has already
   * landed. Both of those judgements are the host's, because both are facts
   * about the repository rather than about the list — so the presence of this
   * field is the whole of what the row has to decide from.
   */
  local?: LocalBranch;
  /** Checked out here. */
  current: boolean;
  /** Pushed to since this reader last opened it. */
  moved: boolean;
  /** When it last moved, in the coarsest unit that still says something. */
  when: string;
  /** When it was opened, for the hover. */
  opened: string;
}

/**
 * What the list is asking the forge for.
 *
 * Separate from the text box above it, which searches what has already
 * arrived. This changes the question: a merged change is not in the answer to
 * "what is open", however hard the box is searched.
 */
export interface Query {
  state: "open" | "merged" | "closed" | "all";
  /** A login, or empty for anyone. */
  author: string;
}
