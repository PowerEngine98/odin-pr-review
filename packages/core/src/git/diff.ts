import { parseUnifiedDiff, type ParsedFile } from "../diff/parse.js";
import { buildGraph } from "../graph/build.js";
import { annotateTests } from "../graph/tests.js";
import type { ChangeGraph, GraphMeta } from "../model/types.js";
import type { Author } from "../model/types.js";
import { readPullRequest } from "./pullRequest.js";
import {
  currentBranch,
  git,
  mergeBase,
  repoRoot,
  resolveBaseRef,
  revParse,
  type GitOptions,
} from "./exec.js";

export interface DiffRequest extends GitOptions {
  /**
   * Branch the PR targets. Treated as a preference: if it does not exist here,
   * the remote's default branch and the usual names are tried before giving up.
   * Omit it to detect the base entirely.
   */
  baseRef?: string;
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
  /** Ask `gh` for the pull request this branch belongs to. */
  pullRequest?: boolean;
}

/** Raw patch text for a base..head comparison, taken from the merge base. */
export async function readPatch(req: DiffRequest): Promise<{
  patch: string;
  meta: GraphMeta;
}> {
  const headRef = req.headRef ?? "HEAD";
  // The configured name may not exist here: worktrees and fresh clones often
  // carry only `origin/main`, and plenty of repositories still use `master`.
  const baseRef = await resolveBaseRef(req.baseRef, req);
  const base = await mergeBase(baseRef, headRef, req);

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

  // `HEAD` names a commit, not a change. Everything downstream reads headRef as
  // the answer to "which review is this" — the window title, the file a
  // rendered page is written to, the key the viewed marks are stored under —
  // and every branch answering "HEAD" makes all three collide.
  const headName =
    headRef === "HEAD" ? (await currentBranch(req)) ?? headRef : headRef;

  const meta: GraphMeta = {
    repo: await repoRoot(req),
    baseRef,
    headRef: headName,
    baseSha: await revParse(baseRef, req),
    headSha: await revParse(headRef, req),
    mergeBase: base,
    generator: "odin-pr-review/0.1.0",
  };
  if (req.stamp) meta.generatedAt = new Date().toISOString();

  const authors = await readAuthors(base, headRef, req);
  if (authors.length > 0) meta.authors = authors;

  if (req.pullRequest) {
    const branch = (await currentBranch(req)) ?? headRef;
    const pull = await readPullRequest(branch, req);
    if (pull) meta.pullRequest = pull;
  }

  return { patch, meta };
}

/** Convenience: repo + refs in, change graph (without edges) out. */
export async function graphFromRepo(req: DiffRequest): Promise<ChangeGraph> {
  const { patch, meta } = await readPatch(req);
  const files: ParsedFile[] = parseUnifiedDiff(patch);
  return annotateTests(buildGraph(files, { meta }));
}

/**
 * Who wrote the commits between the merge base and the head.
 *
 * Counted rather than merely listed: on a branch several people touched, the
 * split matters more than the roll call, and a reviewer reads "mostly one
 * person, one drive-by commit" differently from "three people interleaved".
 * Ordered by count then name so the same range always reports the same way.
 */
export async function readAuthors(
  base: string,
  headRef: string,
  options: GitOptions,
): Promise<Author[]> {
  let output: string;
  try {
    output = await git(["log", "--format=%aN", `${base}..${headRef}`], options);
  } catch {
    return [];
  }

  const counts = new Map<string, number>();
  for (const line of output.split("\n")) {
    const name = line.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1));
}
