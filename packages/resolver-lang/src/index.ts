import { CLOJURE } from "./clojure.js";
import { PYTHON } from "./python.js";
import { POSTGRES, SQL } from "./sql.js";
import { DialectResolver, type DialectResolverOptions } from "./resolver.js";

export { CLOJURE } from "./clojure.js";
export { PYTHON } from "./python.js";
export { POSTGRES, SQL } from "./sql.js";
export { DialectResolver, type DialectResolverOptions } from "./resolver.js";
export { buildIndex, indexFile, type SymbolIndex } from "./index-build.js";
export type { Candidate, Declaration, Dialect, FileFacts } from "./types.js";

/** Python references, resolved by symbol index. */
export class PythonResolver extends DialectResolver {
  constructor(options: DialectResolverOptions) {
    super(PYTHON, options);
  }
}

/** Clojure references, resolved by symbol index. */
export class ClojureResolver extends DialectResolver {
  constructor(options: DialectResolverOptions) {
    super(CLOJURE, options);
  }
}

/**
 * SQL references, resolved by name.
 *
 * A schema has no modules and no imports, so the index is by name alone — which
 * in a database is very nearly unique by construction, and makes this the most
 * reliable of the index-based resolvers rather than the least.
 */
export class SqlResolver extends DialectResolver {
  constructor(options: DialectResolverOptions) {
    super(SQL, options);
  }
}

/** The same, plus the parts of Postgres that only Postgres has. */
export class PostgresResolver extends DialectResolver {
  constructor(options: DialectResolverOptions) {
    super(POSTGRES, options);
  }
}
