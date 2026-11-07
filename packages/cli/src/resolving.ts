import {
  annotateCoverage,
  attachEdges,
  collectProbes,
  CompositeResolver,
  languageLookup,
  type ChangeGraph,
  type ReferenceResolver,
} from "@odin/core";
import { KotlinResolver } from "@odin/resolver-kotlin";
import {
  ClojureResolver,
  PostgresResolver,
  PythonResolver,
  SqlResolver,
  withDatabase,
} from "@odin/resolver-lang";
import { TsResolver } from "@odin/resolver-ts";

export interface Roots {
  head: string;
  base?: string;
}

export interface ResolveOptions {
  includeImports?: boolean;
  includeContext?: boolean;
}

export function resolversAt(roots: Roots, includeImports = true): ReferenceResolver[] {
  const imports = includeImports ? {} : { includeImports: false };
  return [
    new TsResolver({ roots, ...imports }),
    new KotlinResolver({ roots, ...imports }),
    new PythonResolver({ roots, ...imports }),
    new ClojureResolver({ roots, ...imports }),
    new SqlResolver({ roots }),
    new PostgresResolver({ roots }),
  ];
}

export function languagesOf(includeImports = true): string[] {
  return resolversAt({ head: "/" }, includeImports).flatMap((r) => [...r.languages]);
}

export function probesOf(graph: ChangeGraph, options: ResolveOptions = {}) {
  return collectProbes(graph, {
    languages: languagesOf(options.includeImports !== false),
    ...(options.includeContext ? { includeContext: true } : {}),
  });
}

export async function resolveAt(
  graph: ChangeGraph,
  roots: Roots,
  options: ResolveOptions = {},
): Promise<ChangeGraph> {
  const includeImports = options.includeImports !== false;
  const languages = languagesOf(includeImports);
  const probes = probesOf(graph, options);
  if (probes.length === 0) return annotateCoverage(graph, languages);

  const resolver = new CompositeResolver(resolversAt(roots, includeImports), languageLookup(graph));
  try {
    const results = await resolver.resolve(probes);
    const withEdges = attachEdges(graph, results, { resolver: "ts" });
    const withSchema = withDatabase(withEdges, { root: roots.head });
    return annotateCoverage(withSchema, languages);
  } finally {
    await resolver.dispose();
  }
}
