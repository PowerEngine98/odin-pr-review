import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  LineProbe,
  ProbeResult,
  ReferenceResolver,
  ResolvedTarget,
  Side,
} from "@odin/core";

import { buildIndex, type Declaration, type KotlinIndex } from "./index-build.js";

export interface KotlinResolverOptions {
  /** Checkout roots per side. `base` may be omitted to skip removed lines. */
  roots: { head: string; base?: string };
  /** Resolve `import` statements as edges. Default: true. */
  includeImports?: boolean;
}

interface SideContext {
  root: string;
  index: KotlinIndex;
  /** Cached file text, keyed by repository-relative path. */
  sources: Map<string, string[] | null>;
}

/** A name used on a line, and how it was used. */
interface Candidate {
  name: string;
  column: number;
  kind: "call" | "instantiation" | "import" | "type";
  label: string;
  /** Set for member access, e.g. the `service` in `service.save(x)`. */
  receiver?: string;
}

/**
 * Kotlin reference resolution by symbol index.
 *
 * There is no Kotlin compiler to ask here, and requiring one — or a language
 * server — would mean the command line and the editor disagree about what the
 * graph contains. Instead the repository's declarations are indexed by name and
 * call sites are matched against them, preferring what the calling file
 * imports, then its own package, and only then a repository-wide unique match.
 *
 * Every edge it produces is marked `heuristic`, which is the honest label: this
 * resolves the common case correctly and declines the ambiguous one. Where two
 * declarations share a name and neither imports nor package can separate them,
 * no edge is drawn at all — a missing arrow is recoverable, a confidently wrong
 * one sends a reviewer to the wrong file.
 */
export class KotlinResolver implements ReferenceResolver {
  readonly id = "kotlin";
  readonly languages = ["kotlin"] as const;

  private readonly options: KotlinResolverOptions;
  private readonly contexts = new Map<Side, SideContext | null>();

  constructor(options: KotlinResolverOptions) {
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
      for (const candidate of findCandidates(line)) {
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

    const chosen = this.disambiguate(context, probe.path, declarations);
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
      resolver: "kotlin",
      fromColumn: candidate.column,
      label: candidate.label,
    };

    const enclosing = this.enclosingDeclaration(context, probe);
    if (enclosing) target.fromSymbolName = enclosing;
    return target;
  }

  /** Maps `import a.b.C` onto the file that declares `C`. */
  private resolveImport(
    context: SideContext,
    probe: LineProbe,
    candidate: Candidate,
  ): ResolvedTarget | undefined {
    const parts = candidate.name.split(".");
    const simple = parts[parts.length - 1]!;
    const packageName = parts.slice(0, -1).join(".");

    const declarations = (context.index.byName.get(simple) ?? []).filter(
      (d) => d.packageName === packageName || d.owner !== undefined,
    );
    const chosen = declarations.find((d) => d.packageName === packageName);
    if (!chosen || chosen.path === probe.path) return undefined;

    return {
      path: chosen.path,
      line: 1,
      column: 0,
      side: probe.side,
      symbolName: chosen.path.slice(chosen.path.lastIndexOf("/") + 1),
      kind: "import",
      confidence: "heuristic",
      resolver: "kotlin",
      fromColumn: candidate.column,
      label: candidate.label,
    };
  }

  /**
   * Narrows several same-named declarations to one, or gives up.
   *
   * Imports first, because an explicit import is the author telling us which
   * one they meant. Then the file's own package, since Kotlin resolves those
   * without an import. A repository-wide unique match is accepted last; beyond
   * that the answer is a guess, and the edge is dropped instead.
   */
  private disambiguate(
    context: SideContext,
    fromPath: string,
    declarations: Declaration[],
  ): Declaration | undefined {
    const facts = context.index.files.get(fromPath);

    if (facts) {
      const imported = declarations.filter((d) =>
        facts.imports.some(
          (i) => i === `${d.packageName}.${d.name}` ||
                 (d.owner && i === `${d.packageName}.${d.owner}`) ||
                 i === `${d.packageName}.*`,
        ),
      );
      if (imported.length === 1) return imported[0];
      if (imported.length > 1) return undefined;

      const samePackage = declarations.filter(
        (d) => d.packageName === facts.packageName,
      );
      if (samePackage.length === 1) return samePackage[0];
      if (samePackage.length > 1) return undefined;
    }

    return declarations.length === 1 ? declarations[0] : undefined;
  }

  /** Nearest preceding function or type declaration above a line. */
  private enclosingDeclaration(
    context: SideContext,
    probe: LineProbe,
  ): string | undefined {
    const lines = this.sourceFor(context, probe.path);
    if (!lines) return undefined;

    for (let i = Math.min(probe.line - 1, lines.length - 1); i >= 0; i--) {
      const match = /^\s*(?:[\w@]+\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>, ?]*\.)?([A-Za-z_]\w*)\s*\(/
        .exec(lines[i]!);
      if (match) return match[1];
    }
    return undefined;
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
      index: buildIndex(root),
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

/** Keywords that look like calls but never resolve to a declaration. */
const KEYWORDS = new Set([
  "if", "for", "while", "when", "catch", "return", "throw", "is", "as", "in",
  "fun", "val", "var", "class", "object", "interface", "super", "this",
]);

const IMPORT_LINE = /^\s*import\s+([\w.]+\*?)/;
const MEMBER_CALL = /(?:(\w+)\??\.)([A-Za-z_]\w*)\s*\(/g;
const PLAIN_CALL = /(?:^|[^\w.])([A-Za-z_]\w*)\s*\(/g;

/**
 * Names on a line that might reference something.
 *
 * Call position, and type position — which is narrower than it sounds and was
 * missing entirely. A Kotlin class takes its collaborators in its constructor:
 *
 *     class NotificationsProjection(
 *       notificationStatisticsProjection: NotificationStatisticsProjection,
 *     ) : ModelProjection<NotificationsModel> by project(
 *
 * Every name there is a dependency, and not one of them is followed by a
 * bracket. Under the old rule the two files sat next to each other in the
 * drawing with nothing between them, which is exactly the arrow a reviewer
 * opened the graph to see.
 *
 * Still not bare identifiers. What counts is a name that follows a colon or
 * sits inside the angle brackets of one — a declared type, a supertype, a type
 * argument. `val x = something` is not a reference and does not become one.
 */
export function findCandidates(line: string): Candidate[] {
  const imported = IMPORT_LINE.exec(line);
  if (imported) {
    return [{
      name: imported[1]!,
      column: line.indexOf(imported[1]!),
      kind: "import",
      label: line.trim(),
    }];
  }

  const found: Candidate[] = [];
  const seen = new Set<number>();
  const label = line.trim().slice(0, 120);

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

  for (const { name, column } of typesIn(line)) {
    if (seen.has(column)) continue;
    if (found.some((one) => one.column === column)) continue;
    found.push({ name, column, kind: "type", label });
  }

  found.sort((a, b) => a.column - b.column);
  return found;
}

/**
 * Where a type is written down, as opposed to used.
 *
 * After a colon — `x: Thing`, `) : Thing` — and inside the angle brackets of
 * one. Capitalised, because Kotlin types are and this is the cheapest way to
 * leave locals, parameters and keywords alone.
 *
 * Nothing is resolved here. A name that matches no declaration in this
 * repository — `String`, `Int`, `List` — simply finds nothing and draws
 * nothing, which is the right answer without needing a list of what to ignore.
 */
function typesIn(line: string): { name: string; column: number }[] {
  const out: { name: string; column: number }[] = [];

  for (const at of positionsOf(line)) {
    // From the colon to the end of the type expression: a comma or a closing
    // bracket at depth zero, whichever comes first.
    let depth = 0;
    let end = at;
    for (; end < line.length; end++) {
      const ch = line[end]!;
      if (ch === "<") depth += 1;
      else if (ch === ">") depth -= 1;
      else if (depth === 0 && (ch === "," || ch === ")" || ch === "=" || ch === "{")) break;
    }

    const span = line.slice(at, end);
    for (const match of span.matchAll(/[A-Z]\w*/g)) {
      const name = match[0];
      if (KEYWORDS.has(name)) continue;
      out.push({ name, column: at + match.index });
    }
  }
  return out;
}

/**
 * Every colon that introduces a type, and none of the ones that do not.
 *
 * `::` is a reference to a member and `?:` is the elvis operator; neither
 * introduces a type, and both are common enough on the lines this walks that
 * treating them as one would produce arrows out of nowhere.
 */
function positionsOf(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ":") continue;
    if (line[i + 1] === ":" || line[i - 1] === ":") {
      i += 1;
      continue;
    }
    if (line[i - 1] === "?") continue;
    out.push(i + 1);
  }
  return out;
}
