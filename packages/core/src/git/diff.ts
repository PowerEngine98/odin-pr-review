import { parseUnifiedDiff, type ParsedFile } from "../diff/parse.js";
import { buildGraph } from "../graph/build.js";
import { annotateTests } from "../graph/tests.js";
import type { ChangeGraph, GraphMeta, PullRequest } from "../model/types.js";
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
   * A base to fall back on when nothing better is known.
   *
   * Separate from `baseRef` because they mean different things. `baseRef` is
   * somebody asking for a comparison against something particular, and nothing
   * should overrule that. This is a workspace's stored preference, which the
   * pull request's own base beats — a setting left over from an afternoon's
   * debugging otherwise measures every change in that repository against the
   * wrong point for ever.
   */
  fallbackBaseRef?: string;
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
  /**
   * Diff the working tree rather than a commit.
   *
   * `HEAD` names a commit, so the ordinary reading of a branch stops at the
   * last thing committed — everything a reviewer has edited but not committed
   * is invisible to it. This compares the base to the files as they are on
   * disk, staged or not, which is the change the person at this keyboard
   * actually has. Only meaningful for the branch this checkout holds; ignored
   * when `headRef` names something else.
   *
   * Untracked files are left out. Git cannot diff a file it has never been
   * told about, and a build directory is not a change to review.
   */
  worktree?: boolean;
}

/** Raw patch text for a base..head comparison, taken from the merge base. */
export async function readPatch(req: DiffRequest): Promise<{
  patch: string;
  meta: GraphMeta;
}> {
  const headRef = req.headRef ?? "HEAD";

  /*
   * What the change is a change *to*.
   *
   * The forge is asked first when it is going to be asked at all, because it is
   * the only authority on this: a configured base is a preference and a
   * detected one is a guess, and when either disagrees with the pull request
   * the reader almost always meant the pull request. A workspace that still
   * carries `odin.baseRef` from some afternoon's debugging otherwise measures
   * every change against the wrong point for ever — and what that looks like is
   * not an error but other people's merged work appearing inside somebody's
   * branch, which is very hard to read as a misconfiguration.
   *
   * An explicit base still wins. Asking for a comparison against something
   * particular is a thing reviewers do, and the forge's answer is not more
   * correct than the question that was actually asked.
   */
  // Naming only the base leaves git comparing it to the files on disk. Naming
  // both compares two commits, and the working tree does not come into it.
  const dirty = req.worktree === true && (req.headRef === undefined || req.headRef === "HEAD");

  let pull: PullRequest | undefined;
  if (req.pullRequest) {
    const branch = (await currentBranch(req)) ?? headRef;
    pull = await readPullRequest(branch, req);
  }
  const wanted =
    req.baseRef ??
    (pull?.baseRefName ? pull.baseRefName : undefined) ??
    req.fallbackBaseRef;

  /*
   * And which copy of it.
   *
   * A pull request is the forge's, so it is measured against the forge's copy
   * of the base — that is what it will actually be merged into, whatever this
   * machine has or has not fetched. Two reviewers on the same change should see
   * the same files, and under the old rule they saw different ones depending on
   * when each of them last pulled.
   *
   * Everything else is the reader's own. A working tree compared against a
   * branch they have not got is measured against something they cannot see, and
   * commits sitting unpushed on their base are part of what their branch was
   * cut from rather than part of the change. Their copy is preferred there —
   * but only while it is current, because a base from before other people's
   * work landed puts all of that work inside their change, which is the
   * complaint this whole distinction exists to answer.
   */
  // The configured name may not exist here: worktrees and fresh clones often
  // carry only `origin/main`, and plenty of repositories still use `master`.
  const baseRef = await resolveBaseRef(
    wanted,
    req,
    !dirty && pull ? "forge" : "local",
  );
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
    ...(dirty ? [] : [headRef]),
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
  if (dirty) meta.worktree = true;
  if (req.stamp) meta.generatedAt = new Date().toISOString();

  const authors = await readAuthors(base, headRef, req);
  if (authors.length > 0) meta.authors = authors;

  if (pull) meta.pullRequest = pull;

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
