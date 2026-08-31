import { join, resolve as resolvePath } from "node:path";

import { breathe, SLICE } from "@odin/core";

import type {
  LineProbe,
  ProbeResult,
  ReferenceResolver,
  ResolvedTarget,
  Side,
} from "@odin/core";
import ts from "typescript";

import { DomainFilter } from "./domain.js";
import { Projects, type Project } from "./program.js";
import { findReferencesOnLine, type ReferenceSite } from "./references.js";

export interface TsResolverOptions {
  /** Checkout roots per side. `base` may be omitted to skip removed-line work. */
  roots: { head: string; base?: string };
  /** Extra directory names treated as third-party code. */
  excludeSegments?: string[];
  /** Resolve `import`/`export ... from` statements as edges. Default: true. */
  includeImports?: boolean;
  /** Resolve type annotations as edges. Default: false, they add volume. */
  includeTypes?: boolean;
}

/** One checkout's projects and path filter, created on first use. */
interface SideContext {
  root: string;
  projects: Projects;
  filter: DomainFilter;
}

/**
 * Reference resolution backed by the TypeScript compiler API.
 *
 * Runs headlessly, which is what lets the CLI produce the same graph the editor
 * does. Using the type checker rather than text matching is the difference
 * between "some file mentions `save`" and "this call reaches
 * `UserRepository.save`" — overloads, shadowing and same-named methods on
 * different classes all resolve correctly.
 */
export class TsResolver implements ReferenceResolver {
  readonly id = "ts";
  readonly languages = [
    "typescript",
    "typescriptreact",
    "javascript",
    "javascriptreact",
  ] as const;

  private readonly options: TsResolverOptions;
  private readonly contexts = new Map<Side, SideContext | null>();

  constructor(options: TsResolverOptions) {
    this.options = options;
  }

  async resolve(probes: LineProbe[], onProbe?: () => void): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];

    /*
     * Answered in slices, so the editor can breathe between them.
     *
     * This is the slow half of a build and every probe in it is synchronous,
     * so a plain loop holds the extension host from the first to the last —
     * an `async` function whose body never awaits is one unbroken block. What
     * that looks like from outside is a window that has stopped answering,
     * including the progress this very loop is reporting.
     */
    let since = 0;

    for (const probe of probes) {
      if (++since >= SLICE) {
        since = 0;
        await breathe();
      }
      // Counted before anything can skip the rest of the loop, so the tally is
      // of lines looked at rather than of lines that happened to answer.
      onProbe?.();
      // Reading every `tsconfig.json` in the checkout and expanding its globs
      // is the other unbroken stretch, and it is the first thing that happens.
      if (!this.knows(probe.side)) await breathe();
      const context = this.contextFor(probe.side);
      if (!context) continue;

      /*
       * Out of the way before the one part of this that cannot be divided.
       *
       * Building a compiler program is a single synchronous call — the file,
       * everything it imports, and every declaration behind those — and on a
       * project of any size it is a second or more with no seam in it. Slicing
       * the loop does nothing for that; what a yield here buys is that
       * everything already queued is delivered *before* the block rather than
       * after it. Without it the reader watches a note about the step before
       * this one while the step that is actually running says nothing, which
       * is indistinguishable from a stall.
       */
      if (context.projects.unbuilt(join(context.root, probe.path))) await breathe();

      const found = this.sourceFor(context, probe.path);
      if (!found) continue;

      const targets: ResolvedTarget[] = [];
      for (const site of findReferencesOnLine(found.source, probe.line)) {
        if (site.kind === "import" && this.options.includeImports === false) continue;
        if (site.kind === "type" && this.options.includeTypes !== true) continue;

        const target = this.resolveSite(context, found.project, site, probe);
        if (target) targets.push(target);
      }

      if (targets.length > 0) results.push({ probe, targets });
    }

    return results;
  }

  private resolveSite(
    context: SideContext,
    project: Project,
    site: ReferenceSite,
    probe: LineProbe,
  ): ResolvedTarget | undefined {
    const declaration = declarationOf(project.checker, site.node);
    if (!declaration) return undefined;

    const declSource = declaration.getSourceFile();
    const domainPath = context.filter.toDomainPath(
      resolvePath(declSource.fileName),
    );
    if (!domainPath) return undefined;

    const nameNode = declarationNameOf(declaration) ?? declaration;
    const position = declSource.getLineAndCharacterOfPosition(
      nameNode.getStart(declSource),
    );

    const target: ResolvedTarget = {
      path: domainPath,
      line: position.line + 1,
      column: position.character,
      side: probe.side,
      symbolName: nameText(nameNode, declaration),
      kind: site.kind,
      confidence: "resolved",
      resolver: "ts",
      fromColumn: site.column,
      label: site.label,
    };

    const kind = symbolKindOf(declaration);
    if (kind) target.symbolKind = kind;

    const enclosing = enclosingDeclarationName(site.node);
    if (enclosing) target.fromSymbolName = enclosing;

    // A module specifier resolves to the file itself; anchoring at line 1 is
    // both accurate and what a reader expects an import arrow to point at.
    if (site.kind === "import") {
      target.line = 1;
      target.column = 0;
      target.symbolName = domainPath.slice(domainPath.lastIndexOf("/") + 1);
    }

    return target;
  }

  /** Whether this side has already been looked at, cheaply. */
  private knows(side: Side): boolean {
    return this.contexts.has(side);
  }

  private contextFor(side: Side): SideContext | undefined {
    if (this.contexts.has(side)) return this.contexts.get(side) ?? undefined;

    const root = side === "head" ? this.options.roots.head : this.options.roots.base;
    if (!root) {
      this.contexts.set(side, null);
      return undefined;
    }

    const absolute = resolvePath(root);
    const context: SideContext = {
      root: absolute,
      projects: new Projects(absolute),
      filter: new DomainFilter({
        root: absolute,
        ...(this.options.excludeSegments
          ? { excludeSegments: this.options.excludeSegments }
          : {}),
      }),
    };
    this.contexts.set(side, context);
    return context;
  }

  /**
   * The file, and the project that knows what its imports mean.
   *
   * They travel together because a symbol only means anything to the checker
   * that produced the file it sits in. Asking one project's checker about
   * another's node answers nothing — silently, which is the dangerous part.
   */
  private sourceFor(
    context: SideContext,
    path: string,
  ): { source: ts.SourceFile; project: Project } | undefined {
    const absolute = join(context.root, path);
    // TypeScript normalises separators; try the forward-slash form too.
    const slashed = absolute.split("\\").join("/");
    const project = context.projects.for(slashed) ?? context.projects.for(absolute);
    if (!project) return undefined;

    const source =
      project.program.getSourceFile(absolute) ??
      project.program.getSourceFile(slashed);
    return source ? { source, project } : undefined;
  }

  dispose(): void {
    this.contexts.clear();
  }
}

/** Follows a reference to the declaration it names, through import aliases. */
function declarationOf(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Declaration | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;

  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      // Unresolvable alias; fall through and use what we have.
    }
  }

  const declarations = symbol.declarations;
  if (!declarations || declarations.length === 0) return undefined;

  // Prefer an implementation over an overload signature or ambient stub.
  return (
    declarations.find((d) => !isAmbient(d) && hasBody(d)) ??
    declarations.find((d) => !isAmbient(d)) ??
    declarations[0]
  );
}

function hasBody(declaration: ts.Declaration): boolean {
  const body = (declaration as { body?: unknown }).body;
  return body !== undefined;
}

function isAmbient(declaration: ts.Declaration): boolean {
  return declaration.getSourceFile().isDeclarationFile;
}

function declarationNameOf(declaration: ts.Declaration): ts.Node | undefined {
  const named = declaration as ts.NamedDeclaration;
  return named.name ?? undefined;
}

function nameText(nameNode: ts.Node, declaration: ts.Declaration): string {
  if (ts.isSourceFile(declaration)) {
    const file = declaration.fileName;
    return file.slice(file.lastIndexOf("/") + 1);
  }
  return nameNode.getText() || "(anonymous)";
}

function symbolKindOf(declaration: ts.Declaration): string | undefined {
  if (ts.isFunctionDeclaration(declaration)) return "function";
  if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
    return "method";
  }
  if (ts.isClassDeclaration(declaration)) return "class";
  if (ts.isInterfaceDeclaration(declaration)) return "interface";
  if (ts.isTypeAliasDeclaration(declaration)) return "type";
  if (ts.isEnumDeclaration(declaration)) return "enum";
  if (ts.isVariableDeclaration(declaration)) return "variable";
  if (ts.isPropertyDeclaration(declaration)) return "property";
  if (ts.isConstructorDeclaration(declaration)) return "constructor";
  if (ts.isSourceFile(declaration)) return "file";
  return undefined;
}

/** Nearest named function, method or class containing a reference. */
function enclosingDeclarationName(node: ts.Node): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isClassDeclaration(current) ||
      ts.isInterfaceDeclaration(current)
    ) {
      return current.name?.getText();
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.getText();
    }
  }
  return undefined;
}
