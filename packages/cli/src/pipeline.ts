import {
  annotateCoverage,
  materializeTree,
  revParse,
  type ChangeGraph,
  type Checkout,
} from "@odin/core";

import { languagesOf, probesOf, resolveAt } from "./resolving.js";

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
  const includeImports =
    request.includeImports !== false || request.alwaysResolveImports === true;
  const options = {
    includeImports,
    ...(request.includeContext ? { includeContext: true } : {}),
  };

  const probes = probesOf(graph, options);
  if (probes.length === 0) return annotateCoverage(graph, languagesOf(includeImports));

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

    return await resolveAt(graph, { head: headRoot, ...(baseRoot ? { base: baseRoot } : {}) }, options);
  } finally {
    for (const checkout of checkouts) checkout.dispose();
  }
}
