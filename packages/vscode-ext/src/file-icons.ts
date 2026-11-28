import { readFileSync } from "node:fs";
import { join } from "node:path";

import { addIcon, fileIconsFor, folderIconNamesFor, type FileIcons, type FolderView, type IconTable } from "@odin/webview";

let table: IconTable | undefined;
let from: string | undefined;

export function iconsFrom(extension: string): void {
  from = join(extension, "dist", "media", "file-icons.json");
  table = undefined;
}

function loaded(): IconTable | undefined {
  if (table || !from) return table;
  try {
    table = JSON.parse(readFileSync(from, "utf8")) as IconTable;
  } catch {
    from = undefined;
  }
  return table;
}

export function fileIcons(paths: Iterable<string>): FileIcons | undefined {
  return fileIconsFor(paths, loaded());
}

export function withFolderIcons(tree: FolderView, icons: FileIcons | undefined): FolderView {
  const known = loaded();
  if (!known || !icons) return tree;
  const walk = (folder: FolderView): FolderView => {
    const names = folder.label ? folderIconNamesFor(folder.label, known) : {};
    const closed = addIcon(icons, names.closed, known) ? names.closed : undefined;
    const open = addIcon(icons, names.open, known) ? names.open : undefined;
    return {
      ...folder,
      ...(closed ? { icon: closed } : {}),
      ...(open ? { iconOpen: open } : {}),
      folders: folder.folders.map(walk),
    };
  };
  return walk(tree);
}

export function iconUri(name: string): string | undefined {
  const svg = loaded()?.svgs[name];
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : undefined;
}
