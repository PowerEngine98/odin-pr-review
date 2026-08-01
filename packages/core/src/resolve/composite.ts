import type { ChangeGraph } from "../model/types.js";
import type {
  LineProbe,
  ProbeResult,
  ReferenceResolver,
} from "./types.js";

/**
 * Routes each probe to whichever resolver handles its language.
 *
 * Languages differ enough that one implementation cannot serve them all — the
 * TypeScript compiler gives exact answers for the languages it knows and none
 * at all for the rest — so the graph is assembled from several, each declaring
 * what it covers. Probes for a language nothing claims are simply not sent,
 * and the file is reported as unsupported rather than silently edge-free.
 */
export class CompositeResolver implements ReferenceResolver {
  readonly id = "composite";
  readonly languages: readonly string[];

  private readonly byLanguage = new Map<string, ReferenceResolver>();

  constructor(
    private readonly resolvers: ReferenceResolver[],
    /** Path to language, since a probe only carries a path. */
    private readonly languageOf: (path: string) => string | undefined,
  ) {
    // First registration wins, so callers order resolvers by preference.
    for (const resolver of resolvers) {
      for (const language of resolver.languages) {
        if (!this.byLanguage.has(language)) this.byLanguage.set(language, resolver);
      }
    }
    this.languages = [...this.byLanguage.keys()].sort();
  }

  async resolve(probes: LineProbe[]): Promise<ProbeResult[]> {
    const grouped = new Map<ReferenceResolver, LineProbe[]>();

    for (const probe of probes) {
      const language = this.languageOf(probe.path);
      const resolver = language ? this.byLanguage.get(language) : undefined;
      if (!resolver) continue;
      const bucket = grouped.get(resolver);
      if (bucket) bucket.push(probe);
      else grouped.set(resolver, [probe]);
    }

    const results: ProbeResult[] = [];
    for (const [resolver, group] of grouped) {
      results.push(...(await resolver.resolve(group)));
    }
    return results;
  }

  async dispose(): Promise<void> {
    for (const resolver of this.resolvers) await resolver.dispose?.();
  }
}

/**
 * Looks a path's language up in the graph.
 *
 * Probes carry paths, not languages, and a renamed file answers to two of them.
 */
export function languageLookup(graph: ChangeGraph): (path: string) => string | undefined {
  const byPath = new Map<string, string>();
  for (const node of graph.nodes) {
    byPath.set(node.path, node.language);
    if (node.prevPath) byPath.set(node.prevPath, node.language);
  }
  return (path) => byPath.get(path);
}
