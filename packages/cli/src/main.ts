#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  buildGraph,
  currentBranch,
  enrichSnippets,
  graphFromRepo,
  inlineAvatars,
  layoutGraph,
  listReviewComments,
  parseUnifiedDiff,
  readChecks,
  readPullRequest,
  serializeGraph,
  toDot,
  toMermaid,
  validateGraph,
  withoutTests,
  DARK_THEME,
  LIGHT_THEME,
  type ChangeGraph,
  type ReviewComment,
} from "@odin/core";
import { loadHighlighter } from "@odin/highlight";
import { renderHtml, renderSvg } from "@odin/webview";

import { parseArgs, USAGE, type GraphOptions } from "./args.js";
import { resolveEdges } from "./pipeline.js";
import { runComments, runReview } from "./review.js";
import { update } from "./update.js";
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
  if (opts.kind === "update") return runUpdate(opts);
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
  const comments = await listReviewComments(pull.number, { cwd }).catch(() => []);
  // Inlined here rather than fetched by the page: a rendered graph is one file
  // with no network access, and a mark with a picture in it has to carry it.
  return inlineAvatars(comments).catch(() => comments);
}

/**
 * Odin updating itself, said out loud as it goes.
 *
 * Written to standard error rather than standard output, because everything
 * else this tool prints is a document somebody may be piping somewhere and
 * progress is not part of it.
 */
async function runUpdate(
  opts: { cwd: string; dryRun: boolean; branch?: string },
): Promise<number> {
  const say = (line: string) => process.stderr.write(`${line}\n`);
  try {
    const done = await update(
      {
        cwd: opts.cwd,
        dryRun: opts.dryRun,
        ...(opts.branch ? { branch: opts.branch } : {}),
      },
      say,
    );
    if (done.installed) say("Installed. Reload the editor window to pick it up.");
    return 0;
  } catch (error) {
    process.stderr.write(`odin: ${(error as Error).message}\n`);
    return 1;
  }
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

      // Drawn by the application's own components rather than by an exporter
      // of its own, so that a change to how a card looks reaches the webview,
      // the written page and this file at once instead of three times.
      // `@odin/core`'s `toSvg` is still there and still exercised by the layout
      // tests, where it is the reference picture a placement is compared
      // against — which is a different job from being what a reviewer is sent.
      if (opts.format !== "html") {
        return renderSvg(layout, { includeImports, theme });
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

      // A file on disk cannot poll, so the checks it carries are the ones the
      // forge reported when it was written.
      const checks = opts.view && !opts.patchFile && graph.meta.pullRequest
        ? await readChecks(graph.meta.headRef, { cwd: opts.cwd }).catch(() => undefined)
        : undefined;

      return renderHtml(graph, layout, {
        theme,
        ...(checks ? { checks } : {}),
        withTests: layoutGraph(everything, { snippets }),
        // Both readings of the change travel with the page: switching between
        // them is a change of card sizes, which needs a layout, and a file
        // opened from disk has nothing to ask for one.
        alternate: {
          layout: layoutGraph(graph, { snippets, unified: true }),
          withTests: layoutGraph(everything, { snippets, unified: true }),
        },
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
