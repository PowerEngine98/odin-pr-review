import type { FileView, FolderView } from "./model.js";
import { trailTo } from "./shut.js";

/**
 * Every file under a folder, in the order the list draws them.
 *
 * The tree is nested because the sidebar draws it nested, but three separate
 * questions — how many files there are, how many are marked off, which ones a
 * message is talking about — are all asked of the flat list. Walking it each
 * time rather than keeping a second copy: a change is tens of files, not tens
 * of thousands, and a cached index that disagreed with the tree would be a bug
 * nobody could see.
 */
export function filesIn(folder: FolderView): FileView[] {
  const out: FileView[] = [];
  for (const child of folder.folders) out.push(...filesIn(child));
  out.push(...folder.files);
  return out;
}

/**
 * Every folder at or under this one, by the path each is remembered by.
 *
 * The root is left out. It draws no row and can be neither open nor shut, so an
 * entry for it would be one nothing ever reads — and the empty label it carries
 * would key it under the path of whatever folder happened to contain it.
 *
 * Paths rather than labels, for the reason `shut.ts` gives: a change with
 * `src/hooks` and `test/hooks` in it has two folders called `hooks`, and a list
 * of labels would shut both for one press.
 */
export function foldersIn(folder: FolderView, trail = ""): string[] {
  const here = folder.label === "" ? trail : trailTo(trail, folder.label);
  const out: string[] = here === "" ? [] : [here];
  for (const child of folder.folders) out.push(...foldersIn(child, here));
  return out;
}

/**
 * The files under a folder that can be marked read at all.
 *
 * Untouched files are not among them: they are in the list because something
 * points at them rather than because anything happened to them, and a folder
 * box that counted them could never be satisfied. The same rule the fraction in
 * the band uses, said once so the two cannot drift.
 */
export function reviewableIn(folder: FolderView): FileView[] {
  return filesIn(folder).filter((file) => file.status !== "phantom");
}

/**
 * How far through the change the reader is.
 *
 * Untouched files are left out of both halves of the fraction. They cannot be
 * marked off — they are in the list because something points at them, not
 * because anything happened to them — so counting them would leave the bar
 * permanently short of full and make finishing look impossible.
 */
export function progressOf(folder: FolderView): {
  done: number;
  total: number;
  percent: number;
} {
  const reviewable = reviewableIn(folder);
  const done = reviewable.filter((f) => f.viewed).length;
  return {
    done,
    total: reviewable.length,
    percent: reviewable.length === 0 ? 0 : Math.round((done / reviewable.length) * 100),
  };
}
