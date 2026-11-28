import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fileIconsFor, type FileIcons, type IconTable } from "@odin/webview";

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
