import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** A declaration found in the source, with enough context to disambiguate it. */
export interface Declaration {
  name: string;
  kind: "class" | "interface" | "object" | "function" | "property" | "enum";
  /** Repository-relative path. */
  path: string;
  /** 1-based line the declaration's name sits on. */
  line: number;
  /** 0-based column of the name. */
  column: number;
  /** Package the file declares, e.g. `com.labura.notifications`. */
  packageName: string;
  /** Type the declaration belongs to, for members. */
  owner?: string;
}

export interface FileFacts {
  path: string;
  packageName: string;
  /** Fully-qualified names this file imports. */
  imports: string[];
}

export interface KotlinIndex {
  /** Every declaration, grouped by simple name. */
  byName: Map<string, Declaration[]>;
  /** Per-file package and imports. */
  files: Map<string, FileFacts>;
}

const SOURCE_EXTENSIONS = [".kt", ".kts"];
const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "build", "out", "target", ".gradle", ".idea", "dist",
]);

/**
 * Declaration patterns.
 *
 * Deliberately line-based rather than a real parse. A Kotlin grammar is a large
 * dependency to carry for something a review tool only needs approximately, and
 * the failure mode is mild: a declaration this misses simply produces no arrow,
 * which the graph already reports as unresolved rather than as absence.
 */
const PATTERNS: { re: RegExp; kind: Declaration["kind"] }[] = [
  { re: /^\s*(?:@\w+\s+)*(?:public|private|internal|protected|open|abstract|sealed|final|inner|data|value|annotation|expect|actual|\s)*enum\s+class\s+([A-Za-z_]\w*)/, kind: "enum" },
  { re: /^\s*(?:@\w+\s+)*(?:public|private|internal|protected|open|abstract|sealed|final|inner|data|value|annotation|expect|actual|\s)*class\s+([A-Za-z_]\w*)/, kind: "class" },
  { re: /^\s*(?:@\w+\s+)*(?:public|private|internal|protected|open|abstract|sealed|final|expect|actual|fun\s+)*interface\s+([A-Za-z_]\w*)/, kind: "interface" },
  { re: /^\s*(?:@\w+\s+)*(?:public|private|internal|protected|companion|expect|actual|\s)*object\s+([A-Za-z_]\w*)/, kind: "object" },
  { re: /^\s*(?:@\w+\s+)*(?:public|private|internal|protected|open|override|abstract|suspend|inline|operator|infix|tailrec|external|expect|actual|\s)*fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.<>, ?]*\.)?([A-Za-z_]\w*)\s*\(/, kind: "function" },
  { re: /^\s*(?:@\w+\s+)*(?:public|private|internal|protected|open|override|const|lateinit|expect|actual|\s)*(?:val|var)\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/, kind: "property" },
];

const PACKAGE_RE = /^\s*package\s+([\w.]+)/;
// The trailing star matters: `import a.b.*` is how Kotlin brings in a whole
// package, and dropping it leaves a name that can never match anything.
const IMPORT_RE = /^\s*import\s+([\w.]+\*?)(?:\s+as\s+(\w+))?/;

/** Builds a symbol index over every Kotlin source file beneath a root. */
export function buildIndex(root: string): KotlinIndex {
  const index: KotlinIndex = { byName: new Map(), files: new Map() };

  for (const absolute of listSources(root)) {
    const path = relative(root, absolute).split(sep).join("/");
    let text: string;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    indexFile(index, path, text);
  }

  return index;
}

/** Indexes one file's text. Exposed so tests need no filesystem. */
export function indexFile(
  index: KotlinIndex,
  path: string,
  text: string,
): void {
  const lines = text.split("\n");
  let packageName = "";
  const imports: string[] = [];

  // Tracks the innermost type declaration, so members can be attributed to it.
  const owners: { name: string; indent: number }[] = [];

  lines.forEach((line, i) => {
    const pkg = PACKAGE_RE.exec(line);
    if (pkg) {
      packageName = pkg[1]!;
      return;
    }
    const imported = IMPORT_RE.exec(line);
    if (imported) {
      imports.push(imported[1]!);
      return;
    }

    const indent = line.length - line.trimStart().length;
    while (owners.length > 0 && indent <= owners[owners.length - 1]!.indent) {
      owners.pop();
    }

    for (const { re, kind } of PATTERNS) {
      const match = re.exec(line);
      if (!match) continue;

      const name = match[1]!;
      const column = Math.max(0, line.indexOf(name, match[0].length - name.length - 2));
      const declaration: Declaration = {
        name,
        kind,
        path,
        line: i + 1,
        column,
        packageName,
      };
      const owner = owners[owners.length - 1];
      if (owner && kind !== "class" && kind !== "interface" && kind !== "object") {
        declaration.owner = owner.name;
      }

      const bucket = index.byName.get(name);
      if (bucket) bucket.push(declaration);
      else index.byName.set(name, [declaration]);

      if (kind === "class" || kind === "interface" || kind === "object" || kind === "enum") {
        owners.push({ name, indent });
      }
      break;
    }
  });

  index.files.set(path, { path, packageName, imports });
}

function listSources(root: string): string[] {
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
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found.sort();
}
