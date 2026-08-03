import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { Declaration, Dialect, FileFacts } from "./types.js";

export interface SymbolIndex {
  /** Every declaration, grouped by simple name. */
  byName: Map<string, Declaration[]>;
  /** Per-file module and imports. */
  files: Map<string, FileFacts>;
  /** Module or namespace to the files that declare it. */
  byScope: Map<string, string[]>;
}

/**
 * Directories that are never source, whatever the language.
 *
 * Walking a virtualenv or a `node_modules` costs seconds and produces
 * thousands of declarations that no reviewer is reading, several of which
 * share names with the ones they are.
 */
const SKIP = new Set([
  "node_modules", ".git", "build", "out", "target", "dist", ".idea",
  ".venv", "venv", "__pycache__", ".tox", ".mypy_cache", ".pytest_cache",
  "site-packages", ".cpcache", ".shadow-cljs", ".clj-kondo", ".lsp",
]);

/** Builds a symbol index over every source file of one dialect beneath a root. */
export function buildIndex(root: string, dialect: Dialect): SymbolIndex {
  const index: SymbolIndex = {
    byName: new Map(),
    files: new Map(),
    byScope: new Map(),
  };

  for (const absolute of listSources(root, dialect)) {
    const path = relative(root, absolute).split(sep).join("/");
    let text: string;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    indexFile(index, dialect, path, text);
  }

  return index;
}

/** Indexes one file's text. Exposed so tests need no filesystem. */
export function indexFile(
  index: SymbolIndex,
  dialect: Dialect,
  path: string,
  text: string,
): void {
  const { facts, declarations } = dialect.read(path, text);

  for (const declaration of declarations) {
    const bucket = index.byName.get(declaration.name);
    if (bucket) bucket.push(declaration);
    else index.byName.set(declaration.name, [declaration]);
  }

  index.files.set(path, facts);
  const paths = index.byScope.get(facts.scope);
  if (paths) paths.push(path);
  else index.byScope.set(facts.scope, [path]);
}

function listSources(root: string, dialect: Dialect): string[] {
  const skip = new Set([...SKIP, ...(dialect.skipDirectories ?? [])]);
  const found: string[] = [];

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(full);
      } else if (dialect.extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found.sort();
}
