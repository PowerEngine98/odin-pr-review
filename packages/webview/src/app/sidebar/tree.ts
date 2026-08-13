import type { FileView, FolderView } from "./model.js";

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
  const reviewable = filesIn(folder).filter((f) => f.status !== "phantom");
  const done = reviewable.filter((f) => f.viewed).length;
  return {
    done,
    total: reviewable.length,
    percent: reviewable.length === 0 ? 0 : Math.round((done / reviewable.length) * 100),
  };
}
