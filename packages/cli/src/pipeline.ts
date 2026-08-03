import {
  annotateCoverage,
  attachEdges,
  collectProbes,
  CompositeResolver,
  languageLookup,
  materializeTree,
  revParse,
  type ChangeGraph,
  type Checkout,
  type ReferenceResolver,
} from "@odin/core";
import { KotlinResolver } from "@odin/resolver-kotlin";
import { ClojureResolver, PythonResolver } from "@odin/resolver-lang";
import { TsResolver } from "@odin/resolver-ts";

export interface ResolveRequest {
  cwd: string;
  headRef: string;
  /** Resolve imports even when they start out hidden. */
  alwaysResolveImports?: boolean;
  /** Probe unchanged lines as well as changed ones. */
  includeContext?: boolean;
  /** Emit edges for import statements. */
  includeImports?: boolean;
}



/**
 * Adds edges to a change graph.
 *
 * Removed references are resolved against a materialised copy of the merge
 * base, because the lines that contain them no longer exist in the working
 * tree. Without that second checkout, every red arrow in the graph would be a
 * guess, and a reviewer cannot act on a guess.
 */
export async function resolveEdges(
  graph: ChangeGraph,
  request: ResolveRequest,
): Promise<ChangeGraph> {
  // Built before probing so the language list is known, and so coverage can be
  // reported even when nothing resolves.
  const resolveImports =
    request.includeImports !== false || request.alwaysResolveImports === true;

  const build = (roots: { head: string; base?: string }): ReferenceResolver[] => [
    new TsResolver({
      roots,
      ...(resolveImports ? {} : { includeImports: false }),
    }),
    new KotlinResolver({
      roots,
      ...(resolveImports ? {} : { includeImports: false }),
    }),
    new PythonResolver({
      roots,
      ...(resolveImports ? {} : { includeImports: false }),
    }),
    new ClojureResolver({
      roots,
      ...(resolveImports ? {} : { includeImports: false }),
    }),
  ];
  const languages = build({ head: request.cwd }).flatMap((r) => [...r.languages]);

  const probes = collectProbes(graph, {
    languages,
    ...(request.includeContext ? { includeContext: true } : {}),
  });
  if (probes.length === 0) return annotateCoverage(graph, languages);

  const needsBase = probes.some((p) => p.side === "base");
  const checkouts: Checkout[] = [];

  try {
    let baseRoot: string | undefined;
    if (needsBase && graph.meta.mergeBase) {
      const checkout = await materializeTree(graph.meta.mergeBase, {
        cwd: request.cwd,
      });
      checkouts.push(checkout);
      baseRoot = checkout.dir;
    }

    // The working tree only represents head when head is the checked-out
    // commit; otherwise it must be materialised too.
    let headRoot = request.cwd;
    const [headSha, worktreeSha] = await Promise.all([
      revParse(request.headRef, { cwd: request.cwd }).catch(() => ""),
      revParse("HEAD", { cwd: request.cwd }).catch(() => ""),
    ]);
    if (headSha && worktreeSha && headSha !== worktreeSha) {
      const checkout = await materializeTree(headSha, { cwd: request.cwd });
      checkouts.push(checkout);
      headRoot = checkout.dir;
    }

    const roots = { head: headRoot, ...(baseRoot ? { base: baseRoot } : {}) };
    const resolver = new CompositeResolver(build(roots), languageLookup(graph));

    try {
      const results = await resolver.resolve(probes);
      const withEdges = attachEdges(graph, results, { resolver: "ts" });
      return annotateCoverage(withEdges, languages);
    } finally {
      await resolver.dispose();
    }
  } finally {
    for (const checkout of checkouts) checkout.dispose();
  }
}
