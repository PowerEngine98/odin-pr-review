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

/**
 * Where Odin keeps the checkouts it makes for itself.
 *
 * Inside the repository rather than beside it, because a sibling directory is
 * somebody else's business — a reader's projects folder is theirs to arrange —
 * and a path inside the repository is one git already knows how to hide.
 */
export const KEPT = ".worktrees";

/**
 * Makes the repository blind to the checkouts under it.
 *
 * A linked worktree inside the working tree is, to every command that walks
 * that tree, a directory full of a second copy of the project: `git status`
 * reports it as untracked, a diff of the working tree contains it, and a file
 * watcher over the project fires for every file in it. The reading of the main
 * checkout would be a reading of itself plus every branch the reader had ever
 * looked at.
 *
 * Written into `.git/info/exclude` rather than `.gitignore`. The exclusion is
 * this machine's arrangement, not the project's, and a tool that commits a line
 * to somebody's `.gitignore` to make its own bookkeeping tidy has changed the
 * repository to suit itself.
 */
export async function hideWorktrees(options: GitOptions): Promise<void> {
  const root = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], options))
    .trim();
  if (!root) return;

  const file = `${root}/info/exclude`;
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const line = `/${KEPT}/`;

  let held = "";
  try {
    held = await readFile(file, "utf8");
  } catch {
    // No exclude file yet, which is ordinary in a fresh clone.
    await mkdir(`${root}/info`, { recursive: true }).catch(() => undefined);
  }
  if (held.split("\n").some((l) => l.trim() === line)) return;

  const before = held.length === 0 || held.endsWith("\n") ? held : `${held}\n`;
  await writeFile(
    file,
    `${before}# Checkouts Odin keeps for reading branches side by side.\n${line}\n`,
    "utf8",
  );
}

/** A directory name a branch can safely become. */
export function asPath(branch: string): string {
  // Slashes are the common case — `feat/lab-147` — and everything else here is
  // a character a path can do without rather than a character git forbids.
  return branch.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
}

/**
 * A checkout of one branch that Odin may read from, made if there is not one.
 *
 * The reason this exists: a live reading is of a working tree, a working tree
 * holds one branch, and a reader comparing two changes as they are being worked
 * on needs two. Git's own answer is a linked worktree — a second checkout of
 * the same repository, with its own HEAD — and it refuses to put one branch in
 * two of them, which is exactly the rule that makes several live readings
 * coherent rather than contradictory.
 *
 * An existing checkout of that branch is used wherever it is: the reader may
 * have made one themselves, and a second copy of a branch they are working in
 * is both refused by git and the wrong thing to want.
 *
 * Nothing here touches the branch. `git worktree add` on an existing branch
 * checks it out somewhere else; it does not create, move or update it, and the
 * reader's own checkout is left exactly as it was.
 */
export async function readableCheckout(
  branch: string,
  options: GitOptions,
): Promise<{ path: string; made: boolean }> {
  const already = await worktreeFor(branch, options);
  if (already) return { path: already, made: false };

  await hideWorktrees(options);

  const root = (
    await git(["rev-parse", "--path-format=absolute", "--show-toplevel"], options)
  ).trim();
  const path = `${root}/${KEPT}/${asPath(branch)}`;

  /*
   * `--force` is deliberately absent.
   *
   * Every failure this can have is one worth reporting rather than driving
   * through: the branch is checked out elsewhere, the path is in the way, the
   * repository is mid-operation. Forcing past any of those to make a picture is
   * a tool taking a decision about somebody's working tree in order to draw.
   */
  await git(["worktree", "add", path, branch], options);
  return { path, made: true };
}
