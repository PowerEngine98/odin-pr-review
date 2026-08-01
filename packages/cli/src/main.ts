#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  buildGraph,
  enrichSnippets,
  graphFromRepo,
  layoutGraph,
  parseUnifiedDiff,
  serializeGraph,
  toDot,
  toMermaid,
  toSvg,
  validateGraph,
  DARK_THEME,
  LIGHT_THEME,
  type ChangeGraph,
} from "@odin/core";
import { renderHtml } from "@odin/webview";

import { parseArgs, USAGE, type GraphOptions } from "./args.js";
import { resolveEdges } from "./pipeline.js";
import { summarize } from "./summary.js";

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

  let graph = opts.patchFile
    ? await graphFromPatchFile(opts.patchFile, opts.baseRef, opts.headRef)
    : await graphFromRepo({
        cwd: opts.cwd,
        baseRef: opts.baseRef,
        headRef: opts.headRef,
        context: opts.context,
        stamp: opts.stamp,
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
    });
  }

  const issues = validateGraph(graph);
  if (issues.length > 0) {
    for (const issue of issues) {
      process.stderr.write(`odin: warning: ${issue.path}: ${issue.message}\n`);
    }
    if (opts.strict) return 1;
  }

  const rendered = await render(graph, opts);
  if (opts.out) await writeFile(opts.out, rendered, "utf8");
  else process.stdout.write(rendered);

  return 0;
}

async function render(graph: ChangeGraph, opts: GraphOptions): Promise<string> {
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

      return opts.format === "html"
        ? renderHtml(graph, layout, { theme })
        : toSvg(layout, { includeImports, theme });
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
