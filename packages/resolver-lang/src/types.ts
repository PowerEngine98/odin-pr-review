import type { EdgeKind } from "@odin/core";

/** A declaration found in the source, with enough context to disambiguate it. */
export interface Declaration {
  name: string;
  kind: string;
  /** Repository-relative path. */
  path: string;
  /** 1-based line the declaration's name sits on. */
  line: number;
  /** 0-based column of the name. */
  column: number;
  /**
   * The module or namespace the declaring file belongs to.
   *
   * `app.services.billing` in Python, `app.services.billing` in Clojure — the
   * two languages spell the idea the same way, which is why one engine can
   * serve both.
   */
  scope: string;
  /** Type the declaration belongs to, for methods. */
  owner?: string;
}

/** What one file says about where its names come from. */
export interface FileFacts {
  path: string;
  scope: string;
  /** Name to the module it was imported from: `from a.b import c`. */
  named: Record<string, string>;
  /** Alias to the module it stands for: `import a.b as c`, `[a.b :as c]`. */
  aliases: Record<string, string>;
  /** Modules brought in whole: `import a.b`, `(:require a.b)`, `import *`. */
  modules: string[];
}

/** A name used on a line, and how it was used. */
export interface Candidate {
  name: string;
  /** 0-based column of the name within the line. */
  column: number;
  kind: EdgeKind;
  /** Trimmed source text, for hover labels. */
  label: string;
  /** What it was reached through: the `db` in `db.save(x)` or `db/save`. */
  receiver?: string;
  /** For import lines: the module being imported. */
  module?: string;
}

/** Everything one language contributes to the engine below. */
export interface Dialect {
  /** Matches a ResolverId, and names the resolver in the graph. */
  id: "python" | "clojure" | "sql" | "postgres";
  /** VS Code language ids this dialect answers for. */
  languages: readonly string[];
  /** File extensions worth indexing, with the dot. */
  extensions: readonly string[];
  /** Directories never worth walking into, on top of the common ones. */
  skipDirectories?: readonly string[];

  /**
   * Everything one file says about itself.
   *
   * Given the whole text rather than a line at a time: a Clojure `ns` form runs
   * over as many lines as it likes, and a dialect that could only see one line
   * would have to keep a parser's worth of state between calls.
   */
  read(path: string, text: string): { facts: FileFacts; declarations: Declaration[] };

  /**
   * Where a module name could live, as repository-relative paths.
   *
   * Several, because a module is a file or a directory in Python and a
   * namespace has three possible extensions in Clojure. The first one that
   * exists in the index wins.
   */
  pathsFor(module: string, from: FileFacts): string[];

  /** Names used on a line that might reference something. */
  candidates(line: string): Candidate[];

  /** The declaration a line sits inside, looking upwards. */
  enclosing(lines: string[], line: number): string | undefined;
}
