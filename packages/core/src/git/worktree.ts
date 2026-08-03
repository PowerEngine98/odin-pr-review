import { git } from "./exec.js";
import type { GitOptions } from "./exec.js";

/** A checkout of this repository, and the branch it holds. */
export interface Worktree {
  path: string;
  /** Short branch name, or undefined for a detached head. */
  branch?: string;
}

/**
 * Every checkout of this repository, including the one asking.
 *
 * A repository with worktrees has one branch per checkout and refuses to have
 * the same branch in two of them, which is the whole reason to ask: switching
 * to a branch someone already has open fails, and the failure is worth
 * explaining rather than relaying.
 */
export async function worktrees(options: GitOptions): Promise<Worktree[]> {
  const out = await git(["worktree", "list", "--porcelain"], options).catch(
    () => "",
  );
  if (!out) return [];

  const found: Worktree[] = [];
  let current: Worktree | undefined;

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) found.push(current);
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("branch ")) {
      // `refs/heads/topic` — the short name is what a reader recognises.
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (current) found.push(current);

  return found;
}

/** Where a branch is already checked out, if anywhere. */
export async function worktreeFor(
  branch: string,
  options: GitOptions,
): Promise<string | undefined> {
  const all = await worktrees(options);
  return all.find((tree) => tree.branch === branch)?.path;
}
