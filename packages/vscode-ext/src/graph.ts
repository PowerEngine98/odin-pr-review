import {
  annotateCoverage,
  attachEdges,
  collectProbes,
  CompositeResolver,
  languageLookup,
  withoutTests,
  enrichSnippets,
  graphFromRepo,
  inlineAvatar,
  layoutGraph,
  currentBranch,
  materializeTree,
  movedNodes,
  revParse,
  rowsOnly,
  type ChangeGraph,
  type Checkout,
  type GraphLayout,
  type Snippet,
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



export interface BuildRequest {
  /** Repository root. */
  cwd: string;
  baseRef?: string;
  headRef?: string;
  /**
   * Read the change from the files on disk rather than from the last commit,
   * so work that has not been committed is part of it. Only the branch this
   * checkout holds has a working tree to read, so this overrides `headRef`.
   */
  worktree?: boolean;
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
  /** The same graph in the other diff mode, for the page's own switch. */
  unifiedLayout: GraphLayout;
  unifiedWithTests: GraphLayout;
  /** The graph the default arrangement was laid out from. */
  shown: ChangeGraph;
  /**
   * The blobs behind the gaps and under the arrow tips.
   *
   * Kept on the build rather than thrown away with the local it was computed
   * in, because it is most of a second of `git show` and the next build over
   * the same commits needs exactly the same answer.
   */
  snippets: Map<string, Snippet[]>;
  /** Which files this build had to redraw, when it was an incremental one. */
  redrawn?: string[];
  /**
   * Arrows that must not be drawn until the resolver has caught up.
   *
   * Withheld from the drawing rather than taken out of the graph. Removing an
   * edge changes which files are connected, and that decides the parts, the
   * columns and the size of the whole picture — so a graph with two arrows
   * missing lays out differently, the canvas re-frames, and the reader's view
   * jumps out and comes back a second later when the arrows return. The graph
   * keeps them; the page is told which ones it may not believe yet.
   */
  withdrawn?: string[];
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
  previous?: BuiltGraph,
): Promise<BuiltGraph> {
  const report = request.report ?? (() => {});
  // `HEAD` rather than the branch's name, because naming the branch is naming a
  // commit and the working tree is not one. The graph still records the branch:
  // the diff resolves `HEAD` back to it for everything a reader sees.
  const headRef = request.worktree
    ? "HEAD"
    : request.headRef ?? (await currentBranch({ cwd: request.cwd })) ?? "HEAD";

  report("Reading the diff…");
  let graph = await graphFromRepo({
    cwd: request.cwd,
    ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    headRef,
    ...(request.worktree ? { worktree: true } : {}),
    // The forge is asked once. A rebuild provoked by a keystroke cannot have
    // changed the pull request's title, and `gh` is most of a second of network
    // in the middle of what is supposed to be an instant redraw.
    ...(previous ? {} : { pullRequest: true }),
  });
  if (previous?.graph.meta.pullRequest) {
    graph = {
      ...graph,
      meta: { ...graph.meta, pullRequest: previous.graph.meta.pullRequest },
    };
  }

  // The whole point of holding the last build: an edit that cannot have moved
  // an arrow does not need the arrows worked out again.
  const rows = previous ? rowsOnly(previous.graph, graph) : undefined;
  if (previous && rows) return again(previous, graph, rows);

  const build = (roots: { head: string; base?: string }) => [
    new TsResolver({
      roots,
      ...(request.includeImports ? {} : { includeImports: false }),
    }),
    new KotlinResolver({
      roots,
      ...(request.includeImports ? {} : { includeImports: false }),
    }),
    new PythonResolver({
      roots,
      ...(request.includeImports ? {} : { includeImports: false }),
    }),
    new ClojureResolver({
      roots,
      ...(request.includeImports ? {} : { includeImports: false }),
    }),
    new SqlResolver({ roots }),
    new PostgresResolver({ roots }),
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
        // A commit's tree does not change, so the copy taken for the last
        // rebuild is still the copy this one wants. Kept rather than extracted
        // again, which is a fifth of a second spent reproducing a directory
        // byte for byte, every time somebody saves.
        baseRoot = await baseCheckout(graph.meta.mergeBase, request.cwd);
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
        // Schema objects become a vertex of their own, so a migration points at
        // the table it touches rather than at whichever file declared it.
        graph = withDatabase(graph, { root: headRoot });
      } finally {
        await resolver.dispose();
      }
    }

    graph = annotateCoverage(graph, languages);

    report("Laying out…");
    const snippets = await freshSnippets(graph, previous, request.cwd);

    // Tests are hidden by default and the checkbox swaps arrangements, so both
    // are laid out here — the webview has no layout engine to compute the
    // second one for itself.
    // A webview refuses remote images, so the reviewers' faces travel inside
    // the document the way the comment avatars already do. Best-effort: a face
    // that will not load leaves a name, which is the part that matters.
    const reviewers = graph.meta.pullRequest?.reviewers ?? [];
    await Promise.all(
      reviewers.map(async (who) => {
        if (!who.avatarUrl) return;
        const data = await inlineAvatar(who.avatarUrl).catch(() => undefined);
        if (data) who.avatarUrl = data;
        else delete who.avatarUrl;
      }),
    );

    return arrange(graph, snippets);
  } finally {
    for (const checkout of checkouts) checkout.dispose();
  }
}

/**
 * A build in two answers: the diff now, the references shortly.
 *
 * Reading the diff is a tenth of a second. Resolving every reference in it is
 * three, because the compiler has to be handed the whole checkout again — its
 * program is a snapshot of the files as they were when it was built, so a
 * program kept from the last rebuild would answer confidently about a working
 * tree that no longer exists. There is no warm start to be had; the cost is
 * real and it is paid on every structural edit.
 *
 * What there is, is an order. The reader edited a line and wants to see the
 * line: that is in the diff, and the diff is cheap. So the rows go out at once
 * and the arrows follow when they are known, rather than the reader watching a
 * stale card for three seconds so that everything can arrive together.
 *
 * The one thing this must not do is show an arrow it cannot stand behind. An
 * edit that moved lines moved the anchors of every arrow ending in that file,
 * so those arrows are *taken away* for the interval rather than drawn in the
 * wrong place — the badge says the picture is still being worked out, and a
 * missing arrow is an honest way to say "not yet". Everything else on the
 * canvas is untouched and still true.
 */
export interface StagedBuild {
  /** What can be shown immediately. */
  first: BuiltGraph;
  /** The rest of the work, absent when the first answer is already final. */
  rest?: () => Promise<BuiltGraph>;
}

/**
 * Reads the diff, and decides how much else has to happen.
 *
 * Three outcomes. With nothing to compare against there is no first answer
 * worth giving, so the whole build runs and is delivered once. With a previous
 * build and an edit that cannot have moved an arrow, the shortcut applies and
 * the answer is final immediately. Otherwise the rows go out against the
 * previous graph's arrows, minus the ones that are now in doubt, and the
 * expensive half is handed back to be run.
 */
export async function stageGraphForRepo(
  request: BuildRequest,
  previous?: BuiltGraph,
): Promise<StagedBuild> {
  if (!previous) return { first: await buildGraphForRepo(request) };

  const headRef = request.worktree
    ? "HEAD"
    : request.headRef ?? (await currentBranch({ cwd: request.cwd })) ?? "HEAD";

  let fresh = await graphFromRepo({
    cwd: request.cwd,
    ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    headRef,
    ...(request.worktree ? { worktree: true } : {}),
  });
  if (previous.graph.meta.pullRequest) {
    fresh = {
      ...fresh,
      meta: { ...fresh.meta, pullRequest: previous.graph.meta.pullRequest },
    };
  }

  const rows = rowsOnly(previous.graph, fresh);
  if (rows) return { first: again(previous, fresh, rows) };

  return {
    first: provisional(previous, fresh),
    rest: () => buildGraphForRepo(request, previous),
  };
}

/**
 * The new rows, with the arrows that are still true and none that are not.
 *
 * Kept: every vertex the resolvers invented and every arrow whose two ends are
 * both in files this edit did not touch. A reference between two files the
 * reader was nowhere near did not stop being a reference because they saved a
 * third one.
 *
 * Dropped: every arrow with an end in a file whose lines moved. The arrow may
 * well still exist, but the line it was anchored to is not that line any more,
 * and drawing it where it used to be is the one thing worse than not drawing it
 * — the reader would follow it to the wrong place. It comes back a moment later
 * with the right numbers on it.
 */
function provisional(previous: BuiltGraph, fresh: ChangeGraph): BuiltGraph {
  const moved = new Set(movedNodes(previous.graph, fresh));
  const here = new Set(fresh.nodes.map((node) => node.id));

  // Everything the resolvers invented, kept whether or not an arrow still
  // reaches it. Dropping an orphan would change the set of files in the
  // picture, and the set of files is what the arrangement is computed from.
  const invented = previous.graph.nodes.filter(
    (node) => !here.has(node.id) && (node.status === "phantom" || node.kind === "database"),
  );

  // The nodes the diff produced, wearing what the last build learned about
  // them — the coverage, the symbols, the test marking. Only the rows are new.
  const known = new Map(previous.graph.nodes.map((node) => [node.id, node]));
  const nodes = fresh.nodes.map((node) => {
    const before = known.get(node.id);
    return before ? { ...before, ...node, symbols: before.symbols } : node;
  });

  const reachable = new Set([...here, ...invented.map((node) => node.id)]);
  const edges = previous.graph.edges.filter(
    (edge) => reachable.has(edge.from.nodeId) && reachable.has(edge.to.nodeId),
  );

  /*
   * The arrows this answer cannot stand behind, named rather than removed.
   *
   * An edit that moved lines moved the anchors of every arrow ending in that
   * file, so drawing them where they used to be would send the reader to the
   * wrong line. Taking them out of the graph instead was worse: connectedness
   * decides the parts and the arrangement, so the picture re-laid-out, the
   * canvas re-framed, and the reader's view flew out and came back when the
   * arrows returned a moment later. The graph keeps every edge it had; the page
   * is told which ones not to draw yet.
   */
  const withdrawn = edges
    .filter((edge) => moved.has(edge.from.nodeId) || moved.has(edge.to.nodeId))
    .map((edge) => edge.id);

  const graph: ChangeGraph = {
    ...previous.graph,
    meta: fresh.meta,
    nodes: [...nodes, ...invented],
    edges,
  };
  // The blobs are still the right blobs: nothing was committed, so every gap
  // stands in front of the same bytes it did a moment ago.
  return arrange(graph, previous.snippets, [...moved], withdrawn);
}

/**
 * A copy of the merge base's tree, kept for as long as it is the merge base.
 *
 * Extracting it is `git archive` piped into `tar` over a whole repository, and
 * a rebuild provoked by a keystroke asks for exactly the same bytes as the one
 * before it — the tree of a commit is not a thing that changes. Held by sha, so
 * a reader who commits, rebases or switches base gets a new one and the old one
 * is thrown away rather than quietly reused.
 */
let base: { sha: string; checkout: Checkout } | undefined;

async function baseCheckout(sha: string, cwd: string): Promise<string> {
  if (base?.sha === sha) return base.checkout.dir;

  base?.checkout.dispose();
  base = { sha, checkout: await materializeTree(sha, { cwd }) };
  return base.checkout.dir;
}

/** Lets go of the extracted base, for a window that has stopped watching. */
export function forgetBase(): void {
  base?.checkout.dispose();
  base = undefined;
}

/**
 * The blobs behind the gaps, reading only what the last build did not.
 *
 * Every one of these is a `git show`, and there is one per file: on a
 * seventy-file change that is most of a second of process spawning, repeated on
 * every save. Almost all of it is waste. A snippet is a slice of a blob named
 * by a commit, so as long as nothing has been committed the bytes are identical
 * — what changes is which slices are wanted, and that only for the files whose
 * hunks moved or whose arrows landed somewhere new.
 *
 * So the previous answer is kept for every file that cannot have moved, and
 * `enrichSnippets` is asked about the rest. It is handed the whole graph with a
 * shortened node list: it takes its gap ranges from the nodes it is given and
 * skips any arrow whose end is not among them, which is exactly the subset
 * wanted.
 */
async function freshSnippets(
  graph: ChangeGraph,
  previous: BuiltGraph | undefined,
  cwd: string,
): Promise<Map<string, Snippet[]>> {
  const shas =
    previous &&
    previous.graph.meta.mergeBase === graph.meta.mergeBase &&
    previous.graph.meta.headSha === graph.meta.headSha;
  if (!previous || !shas) return enrichSnippets(graph, { cwd });

  const stale = new Set<string>();
  const was = new Map(previous.graph.nodes.map((n) => [n.id, n]));
  for (const node of graph.nodes) {
    const before = was.get(node.id);
    // A file the last build never saw, or one whose hunks have moved: its gaps
    // are somewhere else now.
    if (!before || JSON.stringify(before.hunks) !== JSON.stringify(node.hunks)) {
      stale.add(node.id);
    }
  }

  // An arrow that was not there before, or has landed somewhere new, needs the
  // few lines around where it lands — which nothing has read yet.
  const anchors = (g: ChangeGraph) =>
    new Set(
      g.edges.flatMap((e) => [
        `${e.to.nodeId}:${e.to.side}:${e.to.line}`,
        `${e.from.nodeId}:${e.from.side}:${e.from.line}`,
      ]),
    );
  const had = anchors(previous.graph);
  for (const edge of graph.edges) {
    for (const end of [edge.to, edge.from]) {
      if (!had.has(`${end.nodeId}:${end.side}:${end.line}`)) stale.add(end.nodeId);
    }
  }

  const merged = new Map(previous.snippets);
  const wanted = graph.nodes.filter((n) => stale.has(n.id));
  // Nothing carried over is allowed to outlive the node it belongs to.
  for (const id of merged.keys()) {
    if (!graph.nodes.some((n) => n.id === id)) merged.delete(id);
  }
  for (const id of stale) merged.delete(id);

  if (wanted.length > 0) {
    const found = await enrichSnippets({ ...graph, nodes: wanted }, { cwd });
    for (const [id, snippets] of found) merged.set(id, snippets);
  }
  return merged;
}

/**
 * The four arrangements a page needs, from a graph and its blobs.
 *
 * Tests are hidden by default and the checkbox swaps arrangements, so both are
 * laid out here — the webview has no layout engine to compute the second one
 * for itself. The page also carries both readings of the change and switches
 * between them, and a card is a different size in each, so each is a layout.
 */
function arrange(
  graph: ChangeGraph,
  snippets: Map<string, Snippet[]>,
  redrawn?: string[],
  withdrawn?: string[],
): BuiltGraph {
  const shown = withoutTests(graph);
  return {
    graph,
    shown,
    snippets,
    layout: layoutGraph(shown, { snippets }),
    layoutWithTests: layoutGraph(graph, { snippets }),
    unifiedLayout: layoutGraph(shown, { snippets, unified: true }),
    unifiedWithTests: layoutGraph(graph, { snippets, unified: true }),
    ...(redrawn ? { redrawn } : {}),
    ...(withdrawn ? { withdrawn } : {}),
  };
}

/**
 * The same change, with a few cards' rows brought up to date.
 *
 * Reached only when `rowsOnly` has said that nothing but line text differs:
 * every hunk still covers the lines it covered, so no arrow's anchor moved, and
 * every line still carries the identifiers it carried, so no reference was made
 * or broken. Under those conditions the previous graph is still true about
 * everything except what the rows say — including the vertices the resolvers
 * invented, the arrows between them, and the blobs behind the gaps, none of
 * which a fresh diff carries.
 *
 * So the fresh nodes are not adopted; only their hunks are. Taking the whole
 * node would throw away the coverage, the symbols and the test marking that the
 * expensive half of the build put there, and the card would come back stripped.
 */
function again(
  previous: BuiltGraph,
  fresh: ChangeGraph,
  redrawn: string[],
): BuiltGraph {
  const rows = new Map(fresh.nodes.map((node) => [node.id, node.hunks]));
  const graph: ChangeGraph = {
    ...previous.graph,
    // The refs and shas are known to match; what can differ is the working
    // tree's own bookkeeping, so the fresh reading of it is the one to keep.
    meta: { ...fresh.meta, ...(previous.graph.meta.coverage
      ? { coverage: previous.graph.meta.coverage }
      : {}) },
    nodes: previous.graph.nodes.map((node) => {
      const hunks = rows.get(node.id);
      return hunks ? { ...node, hunks } : node;
    }),
  };

  // Laid out again rather than reused: a line that grew wider makes its card
  // wider, and a card that has changed size moves the ones beside it. It is
  // tens of milliseconds against the seconds this skipped.
  return arrange(graph, previous.snippets, redrawn);
}
