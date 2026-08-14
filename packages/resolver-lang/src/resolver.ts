import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  LineProbe,
  ProbeResult,
  ReferenceResolver,
  ResolvedTarget,
  Side,
} from "@odin/core";

import { buildIndex, type SymbolIndex } from "./index-build.js";
import type { Candidate, Declaration, Dialect, FileFacts } from "./types.js";

export interface DialectResolverOptions {
  /** Checkout roots per side. `base` may be omitted to skip removed lines. */
  roots: { head: string; base?: string };
  /** Resolve `import` and `:require` statements as edges. Default: true. */
  includeImports?: boolean;
}

interface SideContext {
  root: string;
  index: SymbolIndex;
  /** Cached file text, keyed by repository-relative path. */
  sources: Map<string, string[] | null>;
}

/**
 * Reference resolution by symbol index, for languages read a line at a time.
 *
 * Neither Python nor Clojure can be asked where a name goes without running
 * something that knows the project — an interpreter, a language server, a REPL
 * with the code loaded — and a review tool that needed any of those would give
 * different answers on the command line and in the editor. So the repository's
 * declarations are indexed by name and call sites are matched against them,
 * preferring what the calling file imports, then its own module, and only then
 * a repository-wide unique match.
 *
 * Every edge is marked `heuristic`, which is the honest label. Where two
 * declarations share a name and nothing in the file separates them, no edge is
 * drawn: a missing arrow is recoverable, a confidently wrong one sends a
 * reviewer to the wrong file and costs them the trust they had in the rest.
 */
export class DialectResolver implements ReferenceResolver {
  readonly id: string;
  readonly languages: readonly string[];

  private readonly dialect: Dialect;
  private readonly options: DialectResolverOptions;
  private readonly contexts = new Map<Side, SideContext | null>();

  constructor(dialect: Dialect, options: DialectResolverOptions) {
    this.dialect = dialect;
    this.id = dialect.id;
    this.languages = dialect.languages;
    this.options = options;
  }

  async resolve(probes: LineProbe[], onProbe?: () => void): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];

    for (const probe of probes) {
      // Counted before anything can skip the rest of the loop, so the tally is
      // of lines looked at rather than of lines that happened to answer.
      onProbe?.();
      const context = this.contextFor(probe.side);
      if (!context) continue;

      const lines = this.sourceFor(context, probe.path);
      const line = lines?.[probe.line - 1];
      if (line === undefined) continue;

      const targets: ResolvedTarget[] = [];
      for (const candidate of this.dialect.candidates(line)) {
        const target = this.resolveCandidate(context, probe, candidate);
        if (target) targets.push(target);
      }

      if (targets.length > 0) results.push({ probe, targets });
    }

    return results;
  }

  private resolveCandidate(
    context: SideContext,
    probe: LineProbe,
    candidate: Candidate,
  ): ResolvedTarget | undefined {
    if (candidate.kind === "import") {
      if (this.options.includeImports === false) return undefined;
      return this.resolveImport(context, probe, candidate);
    }

    const declarations = context.index.byName.get(candidate.name);
    if (!declarations || declarations.length === 0) return undefined;

    const facts = context.index.files.get(probe.path);
    const chosen = this.disambiguate(context, facts, candidate, declarations);
    if (!chosen || chosen.path === probe.path) return undefined;

    const target: ResolvedTarget = {
      path: chosen.path,
      line: chosen.line,
      column: chosen.column,
      side: probe.side,
      symbolName: chosen.name,
      symbolKind: chosen.kind,
      kind: candidate.kind,
      confidence: "heuristic",
      resolver: this.dialect.id,
      fromColumn: candidate.column,
      label: candidate.label,
    };

    const lines = this.sourceFor(context, probe.path);
    const enclosing = lines
      ? this.dialect.enclosing(lines, probe.line)
      : undefined;
    if (enclosing) target.fromSymbolName = enclosing;
    return target;
  }

  /** Maps an imported module onto the file that is it. */
  private resolveImport(
    context: SideContext,
    probe: LineProbe,
    candidate: Candidate,
  ): ResolvedTarget | undefined {
    const facts = context.index.files.get(probe.path);
    const path = this.fileFor(context, candidate.module ?? candidate.name, facts);
    if (!path || path === probe.path) return undefined;

    return {
      path,
      line: 1,
      column: 0,
      side: probe.side,
      symbolName: path.slice(path.lastIndexOf("/") + 1),
      kind: "import",
      confidence: "heuristic",
      resolver: this.dialect.id,
      fromColumn: candidate.column,
      label: candidate.label,
    };
  }

  /** The file a module name stands for, if the repository holds one. */
  private fileFor(
    context: SideContext,
    module: string,
    facts: FileFacts | undefined,
  ): string | undefined {
    const declared = context.index.byScope.get(module);
    if (declared && declared.length > 0) return declared[0];

    if (!facts) return undefined;
    for (const candidate of this.dialect.pathsFor(module, facts)) {
      if (context.index.files.has(candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * Narrows several same-named declarations to one, or gives up.
   *
   * In the order the language itself resolves them. A qualified call names the
   * module outright, so it settles the question by itself. A name the file
   * imported by name is the author saying which one they meant. A module the
   * file imported whole comes next, then its own module, then a match that is
   * unique in the whole repository. Past that the answer is a guess.
   */
  private disambiguate(
    context: SideContext,
    facts: FileFacts | undefined,
    candidate: Candidate,
    declarations: Declaration[],
  ): Declaration | undefined {
    if (facts) {
      // `db.save(x)` where `db` is `import app.db as db`, or `db/save` where
      // `db` is `[app.db :as db]`: the module is stated, not inferred.
      if (candidate.receiver) {
        const module = facts.aliases[candidate.receiver] ?? candidate.receiver;
        const inModule = declarations.filter((d) => d.scope === module);
        if (inModule.length === 1) return inModule[0];
        // A receiver that names no module at all is an object — `self.save(x)`,
        // `(swap! state ...)` — and the name on it says nothing about which
        // file it lives in. Only a repository-wide unique match is left.
        if (inModule.length > 1) return undefined;
        if (facts.aliases[candidate.receiver]) return undefined;
      }

      const from = facts.named[candidate.name];
      if (from !== undefined) {
        const imported = declarations.filter((d) => d.scope === from);
        if (imported.length === 1) return imported[0];
        if (imported.length > 1) return undefined;
      }

      const whole = declarations.filter((d) => facts.modules.includes(d.scope));
      if (whole.length === 1) return whole[0];
      if (whole.length > 1) return undefined;

      const near = declarations.filter((d) => d.scope === facts.scope);
      if (near.length === 1) return near[0];
      if (near.length > 1) return undefined;

      // Same directory. Python resolves neither of these implicitly, but a
      // sibling module is where a reviewer would look first, and a unique
      // sibling is not a guess in the way a unique stranger is.
      const folder = facts.path.slice(0, facts.path.lastIndexOf("/") + 1);
      const siblings = declarations.filter(
        (d) => d.path.slice(0, d.path.lastIndexOf("/") + 1) === folder,
      );
      if (siblings.length === 1) return siblings[0];
    }

    void context;
    return declarations.length === 1 ? declarations[0] : undefined;
  }

  private contextFor(side: Side): SideContext | undefined {
    if (this.contexts.has(side)) return this.contexts.get(side) ?? undefined;

    const root = side === "head" ? this.options.roots.head : this.options.roots.base;
    if (!root) {
      this.contexts.set(side, null);
      return undefined;
    }

    const context: SideContext = {
      root,
      index: buildIndex(root, this.dialect),
      sources: new Map(),
    };
    this.contexts.set(side, context);
    return context;
  }

  private sourceFor(context: SideContext, path: string): string[] | null {
    if (context.sources.has(path)) return context.sources.get(path)!;

    let lines: string[] | null = null;
    try {
      lines = readFileSync(join(context.root, path), "utf8").split("\n");
    } catch {
      lines = null;
    }
    context.sources.set(path, lines);
    return lines;
  }

  dispose(): void {
    this.contexts.clear();
  }
}
