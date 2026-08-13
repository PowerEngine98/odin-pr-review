import type { FileView, FolderView, RefView } from "./model.js";

/**
 * Narrowing the change, as a question asked of the tree rather than a walk
 * over the document.
 *
 * A file matches on its own name, a reference on the symbol it resolves to and
 * the file and line it lands in — so searching for a function name finds both
 * the files that call it and the calls themselves. A file whose references
 * match stays, with its list opened: hiding a file whose contents matched
 * would be the opposite of what was asked for.
 */
export function fileMatches(file: FileView, needle: string): boolean {
  return needle === "" || file.search.includes(needle);
}

export function refMatches(ref: RefView, needle: string): boolean {
  return needle === "" || ref.search.includes(needle);
}

/** A file is worth showing when it matches, or when something it points at does. */
export function fileSurvives(file: FileView, needle: string): boolean {
  return fileMatches(file, needle) || file.refs.some((ref) => refMatches(ref, needle));
}

/**
 * A folder is worth showing when something under it is.
 *
 * An empty one is not a result: a heading over nothing is a heading that has
 * to be read and discounted.
 */
export function folderSurvives(folder: FolderView, needle: string): boolean {
  if (needle === "") return true;
  return (
    folder.files.some((file) => fileSurvives(file, needle)) ||
    folder.folders.some((child) => folderSurvives(child, needle))
  );
}

/**
 * A label cut into the parts that matched and the parts that did not.
 *
 * Every occurrence, not just the first: a path can carry the same word twice
 * and marking one of them reads as an accident. The old renderer did this by
 * rewriting `innerHTML` and keeping the original text on a data attribute so
 * that clearing the box could put it back; there is nothing to put back here,
 * because the text was never overwritten.
 */
export function pieces(
  text: string,
  needle: string,
): { text: string; hit: boolean }[] {
  if (needle === "") return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;

  for (;;) {
    const found = lower.indexOf(needle, at);
    if (found < 0) break;
    if (found > at) out.push({ text: text.slice(at, found), hit: false });
    out.push({ text: text.slice(found, found + needle.length), hit: true });
    at = found + needle.length;
  }

  if (out.length === 0) return [{ text, hit: false }];
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
