import {
  annotateCoverage,
  attachEdges,
  collectProbes,
  CompositeResolver,
  languageLookup,
  withoutTests,
  enrichSnippets,
  graphFromRepo,
  layoutGraph,
  currentBranch,
  materializeTree,
  revParse,
  type ChangeGraph,
  type Checkout,
  type GraphLayout,
} from "@odin/core";
import { KotlinResolver } from "@odin/resolver-kotlin";
import { TsResolver } from "@odin/resolver-ts";



export interface BuildRequest {
  /** Repository root. */
  cwd: string;
  baseRef?: string;
  headRef?: string;
  includeImports: boolean;
  includeContext: boolean;
  /** Called with coarse progress so the editor can show it. */
  report?: (message: string) => void;
}

export interface BuiltGraph {
  /** Everything, so the sidebar can list what the canvas is hiding. */
  graph: ChangeGraph;
  /** The default arrangement, with test files left out. */
  layout: GraphLayout;
  /** The arrangement the tests checkbox switches to. */
  layoutWithTests: GraphLayout;
  /** The graph the default arrangement was laid out from. */
  shown: ChangeGraph;
}

/**
 * Produces the same graph the command line produces.
 *
 * The extension deliberately reuses the compiler-API resolver rather than
 * asking the editor's language server. It means one implementation to reason
 * about, and it means the picture in the editor is the same picture a reviewer
 * gets from `odin graph` — which matters, because the layout is supposed to be
 * something you remember.
 */
export async function buildGraphForRepo(
  request: BuildRequest,
): Promise<BuiltGraph> {
  const report = request.report ?? (() => {});
  const headRef =
    request.headRef ?? (await currentBranch({ cwd: request.cwd })) ?? "HEAD";

  report("Reading the diff…");
  let graph = await graphFromRepo({
    cwd: request.cwd,
    ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    headRef,
  });

  const build = (roots: { head: string; base?: string }) => [
    new TsResolver({
      roots,
      ...(request.includeImports ? {} : { includeImports: false }),
    }),
    new KotlinResolver({
      roots,
      ...(request.includeImports ? {} : { includeImports: false }),
    }),
  ];
  const languages = build({ head: request.cwd }).flatMap((r) => [...r.languages]);

  const probes = collectProbes(graph, {
    languages,
    ...(request.includeContext ? { includeContext: true } : {}),
  });

  const checkouts: Checkout[] = [];
  try {
    if (probes.length > 0) {
      let baseRoot: string | undefined;
      if (probes.some((p) => p.side === "base") && graph.meta.mergeBase) {
        report("Materialising the merge base…");
        const checkout = await materializeTree(graph.meta.mergeBase, {
          cwd: request.cwd,
        });
        checkouts.push(checkout);
        baseRoot = checkout.dir;
      }

      // The working tree only represents head when head is checked out.
      let headRoot = request.cwd;
      const [headSha, worktreeSha] = await Promise.all([
        revParse(headRef, { cwd: request.cwd }).catch(() => ""),
        revParse("HEAD", { cwd: request.cwd }).catch(() => ""),
      ]);
      if (headSha && worktreeSha && headSha !== worktreeSha) {
        const checkout = await materializeTree(headSha, { cwd: request.cwd });
        checkouts.push(checkout);
        headRoot = checkout.dir;
      }

      report("Resolving references…");
      const resolver = new CompositeResolver(
        build({ head: headRoot, ...(baseRoot ? { base: baseRoot } : {}) }),
        languageLookup(graph),
      );
      try {
        graph = attachEdges(graph, await resolver.resolve(probes), {
          resolver: "ts",
        });
      } finally {
        await resolver.dispose();
      }
    }

    graph = annotateCoverage(graph, languages);

    report("Laying out…");
    const snippets = await enrichSnippets(graph, { cwd: request.cwd });

    // Tests are hidden by default and the checkbox swaps arrangements, so both
    // are laid out here — the webview has no layout engine to compute the
    // second one for itself.
    const shown = withoutTests(graph);
    return {
      graph,
      shown,
      layout: layoutGraph(shown, { snippets }),
      layoutWithTests: layoutGraph(graph, { snippets }),
    };
  } finally {
    for (const checkout of checkouts) checkout.dispose();
  }
}
