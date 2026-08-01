import type { FileNode } from "@odin/core";

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
