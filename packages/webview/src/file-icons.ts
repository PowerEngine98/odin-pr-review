export interface FileIcons {
  of: Record<string, string>;
  icons: Record<string, string>;
}

export interface IconTable {
  file: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  svgs: Record<string, string>;
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
    const svg = table.svgs[name];
    if (!svg) continue;
    of[path] = name;
    icons[name] ??= `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
  return { of, icons };
}
