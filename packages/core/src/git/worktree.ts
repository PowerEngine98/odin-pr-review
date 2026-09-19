import { isAbsolute, join, resolve } from "node:path";

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

/**
 * The files git writes when this checkout's history moves, and nothing else.
 *
 * A live reading is measured from the merge base, and the merge base moves
 * when `HEAD` does — a merge committed, a rebase, a reset, a pull, another
 * branch checked out. None of those need write a single file of the project:
 * committing a merge whose conflicts were resolved a minute ago changes
 * history and leaves the working tree exactly as it was. A reading that only
 * listened to the working tree therefore went on showing `development`'s files
 * as part of a branch that had merely absorbed them, until the reader reloaded
 * by hand.
 *
 * So these are what is listened to instead. `HEAD` itself for a checkout or a
 * detached head; its reflog, which git appends to on every move of `HEAD`
 * including a commit on the branch it names; `ORIG_HEAD` and `MERGE_HEAD`,
 * which a merge, a reset and a rebase write and a completed merge removes; the
 * loose ref of the branch that is checked out; and `packed-refs`, where that
 * ref lives once git has packed it.
 *
 * Asked of git rather than assumed to be under `<repo>/.git`, because in a
 * linked worktree it is not. There `.git` is a file pointing elsewhere: `HEAD`
 * and its reflog belong to the worktree's own directory inside the main
 * repository's `.git/worktrees`, and the branches to the main repository's
 * common directory. A watcher on `<repo>/.git/HEAD` sees nothing at all in a
 * worktree — which is where the reader who found this works.
 *
 * Deliberately not the remote-tracking refs or `FETCH_HEAD`. An editor fetches
 * in the background every few minutes, and a fetch moves no merge base that
 * the reader's own branch has not moved first; rebuilding for each one would
 * be a full recompute on a timer, for nothing.
 *
 * Empty outside a repository, which is an answer rather than a failure: there
 * is then no history to watch.
 */
export async function historyFiles(options: GitOptions): Promise<string[]> {
  const out = await git(
    ["rev-parse", "--absolute-git-dir", "--git-common-dir", "--symbolic-full-name", "HEAD"],
    options,
  ).catch(() => "");
  const [gitDir, commonDir, branch] = out.split("\n").map((line) => line.trim());
  if (!gitDir || !commonDir) return [];

  // Relative to where git was asked from when it is not already absolute, which
  // for the main checkout it usually is not: plain `.git`.
  const common = isAbsolute(commonDir) ? commonDir : resolve(options.cwd, commonDir);
  const files = [
    join(gitDir, "HEAD"),
    join(gitDir, "ORIG_HEAD"),
    join(gitDir, "MERGE_HEAD"),
    join(gitDir, "logs", "HEAD"),
    join(common, "packed-refs"),
  ];
  // A detached head answers `HEAD` here, and has no branch ref to watch: every
  // move of it is a write to `HEAD` itself, which is already on the list.
  if (branch?.startsWith("refs/")) files.push(join(common, ...branch.split("/")));
  return files;
}
