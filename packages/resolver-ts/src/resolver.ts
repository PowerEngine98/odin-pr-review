import { join, resolve as resolvePath } from "node:path";

import type {
  LineProbe,
  ProbeResult,
  ReferenceResolver,
  ResolvedTarget,
  Side,
} from "@odin/core";
import ts from "typescript";

import { DomainFilter } from "./domain.js";
import { createProgram } from "./program.js";
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

/** One checkout's program, checker and path filter, created on first use. */
interface SideContext {
  root: string;
  program: ts.Program;
  checker: ts.TypeChecker;
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

  private readonly options: TsResolverOptions;
  private readonly contexts = new Map<Side, SideContext | null>();

  constructor(options: TsResolverOptions) {
    this.options = options;
  }

  async resolve(probes: LineProbe[]): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];

    for (const probe of probes) {
      const context = this.contextFor(probe.side);
      if (!context) continue;

      const source = this.sourceFor(context, probe.path);
      if (!source) continue;

      const targets: ResolvedTarget[] = [];
      for (const site of findReferencesOnLine(source, probe.line)) {
        if (site.kind === "import" && this.options.includeImports === false) continue;
        if (site.kind === "type" && this.options.includeTypes !== true) continue;

        const target = this.resolveSite(context, site, probe);
        if (target) targets.push(target);
      }

      if (targets.length > 0) results.push({ probe, targets });
    }

    return results;
  }

  private resolveSite(
    context: SideContext,
    site: ReferenceSite,
    probe: LineProbe,
  ): ResolvedTarget | undefined {
    const declaration = declarationOf(context.checker, site.node);
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

  private contextFor(side: Side): SideContext | undefined {
    if (this.contexts.has(side)) return this.contexts.get(side) ?? undefined;

    const root = side === "head" ? this.options.roots.head : this.options.roots.base;
    if (!root) {
      this.contexts.set(side, null);
      return undefined;
    }

    const absolute = resolvePath(root);
    const program = createProgram(absolute);
    const context: SideContext = {
      root: absolute,
      program,
      checker: program.getTypeChecker(),
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

  private sourceFor(context: SideContext, path: string): ts.SourceFile | undefined {
    const absolute = join(context.root, path);
    return (
      context.program.getSourceFile(absolute) ??
      // TypeScript normalises separators; try the forward-slash form too.
      context.program.getSourceFile(absolute.split("\\").join("/"))
    );
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
