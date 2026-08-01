import { sortGraph } from "../graph/build.js";
import type {
  ChangeGraph,
  Coverage,
  LanguageCoverage,
  ResolutionStatus,
} from "../model/types.js";

/**
 * Records what could and could not be analysed.
 *
 * A card with no arrows is ambiguous on its own: the change might genuinely
 * reference nothing, or nothing might have been able to look. Reviewing on that
 * basis is how a missing dependency gets read as "nothing to see here", so the
 * distinction is written into the graph and shown in every renderer instead of
 * being left to the reader to infer.
 */
export function annotateCoverage(
  graph: ChangeGraph,
  supportedLanguages: Iterable<string>,
): ChangeGraph {
  const supported = new Set(supportedLanguages);

  const nodes = graph.nodes.map((node) => ({
    ...node,
    resolution: statusFor(node.status, node.binary, node.language, supported),
  }));

  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.resolution === "untouched") continue;
    counts.set(node.language, (counts.get(node.language) ?? 0) + 1);
  }

  const languages: LanguageCoverage[] = [...counts.entries()]
    .map(([language, files]) => ({
      language,
      files,
      supported: supported.has(language),
    }))
    .sort(
      (a, b) =>
        Number(a.supported) - Number(b.supported) ||
        b.files - a.files ||
        (a.language < b.language ? -1 : 1),
    );

  const coverage: Coverage = {
    analysed: nodes.filter((n) => n.resolution === "analysed").length,
    unsupported: nodes.filter((n) => n.resolution === "unsupported").length,
    languages,
  };

  return sortGraph({ ...graph, nodes, meta: { ...graph.meta, coverage } });
}

function statusFor(
  status: string,
  binary: boolean,
  language: string,
  supported: Set<string>,
): ResolutionStatus {
  if (status === "phantom") return "untouched";
  if (binary) return "binary";
  return supported.has(language) ? "analysed" : "unsupported";
}

/** One-line description of what was left unanalysed, or undefined if nothing was. */
export function describeGaps(coverage: Coverage | undefined): string | undefined {
  if (!coverage) return undefined;
  const missing = coverage.languages.filter((l) => !l.supported);
  if (missing.length === 0) return undefined;

  const parts = missing.map((l) => `${l.files} ${l.language}`);
  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
  return `no resolver for ${list}`;
}
