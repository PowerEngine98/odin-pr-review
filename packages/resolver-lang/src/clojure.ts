import type { Candidate, Declaration, Dialect, FileFacts } from "./types.js";

/**
 * Definition forms.
 *
 * Everything Clojure spells `def…` at the top of a form, which is where a
 * reader looks for the thing a call landed on. Line-based, like the rest of
 * this: a reader macro or a form built by a macro is missed, and a missed
 * declaration produces no arrow rather than a wrong one.
 */
const DEFINE =
  /^\s*\((defn-?|def|defmacro|defmulti|defmethod|defrecord|defprotocol|deftype|defstruct|definterface|deftest|defonce|defentity)\s+(?:\^\S+\s+)?([A-Za-z*+!\-_?<>=.][\w*+!\-_?<>=.]*)/;

/** The namespace a file declares, wherever in the file it says so. */
const NAMESPACE = /\(ns\s+(?:\^\S+\s+)?([A-Za-z][\w.*+!\-_?<>=]*)/;

/**
 * A namespace is a path with the dashes turned into underscores.
 *
 * Clojure's own rule, and one worth honouring exactly: `my-app.core` lives at
 * `my_app/core.clj`, and a resolver that forgot it would fail on every project
 * whose name has a dash in it, which is most of them.
 */
function fileStem(namespace: string): string {
  return namespace.split(".").join("/").replace(/-/g, "_");
}

/** Namespace for a path, the same rule read backwards. */
function namespaceOf(path: string): string {
  return path
    .replace(/\.clj[cs]?$/, "")
    .replace(/^src\//, "")
    .split("/")
    .join(".")
    .replace(/_/g, "-");
}

/**
 * What the `ns` form brings in.
 *
 * Read over the whole file rather than line by line: an `ns` form is written
 * across as many lines as it takes, and the `:as` of a require is routinely on
 * a different line from the `:refer` beside it.
 */
function absorbRequires(text: string, facts: FileFacts): void {
  // Every `[ns …]` vector inside a :require or :use, wherever it wrapped.
  for (const match of text.matchAll(REQUIRE_VECTOR)) {
    const module = match[1]!;
    facts.modules.push(module);

    const rest = match[2] ?? "";
    const alias = /:as\s+([A-Za-z][\w.*+!\-_?<>=]*)/.exec(rest);
    if (alias) facts.aliases[alias[1]!] = module;

    const referred = /:refer\s+\[([^\]]*)\]/.exec(rest);
    if (referred) {
      for (const name of referred[1]!.split(/\s+/).filter(Boolean)) {
        facts.named[name] = module;
      }
    }
    // `:refer :all` and `:use` bring in everything the namespace has, which is
    // already covered by the module being in `modules`.
  }

  // `(:require foo.bar)` and `(:use foo.bar)` without a vector.
  for (const match of text.matchAll(BARE_REQUIRE)) {
    for (const name of match[1]!.split(/\s+/)) {
      if (name.startsWith(":") || name.startsWith("[") || !name) continue;
      facts.modules.push(name.replace(/^'/, ""));
    }
  }
}

export const CLOJURE: Dialect = {
  id: "clojure",
  languages: ["clojure"],
  extensions: [".clj", ".cljs", ".cljc"],
  skipDirectories: ["target", "resources", "node_modules"],

  read(path, text) {
    const declared = NAMESPACE.exec(text)?.[1];
    const facts: FileFacts = {
      path,
      scope: declared ?? namespaceOf(path),
      named: {},
      aliases: {},
      modules: [],
    };
    absorbRequires(text, facts);

    const declarations: Declaration[] = [];
    text.split("\n").forEach((line, i) => {
      const match = DEFINE.exec(line);
      if (!match) return;
      const name = match[2]!;
      declarations.push({
        name,
        kind: match[1] === "def" || match[1] === "defonce" ? "variable"
          : match[1]!.startsWith("defn") ? "function"
            : match[1]!.slice(3),
        path,
        line: i + 1,
        column: line.indexOf(name, match[0].length - name.length),
        scope: facts.scope,
      });
    });

    return { facts, declarations };
  },

  pathsFor(module) {
    const stem = fileStem(module);
    // `src/` is the convention rather than the rule, so both are offered and
    // whichever the repository actually has wins.
    return [
      `${stem}.clj`, `${stem}.cljc`, `${stem}.cljs`,
      `src/${stem}.clj`, `src/${stem}.cljc`, `src/${stem}.cljs`,
    ];
  },

  candidates(line) {
    const label = line.trim().slice(0, 120);

    // The requires of an ns form, on whichever of its lines they landed: the
    // opening `(ns`, a `(:require`, or one more vector in the middle of one.
    if (/^\s*\(ns\s/.test(line) || /^\s*\(?:?\(?(?:require|use)\b/.test(line) ||
        /^\s*\[[\w.*+!\-_?<>=]+(\s+:|\])/.test(line)) {
      const found: Candidate[] = [];
      for (const match of line.matchAll(REQUIRED_HERE)) {
        const module = match[1]!;
        if (!module.includes(".")) continue;
        found.push({
          name: module,
          module,
          column: match.index,
          kind: "import",
          label,
        });
      }
      if (found.length > 0) return found;
    }

    const found: Candidate[] = [];
    const seen = new Set<number>();

    // `(ns/name …)` and `ns/name` passed as a value: a qualified symbol says
    // outright which namespace it came from, which is the easiest reference in
    // the language to be sure about.
    for (const match of line.matchAll(QUALIFIED)) {
      const name = match[2]!;
      const column = match.index + match[0].indexOf(match[1]!);
      seen.add(column);
      found.push({
        name,
        column,
        kind: "call",
        label,
        receiver: match[1]!,
      });
    }

    // A bare symbol in head position: `(save! order)`.
    for (const match of line.matchAll(HEAD_CALL)) {
      const name = match[1]!;
      if (SPECIAL.has(name)) continue;
      const column = match.index + match[0].indexOf(name);
      if (seen.has(column)) continue;
      found.push({
        name,
        column,
        kind: /^[A-Z]/.test(name) ? "instantiation" : "call",
        label,
      });
    }

    found.sort((a, b) => a.column - b.column);
    return found;
  },

  enclosing(lines, line) {
    for (let i = Math.min(line - 1, lines.length - 1); i >= 0; i--) {
      const match = DEFINE.exec(lines[i]!);
      if (match) return match[2];
    }
    return undefined;
  },
};

/** `[foo.bar :as x :refer [a b]]`, wherever the brackets wrapped. */
const REQUIRE_VECTOR = /\[([A-Za-z][\w.*+!\-_?<>=]*)((?:[^[\]]|\[[^\]]*\])*)\]/g;
/** `(:require foo.bar)` with no vector around it. */
const BARE_REQUIRE = /\(:(?:require|use)\s+([^[\]()]+)\)/g;
/** Namespaces named on this line, vector or not. */
const REQUIRED_HERE = /(?:\[|\s|^)'?([a-z][\w.*+!\-_?<>=]*\.[\w.*+!\-_?<>=]+)/g;

const QUALIFIED = /(?:\(|\s|^)([A-Za-z][\w.*+!\-_?<>=]*)\/([\w*+!\-_?<>=]+)/g;
const HEAD_CALL = /\(\s*([a-zA-Z][\w*+!\-_?<>=]*)/g;

/**
 * Forms that are the language rather than the codebase.
 *
 * Special forms and the core macros that open nearly every function body. Left
 * in, they would draw an arrow from every `let` in the change to whichever file
 * happened to define something called `let`.
 */
const SPECIAL = new Set([
  "def", "defn", "defn-", "defmacro", "defmulti", "defmethod", "defrecord",
  "defprotocol", "deftype", "defstruct", "defonce", "deftest", "ns",
  "let", "letfn", "if", "if-let", "if-not", "if-some", "when", "when-let",
  "when-not", "when-some", "cond", "condp", "case", "do", "doto", "fn",
  "loop", "recur", "try", "catch", "finally", "throw", "quote", "var",
  "and", "or", "not", "->", "->>", "some->", "some->>", "as->", "cond->",
  "cond->>", "map", "mapv", "filter", "filterv", "reduce", "reduced", "into",
  "conj", "cons", "assoc", "assoc-in", "dissoc", "update", "update-in", "get",
  "get-in", "count", "first", "second", "rest", "next", "last", "seq", "vec",
  "set", "list", "str", "keyword", "symbol", "name", "apply", "partial",
  "comp", "juxt", "range", "repeat", "concat", "sort", "sort-by", "group-by",
  "for", "doseq", "dotimes", "while", "swap!", "reset!", "atom", "deref",
  "require", "import", "use", "println", "print", "format", "instance?",
  "empty?", "nil?", "some", "every?", "contains?", "keys", "vals", "merge",
  "select-keys", "remove", "take", "drop", "partition", "interpose", "flatten",
]);
