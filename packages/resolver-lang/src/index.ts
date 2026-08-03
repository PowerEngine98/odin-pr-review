import { CLOJURE } from "./clojure.js";
import { PYTHON } from "./python.js";
import { DialectResolver, type DialectResolverOptions } from "./resolver.js";

export { CLOJURE } from "./clojure.js";
export { PYTHON } from "./python.js";
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
