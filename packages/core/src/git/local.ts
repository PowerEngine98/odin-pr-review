import { git } from "./exec.js";
import type { GitOptions } from "./exec.js";
import { worktrees } from "./worktree.js";

/**
 * A branch as this machine has it, next to the forge's copy.
 *
 * The forge's answer to "what is in this pull request" is the commit it was
 * pushed at. That is often not what the person reviewing it has: they may have
 * the branch checked out with work on top, committed or not. Those are two
 * different changes with one name, and a list that shows only the forge's
 * reading quietly hides the other.
 */
export interface LocalBranch {
  branch: string;
  /** Commits here that `origin` does not have. */
  ahead: number;
  /** Commits on `origin` that this copy does not have. */
  behind: number;
  /** The checkout holding it, when some checkout does. */
  worktree?: string;
  /** Tracked files with uncommitted changes in that checkout. */
  uncommitted: number;
  /** There is a local branch, but the forge no longer has its counterpart. */
  gone?: boolean;
}

/**
 * Whether a local copy is worth offering as a second reading of the change.
 *
 * Being behind is not: a branch the reader has simply not pulled is still the
 * pull request, and offering "yours" and "theirs" for it would be a choice
 * between the same change and an older version of it. Commits on top, or
 * uncommitted work in the tree, are what the forge genuinely does not have.
 */
export function differs(local: LocalBranch | undefined): boolean {
  if (!local) return false;
  return local.ahead > 0 || local.uncommitted > 0;
}

/** `[ahead 3, behind 2]` and its friends, as two numbers. */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const gone = /\bgone\b/.test(track);
  const ahead = /\bahead (\d+)/.exec(track);
  const behind = /\bbehind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone,
  };
}

/**
 * Every local branch, and how far it has drifted from the forge.
 *
 * One `for-each-ref` rather than a `rev-list` per branch: the chooser asks this
 * on every refresh, and a repository with fifty branches would otherwise be
 * fifty processes for a list nobody has looked at yet.
 *
 * Uncommitted work belongs to a checkout, not to a branch — there is nowhere
 * for a branch nobody has checked out to keep any. So the trees are listed and
 * each is asked about its own, which bounds the cost by how many checkouts
 * exist rather than by how many branches do. Untracked files are left out: a
 * build directory is not a change to review.
 */
export async function localBranches(
  options: GitOptions & {
    /**
     * Branches the caller actually cares about. A branch that was pushed by
     * something that did not set an upstream — or pushed from another clone
     * entirely — has no `%(upstream)` for git to count against, and would be
     * reported as matching the forge when it does not. Those are compared to
     * `origin/<branch>` one at a time, which is why the caller says which ones
     * are worth the calls rather than every branch in the repository paying.
     */
    branches?: readonly string[];
  },
): Promise<Map<string, LocalBranch>> {
  const listed = await git(
    [
      "for-each-ref",
      "--format=%(refname:short)%09%(upstream)%09%(upstream:track)",
      "refs/heads",
    ],
    options,
  ).catch(() => "");

  const found = new Map<string, LocalBranch>();
  for (const line of listed.split("\n")) {
    if (!line.trim()) continue;
    const [branch = "", upstream = "", track = ""] = line.split("\t");
    if (!branch) continue;
    const { ahead, behind, gone } = parseTrack(track);
    found.set(branch, {
      branch,
      ahead,
      behind,
      uncommitted: 0,
      ...(gone || !upstream ? { gone: true } : {}),
    });
  }

  await Promise.all(
    (options.branches ?? [])
      .map((branch) => found.get(branch))
      .filter((local): local is LocalBranch => local?.gone === true)
      .map(async (local) => {
        const counts = (
          await git(
            [
              "rev-list",
              "--left-right",
              "--count",
              `refs/remotes/origin/${local.branch}...refs/heads/${local.branch}`,
            ],
            options,
          ).catch(() => "")
        )
          .trim()
          .split(/\s+/);
        // No such remote branch: the forge really has nothing by this name, and
        // `gone` is the truth rather than a missing upstream setting.
        if (counts.length < 2) return;
        local.behind = Number(counts[0]) || 0;
        local.ahead = Number(counts[1]) || 0;
        delete local.gone;
      }),
  );

  const trees = (await worktrees(options)).filter((tree) => tree.branch);
  await Promise.all(
    trees.map(async (tree) => {
      const local = found.get(tree.branch!);
      if (!local) return;
      local.worktree = tree.path;
      // A tree that has been moved or deleted but not pruned still shows up in
      // the list. It has no changes to report and is not worth an error.
      const dirty = (
        await git(["status", "--porcelain", "--untracked-files=no"], {
          ...options,
          cwd: tree.path,
        }).catch(() => "")
      ).trim();
      local.uncommitted = dirty === "" ? 0 : dirty.split("\n").length;
    }),
  );

  return found;
}
