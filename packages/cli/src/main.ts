#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  buildGraph,
  graphFromRepo,
  parseUnifiedDiff,
  serializeGraph,
  toDot,
  toMermaid,
  validateGraph,
  type ChangeGraph,
} from "@odin/core";

import { parseArgs, USAGE, type OutputFormat } from "./args.js";
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

  const rendered = render(graph, opts.format, opts.imports);
  if (opts.out) await writeFile(opts.out, rendered, "utf8");
  else process.stdout.write(rendered);

  return 0;
}

function render(
  graph: ChangeGraph,
  format: OutputFormat,
  includeImports: boolean,
): string {
  switch (format) {
    case "summary": return summarize(graph);
    case "mermaid": return toMermaid(graph, { includeImports });
    case "dot": return toDot(graph, { includeImports });
    case "json": return serializeGraph(graph);
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
