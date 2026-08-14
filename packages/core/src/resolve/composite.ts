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

  /**
   * Every probe, through whichever resolver knows its language.
   *
   * `onProgress` is told how many lines have been looked at out of how many
   * there are. Counted across the whole set rather than per resolver: a change
   * is usually one language with a handful of stragglers, so per-resolver
   * progress would sit at nothing and then jump to done.
   */
  async resolve(
    probes: LineProbe[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<ProbeResult[]> {
    const grouped = new Map<ReferenceResolver, LineProbe[]>();

    for (const probe of probes) {
      const language = this.languageOf(probe.path);
      const resolver = language ? this.byLanguage.get(language) : undefined;
      if (!resolver) continue;
      const bucket = grouped.get(resolver);
      if (bucket) bucket.push(probe);
      else grouped.set(resolver, [probe]);
    }

    // What can actually be answered, which is what the reader should be told
    // about: a change full of files nothing can read would otherwise show a
    // percentage that stops short of the end for ever.
    let total = 0;
    for (const group of grouped.values()) total += group.length;

    let done = 0;
    const results: ProbeResult[] = [];
    for (const [resolver, group] of grouped) {
      results.push(
        ...(await resolver.resolve(group, () => onProgress?.(++done, total))),
      );
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
