export interface FileIcons {
  of: Record<string, string>;
  icons: Record<string, string>;
}

export interface IconTable {
  file: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folder?: string;
  folderExpanded?: string;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  svgs: Record<string, string>;
}

export function folderIconNamesFor(
  label: string,
  table: Pick<IconTable, "folder" | "folderExpanded" | "folderNames" | "folderNamesExpanded">,
): { closed?: string; open?: string } {
  const segments = label.split("/").filter(Boolean).reverse();
  const named = segments.map((one) => one.toLowerCase()).find((one) => table.folderNames?.[one]);
  if (named) {
    return { closed: table.folderNames![named], open: table.folderNamesExpanded?.[named] ?? table.folderExpanded };
  }
  return { closed: table.folder, open: table.folderExpanded };
}

export function addIcon(icons: FileIcons, name: string | undefined, table: IconTable): boolean {
  const svg = name ? table.svgs[name] : undefined;
  if (!name || !svg) return false;
  icons.icons[name] ??= `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return true;
}

export function iconNameFor(path: string, table: Pick<IconTable, "file" | "fileNames" | "fileExtensions">): string {
  const base = path.split("/").pop() ?? path;
  const lower = base.toLowerCase();
  const named = table.fileNames[lower] ?? table.fileNames[base];
  if (named) return named;
  const parts = lower.split(".");
  for (let at = 1; at < parts.length; at++) {
    const found = table.fileExtensions[parts.slice(at).join(".")];
    if (found) return found;
  }
  return table.file;
}

export function fileIconsFor(paths: Iterable<string>, table: IconTable | undefined): FileIcons | undefined {
  if (!table) return undefined;
  const of: Record<string, string> = {};
  const icons: Record<string, string> = {};
  for (const path of paths) {
    const name = iconNameFor(path, table);
    if (addIcon({ of, icons }, name, table)) of[path] = name;
  }
  return { of, icons };
}
