/**
 * Which folder a file lives in.
 *
 * One line of arithmetic, in a module of its own, because both sides of the
 * wire need to agree about it and only one of them can import the rest of this
 * package: the drawing runs in a browser, and the barrel that would otherwise
 * carry this pulls in child processes and the file system behind it.
 */

/**
 * The immediate parent, or nothing for a file that lives at the top.
 *
 * The parent and not the whole trail: a box per directory in a path ten deep is
 * ten boxes around one card, which says less than no box at all.
 */
export function folderOf(path: string): string | undefined {
  const at = path.lastIndexOf("/");
  return at <= 0 ? undefined : path.slice(0, at);
}
