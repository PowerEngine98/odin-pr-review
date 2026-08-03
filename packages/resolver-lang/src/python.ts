import type { Candidate, Declaration, Dialect, FileFacts } from "./types.js";

/**
 * Declaration patterns.
 *
 * Line-based rather than a real parse. A Python grammar is a large dependency
 * to carry for something a review tool only needs approximately, and the
 * failure mode is mild: a declaration this misses produces no arrow, which the
 * graph already reports as unresolved rather than as absence.
 */
const DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const CLASS = /^(\s*)class\s+([A-Za-z_]\w*)\s*[(:]/;
/** A module-level name bound once: settings, registries, singletons. */
const ASSIGN = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/;

const IMPORT = /^\s*import\s+(.+)$/;
const FROM = /^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)$/;

/** The dotted module a file is, by where it sits. */
function moduleOf(path: string): string {
  const withoutExtension = path.replace(/\.pyi?$/, "");
  const parts = withoutExtension.split("/").filter(Boolean);
  // A package is its directory: `app/db/__init__.py` is `app.db`, and code
  // importing it writes the directory's name, never the file's.
  if (parts[parts.length - 1] === "__init__") parts.pop();
  return parts.join(".");
}

/**
 * `from . import x` and `from ..models import y`, against the importing file.
 *
 * The dots count upwards from the file's own package, which is the directory
 * it sits in — not the module it is, or every relative import would land one
 * level too high.
 */
function absolute(module: string, from: FileFacts): string {
  const dots = /^\.+/.exec(module)?.[0].length ?? 0;
  if (dots === 0) return module;

  const own = from.scope.split(".");
  // `app.db.session` sits in package `app.db`; one dot means that package.
  if (!from.path.endsWith("__init__.py")) own.pop();
  const climbed = own.slice(0, Math.max(0, own.length - (dots - 1)));
  const rest = module.slice(dots);
  return [...climbed, ...(rest ? rest.split(".") : [])].join(".");
}

/** `a as b, c` — the names an import statement actually binds. */
function bound(list: string): { name: string; as?: string }[] {
  return list
    .replace(/[()]/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, alias] = part.split(/\s+as\s+/);
      return alias ? { name: name!.trim(), as: alias.trim() } : { name: part };
    });
}

export const PYTHON: Dialect = {
  id: "python",
  languages: ["python"],
  extensions: [".py", ".pyi"],

  read(path, text) {
    const facts: FileFacts = {
      path,
      scope: moduleOf(path),
      named: {},
      aliases: {},
      modules: [],
    };
    const declarations: Declaration[] = [];

    // Tracks the innermost class, so methods can be attributed to it.
    const owners: { name: string; indent: number }[] = [];

    text.split("\n").forEach((line, i) => {
      const from = FROM.exec(line);
      if (from) {
        const module = absolute(from[1]!, facts);
        facts.modules.push(module);
        for (const item of bound(from[2]!)) {
          if (item.name === "*") continue;
          facts.named[item.as ?? item.name] = module;
        }
        return;
      }

      const imported = IMPORT.exec(line);
      if (imported) {
        for (const item of bound(imported[1]!)) {
          facts.modules.push(item.name);
          // `import a.b.c` binds `a`; `import a.b.c as d` binds `d`, and only
          // the alias form gives a receiver worth resolving through.
          if (item.as) facts.aliases[item.as] = item.name;
          else facts.aliases[item.name.split(".")[0]!] = item.name;
        }
        return;
      }

      const parsed = declare(line);
      if (!parsed) return;

      while (owners.length > 0 && parsed.indent <= owners[owners.length - 1]!.indent) {
        owners.pop();
      }

      const declaration: Declaration = {
        name: parsed.name,
        kind: parsed.kind,
        path,
        line: i + 1,
        column: line.indexOf(parsed.name, parsed.indent),
        scope: facts.scope,
      };
      const owner = owners[owners.length - 1];
      if (owner && parsed.kind !== "class") declaration.owner = owner.name;
      declarations.push(declaration);

      if (parsed.kind === "class") owners.push({ name: parsed.name, indent: parsed.indent });
    });

    return { facts, declarations };
  },

  pathsFor(module, from) {
    const dotted = absolute(module, from);
    if (!dotted) return [];
    const stem = dotted.split(".").join("/");
    // A module is a file or a package directory, and the two are written the
    // same way at the import.
    return [`${stem}.py`, `${stem}/__init__.py`, `${stem}.pyi`];
  },

  candidates(line) {
    const label = line.trim().slice(0, 120);

    const from = FROM.exec(line);
    if (from) {
      return [{
        name: from[1]!,
        module: from[1]!,
        column: line.indexOf(from[1]!),
        kind: "import",
        label,
      }];
    }

    const imported = IMPORT.exec(line);
    if (imported) {
      return bound(imported[1]!).map((item) => ({
        name: item.name,
        module: item.name,
        column: Math.max(0, line.indexOf(item.name)),
        kind: "import" as const,
        label,
      }));
    }

    const found: Candidate[] = [];
    const seen = new Set<number>();

    for (const match of line.matchAll(MEMBER_CALL)) {
      const name = match[2]!;
      if (KEYWORDS.has(name)) continue;
      const column = match.index + match[0].lastIndexOf(name);
      seen.add(column);
      const candidate: Candidate = {
        name,
        column,
        kind: /^[A-Z]/.test(name) ? "instantiation" : "call",
        label,
      };
      if (match[1]) candidate.receiver = match[1];
      found.push(candidate);
    }

    for (const match of line.matchAll(PLAIN_CALL)) {
      const name = match[1]!;
      if (KEYWORDS.has(name)) continue;
      const column = match.index + match[0].indexOf(name);
      if (seen.has(column)) continue;
      found.push({
        name,
        column,
        kind: /^[A-Z]/.test(name) ? "instantiation" : "call",
        label,
      });
    }

    // A decorator is a reference to a function that is doing something to this
    // one, which is exactly the kind of thing a reviewer follows.
    const decorator = DECORATOR.exec(line);
    if (decorator) {
      const name = decorator[2]!;
      const column = line.indexOf(name, decorator[0].length - name.length);
      if (!seen.has(column) && !KEYWORDS.has(name)) {
        const candidate: Candidate = { name, column, kind: "call", label };
        if (decorator[1]) candidate.receiver = decorator[1];
        found.push(candidate);
      }
    }

    found.sort((a, b) => a.column - b.column);
    return found;
  },

  enclosing(lines, line) {
    for (let i = Math.min(line - 1, lines.length - 1); i >= 0; i--) {
      const match = DEF.exec(lines[i]!);
      if (match) return match[2];
    }
    return undefined;
  },
};

function declare(
  line: string,
): { name: string; kind: string; indent: number } | undefined {
  const klass = CLASS.exec(line);
  if (klass) {
    return { name: klass[2]!, kind: "class", indent: klass[1]!.length };
  }
  const def = DEF.exec(line);
  if (def) {
    return { name: def[2]!, kind: "function", indent: def[1]!.length };
  }
  // Only at the left margin: a name bound inside a function is a local, and
  // locals share names across a codebase constantly.
  const assign = ASSIGN.exec(line);
  if (assign) return { name: assign[1]!, kind: "variable", indent: 0 };
  return undefined;
}

/** Names that look like calls but never resolve to a declaration. */
const KEYWORDS = new Set([
  "if", "elif", "while", "for", "return", "yield", "assert", "print",
  "with", "except", "raise", "lambda", "and", "or", "not", "in", "is",
  "int", "str", "float", "bool", "list", "dict", "set", "tuple", "bytes",
  "len", "range", "type", "super", "self", "cls", "isinstance", "getattr",
  "setattr", "hasattr", "enumerate", "zip", "map", "filter", "sorted", "open",
]);

const MEMBER_CALL = /(?:(\w+)\.)([A-Za-z_]\w*)\s*\(/g;
const PLAIN_CALL = /(?:^|[^\w.])([A-Za-z_]\w*)\s*\(/g;
const DECORATOR = /^\s*@(?:(\w+)\.)?([A-Za-z_]\w*)/;
