#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  buildGraph,
  currentBranch,
  enrichSnippets,
  graphFromRepo,
  layoutGraph,
  listReviewComments,
  parseUnifiedDiff,
  readPullRequest,
  serializeGraph,
  toDot,
  toMermaid,
  toSvg,
  validateGraph,
  withoutTests,
  DARK_THEME,
  LIGHT_THEME,
  type ChangeGraph,
  type ReviewComment,
} from "@odin/core";
import { loadHighlighter } from "@odin/highlight";
import { renderHtml } from "@odin/webview";

import { parseArgs, USAGE, type GraphOptions } from "./args.js";
import { resolveEdges } from "./pipeline.js";
import { runComments, runReview } from "./review.js";
import { summarize } from "./summary.js";
import { pagePath, serve, writePage } from "./view.js";

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);

  if (opts.kind === "error") {
    process.stderr.write(`odin: ${opts.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (opts.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const write = (text: string) => process.stdout.write(text);
  if (opts.kind === "comments") return runComments(opts, write);
  if (opts.kind === "review") return runReview(opts, write);

  let graph = opts.patchFile
    ? await graphFromPatchFile(opts.patchFile, opts.baseRef ?? "base", opts.headRef)
    : await graphFromRepo({
        cwd: opts.cwd,
        ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
        headRef: opts.headRef,
        context: opts.context,
        stamp: opts.stamp,
        pullRequest: opts.pullRequest,
        ...(opts.pathspecs.length ? { pathspecs: opts.pathspecs } : {}),
      });

  if (opts.resolve) {
    if (opts.patchFile) {
      process.stderr.write(
        "odin: --resolve needs a repository; it cannot run on a bare patch file\n",
      );
      return 2;
    }
    graph = await resolveEdges(graph, {
      cwd: opts.cwd,
      headRef: opts.headRef,
      includeImports: opts.imports,
      includeContext: opts.withContext,
      // The page can switch imports on, so they are resolved regardless.
      alwaysResolveImports: opts.format === "html",
    });
  }

  const issues = validateGraph(graph);
  if (issues.length > 0) {
    for (const issue of issues) {
      process.stderr.write(`odin: warning: ${issue.path}: ${issue.message}\n`);
    }
    if (opts.strict) return 1;
  }

  // Tests reference much of what they exercise, so one large test file can
  // dominate a picture of a change that is not about tests. Excluded unless
  // asked for, and the interactive renderer carries both arrangements.
  const shown = opts.tests ? graph : withoutTests(graph);

  const rendered = await render(shown, opts, graph);

  // `view` hands back an address rather than a document. Everything about the
  // page is the same; what changes is that the caller is a reader, not a pipe.
  if (opts.view) {
    if (opts.serve !== undefined) {
      const url = await serve(rendered, opts.serve);
      process.stdout.write(`${url}\n`);
      process.stderr.write("serving until interrupted; ctrl-c to stop\n");
      return 0;
    }
    const file = opts.out ?? pagePath(graph, opts.cwd);
    process.stdout.write(`${await writePage(file, rendered)}\n`);
    return 0;
  }

  if (opts.out) await writeFile(opts.out, rendered, "utf8");
  else process.stdout.write(rendered);

  return 0;
}

/**
 * The comments already on the pull request, for the page to mark.
 *
 * Best-effort throughout: a graph is worth looking at whether or not the forge
 * can be reached, so every failure here leaves the page without marks rather
 * than without a page.
 */
async function pullRequestComments(cwd: string): Promise<ReviewComment[]> {
  const branch = await currentBranch({ cwd }).catch(() => undefined);
  if (!branch) return [];
  const pull = await readPullRequest(branch, { cwd }).catch(() => undefined);
  if (!pull) return [];
  return listReviewComments(pull.number, { cwd }).catch(() => []);
}

async function render(
  graph: ChangeGraph,
  opts: GraphOptions,
  everything: ChangeGraph,
): Promise<string> {
  const includeImports = opts.imports;

  switch (opts.format) {
    case "summary": return summarize(graph);
    case "mermaid": return toMermaid(graph, { includeImports });
    case "dot": return toDot(graph, { includeImports });
    case "json": return serializeGraph(graph);
    case "svg":
    case "html": {
      // Arrows need somewhere to land, so pull in the source around each
      // target that the diff itself does not show.
      const snippets = opts.patchFile
        ? new Map()
        : await enrichSnippets(graph, { cwd: opts.cwd });
      const layout = layoutGraph(graph, { snippets });
      const theme = opts.light ? LIGHT_THEME : DARK_THEME;

      if (opts.format !== "html") {
        return toSvg(layout, { includeImports, theme });
      }

      // Marked, but not writable: a page opened from a file has nothing to
      // post through. Writing is the command line's job — `odin review` — and
      // offering a composer that could not send would be a promise the page
      // cannot keep.
      const comments = opts.view && !opts.patchFile
        ? await pullRequestComments(opts.cwd)
        : [];

      // Only the languages this change contains, so a two-file review does not
      // pay for thirty grammars it will never look at.
      const highlight = await loadHighlighter(
        everything.nodes.map((n) => n.language ?? "plaintext"),
        { dark: !opts.light },
      );

      return renderHtml(graph, layout, {
        theme,
        withTests: layoutGraph(everything, { snippets }),
        ...(comments.length ? { comments } : {}),
        highlight,
      });
    }
  }
}

/** Offline path: parse a `.patch` file with no repository present. */
async function graphFromPatchFile(
  file: string,
  baseRef: string,
  headRef: string,
): Promise<ChangeGraph> {
  const patch = await readFile(file, "utf8");
  return buildGraph(parseUnifiedDiff(patch), {
    meta: { baseRef, headRef, generator: "odin-pr-review/0.1.0" },
  });
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err: unknown) => {
    process.stderr.write(`odin: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
