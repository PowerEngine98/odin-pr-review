import { parseUnifiedDiff, type ParsedFile } from "../diff/parse.js";
import { buildGraph } from "../graph/build.js";
import type { ChangeGraph, GraphMeta } from "../model/types.js";
import { git, mergeBase, repoRoot, revParse, type GitOptions } from "./exec.js";

export interface DiffRequest extends GitOptions {
  /** The branch the PR targets. */
  baseRef: string;
  /** The branch under review. Defaults to the working tree via `HEAD`. */
  headRef?: string;
  /** Lines of context around each hunk. */
  context?: number;
  /** Rename detection threshold, 0-100. */
  renameThreshold?: number;
  /** Pathspecs to restrict the diff to. */
  pathspecs?: string[];
  /** Record the wall-clock time in `meta.generatedAt`. Off by default so that
   *  the same inputs always serialise to the same bytes. */
  stamp?: boolean;
}

/** Raw patch text for a base..head comparison, taken from the merge base. */
export async function readPatch(req: DiffRequest): Promise<{
  patch: string;
  meta: GraphMeta;
}> {
  const headRef = req.headRef ?? "HEAD";
  const base = await mergeBase(req.baseRef, headRef, req);

  const args = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    `--find-renames=${req.renameThreshold ?? 50}%`,
    `--unified=${req.context ?? 3}`,
    "--patch",
    base,
    headRef,
  ];
  if (req.pathspecs?.length) args.push("--", ...req.pathspecs);

  const patch = await git(args, req);

  const meta: GraphMeta = {
    repo: await repoRoot(req),
    baseRef: req.baseRef,
    headRef,
    baseSha: await revParse(req.baseRef, req),
    headSha: await revParse(headRef, req),
    mergeBase: base,
    generator: "odin-pr-review/0.1.0",
  };
  if (req.stamp) meta.generatedAt = new Date().toISOString();

  return { patch, meta };
}

/** Convenience: repo + refs in, change graph (without edges) out. */
export async function graphFromRepo(req: DiffRequest): Promise<ChangeGraph> {
  const { patch, meta } = await readPatch(req);
  const files: ParsedFile[] = parseUnifiedDiff(patch);
  return buildGraph(files, { meta });
}
