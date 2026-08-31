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

import type { Progress } from "./progress.js";



export interface BuildRequest {
  /** Repository root. */
  cwd: string;
  baseRef?: string;
  /**
   * The workspace's stored preference, which the pull request's own base beats.
   *
   * Kept apart from `baseRef` because they are different claims. One is a
   * reviewer asking for a particular comparison; the other is a setting that
   * may have been written months ago by somebody debugging. A stale one
   * otherwise measures every change in that repository against the wrong point
   * for ever, and what that looks like is not an error — it is other people's
   * merged work appearing inside a branch that never touched it.
   */
  fallbackBaseRef?: string;
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
  /**
   * How far through the whole build we are, for the reader watching it.
   *
   * Separate from `report` because they answer different questions and only
   * one of them can be answered by every phase: a note says what is happening,
   * this says how much of it is left.
   */
  progress?: Progress;
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
  /**
   * Nothing has looked for references in this yet.
   *
   * Set on the first half of a two-phase build, and it is a warning rather than
   * a description: such a graph has no arrows because none have been worked out,
   * not because there are none. Anything that treats it as a finished picture —
   * the shortcut most of all, which reuses the previous build's arrows when an
   * edit cannot have moved one — would conclude there was nothing to reuse and
   * leave the change permanently unconnected.
   */
  unresolved?: boolean;
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
  const step = request.progress;
  // `HEAD` rather than the branch's name, because naming the branch is naming a
  // commit and the working tree is not one. The graph still records the branch:
  // the diff resolves `HEAD` back to it for everything a reader sees.
  const headRef = request.worktree
    ? "HEAD"
    : request.headRef ?? (await currentBranch({ cwd: request.cwd })) ?? "HEAD";

  report("Reading the diff…");
  step?.begins("diff");
  let graph = await graphFromRepo({
    cwd: request.cwd,
    ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    ...(request.fallbackBaseRef ? { fallbackBaseRef: request.fallbackBaseRef } : {}),
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
  //
  // Never against a graph nothing has resolved yet. The first half of a
  // two-phase build has no arrows because none have been looked for, and the
  // shortcut cannot tell that from a change that genuinely has none — it would
  // find nothing to reuse, decide that was the answer, and leave the change
  // unconnected for as long as the reader kept it open.
  const reusable = previous && !previous.unresolved;
  const rows = reusable ? rowsOnly(previous.graph, graph) : undefined;
  if (reusable && rows) return again(previous, graph, rows);

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
        step?.begins("base");
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
      step?.begins("resolve");
      const resolver = new CompositeResolver(
        build({ head: headRoot, ...(baseRoot ? { base: baseRoot } : {}) }),
        languageLookup(graph),
      );
      try {
        /*
         * How far through the slow half we are.
         *
         * Reported in whole percent and only when that number changes: a change
         * of any size is tens of thousands of lines, and a message per line is
         * a channel full of arithmetic nobody can read. What the reader gets is
         * at most a hundred updates, which is exactly as many as a percentage
         * can distinguish.
         */
        let last = -1;
        graph = attachEdges(
          graph,
          await resolver.resolve(probes, (done, total) => {
            const percent = Math.floor((done / total) * 100);
            if (percent === last) return;
            last = percent;
            report(`Resolving references… ${percent}%`);
            step?.within(done, total);
          }),
          { resolver: "ts" },
        );
        // Schema objects become a vertex of their own, so a migration points at
        // the table it touches rather than at whichever file declared it.
        graph = withDatabase(graph, { root: headRoot });
      } finally {
        await resolver.dispose();
      }
    }

    graph = annotateCoverage(graph, languages);

    // Reading the code around the change, which is the other slow half: every
    // gap a card shows is a piece of a file that had to be fetched.
    step?.begins("context");
    report("Laying out…");
    const snippets = await freshSnippets(graph, previous, request.cwd);
    step?.begins("draw");

    // Tests are hidden by default and the checkbox swaps arrangements, so both
    // are laid out here — the webview has no layout engine to compute the
    // second one for itself.
    // A webview refuses remote images, so the reviewers' faces travel inside
    // the document the way the comment avatars already do. Best-effort: a face
    // that will not load leaves a name, which is the part that matters.
    const reviewers = graph.meta.pullRequest?.reviewers ?? [];
    await Promise.all(
      reviewers.map(async (who) => {
        // Already carried across from the first half of the build. Fetching a
        // `data:` URI fails, and the failure path here deletes the face — so
        // re-inlining an inlined one is how a reviewer loses their picture.
        if (!who.avatarUrl || who.avatarUrl.startsWith("data:")) return;
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
 * The change as the patch describes it, with nothing looked up.
 *
 * Everything here is cheap: read the diff, fetch the blobs behind the gaps, lay
 * it out. What is skipped is the whole of the expensive half — no checkout is
 * materialised, no compiler program is built, no reference is followed — so
 * there are no arrows and no vertices for files the diff never mentioned.
 *
 * The forge is asked, because the bar across the top is part of what a reader
 * is waiting for and asking twice would be a second round trip for an answer
 * that cannot have changed in the meantime.
 */
async function diffOnly(request: BuildRequest): Promise<BuiltGraph> {
  const report = request.report ?? (() => {});
  const headRef = request.worktree
    ? "HEAD"
    : request.headRef ?? (await currentBranch({ cwd: request.cwd })) ?? "HEAD";

  report("Reading the diff…");
  const graph = await graphFromRepo({
    cwd: request.cwd,
    ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    ...(request.fallbackBaseRef ? { fallbackBaseRef: request.fallbackBaseRef } : {}),
    headRef,
    ...(request.worktree ? { worktree: true } : {}),
    pullRequest: true,
  });

  report("Laying out…");
  const snippets = await freshSnippets(graph, undefined, request.cwd);

  // The faces, for the same reason they are inlined in the full build: a
  // webview refuses a remote image, and this document is the one the reader
  // looks at first.
  await Promise.all(
    (graph.meta.pullRequest?.reviewers ?? []).map(async (who) => {
      if (!who.avatarUrl || who.avatarUrl.startsWith("data:")) return;
      const data = await inlineAvatar(who.avatarUrl).catch(() => undefined);
      if (data) who.avatarUrl = data;
      else delete who.avatarUrl;
    }),
  );

  return { ...arrange(graph, snippets), unresolved: true };
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
  /*
   * Opening a change, which is the longest wait there is.
   *
   * Reading the diff is a tenth of a second and resolving every reference in it
   * is several — so a reader opening a review watched a blank page for the
   * whole of it, when the thing they came to read was ready almost at once.
   * The cards go out first and the arrows follow.
   *
   * The same shape the hot reload already had; it simply never applied to the
   * first build, because there was nothing to show the rows *against*. There
   * does not need to be: a change with no arrows on it yet is still the change.
   */
  if (!previous) {
    const first = await diffOnly(request);
    return { first, rest: () => buildGraphForRepo(request, first) };
  }

  // A first half is not something to take the shortcut against: it has no
  // arrows because none have been looked for.
  if (previous.unresolved) return { first: await buildGraphForRepo(request, previous) };

  const headRef = request.worktree
    ? "HEAD"
    : request.headRef ?? (await currentBranch({ cwd: request.cwd })) ?? "HEAD";

  let fresh = await graphFromRepo({
    cwd: request.cwd,
    ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    ...(request.fallbackBaseRef ? { fallbackBaseRef: request.fallbackBaseRef } : {}),
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
/*
 * Held by sha, and several at once.
 *
 * One slot was enough while one change could be open. With two readings off
 * different bases it is worse than a small cache: each rebuild finds the other
 * one's tree in the slot, throws it away, and extracts its own — so two tabs
 * being edited turn a cache into a guarantee of a full `archive | tar` on every
 * keystroke, which is the several seconds this exists to avoid.
 *
 * Bounded, because a tree is a copy of the whole repository. The one least
 * recently asked for goes when the limit is reached: a reader with four changes
 * open is working in one of them.
 */
const HELD = 4;

const bases = new Map<string, Checkout>();

async function baseCheckout(sha: string, cwd: string): Promise<string> {
  const held = bases.get(sha);
  if (held) {
    // Freshened, so "least recently asked for" means what it says.
    bases.delete(sha);
    bases.set(sha, held);
    return held.dir;
  }

  const checkout = await materializeTree(sha, { cwd });
  bases.set(sha, checkout);
  while (bases.size > HELD) {
    const oldest = bases.keys().next().value as string;
    bases.get(oldest)?.dispose();
    bases.delete(oldest);
  }
  return checkout.dir;
}

/** Lets go of the extracted bases, for a window that has stopped watching. */
export function forgetBase(): void {
  for (const checkout of bases.values()) checkout.dispose();
  bases.clear();
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
