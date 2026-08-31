import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Bringing this copy of Odin level with what is on main.
 *
 * Odin is installed from a checkout rather than from a registry, so updating it
 * is "pull, then build, then put the result back in the editor" — which is what
 * anybody would do by hand, and is three commands and a directory to remember.
 * The directory is the part that goes wrong: the command on your PATH is a
 * symlink into a clone whose location nobody has thought about since the day
 * they made it.
 */

export interface UpdateOptions {
  /** Where Odin lives. Worked out from this very file when not given. */
  root?: string;
  /** Say what would happen and change nothing. */
  dryRun?: boolean;
  /** The branch to follow. */
  branch?: string;
}

/**
 * The checkout this copy of Odin was built from.
 *
 * Followed through the symlink deliberately: `odin` on a PATH is a link into
 * the clone, and asking the link where it is would answer `~/.local/bin`. What
 * is wanted is the repository behind it, which is two directories above the
 * compiled entry point.
 */
export function odinRoot(from: string = fileURLToPath(import.meta.url)): string {
  const here = realpathSync(from);
  // …/packages/cli/dist/update.js → …/packages/cli → the workspace root.
  return dirname(dirname(dirname(dirname(here))));
}

/** What the update did, so the caller can say it rather than guess. */
export interface Updated {
  root: string;
  branch: string;
  /** Where it was, and where it is now. Equal when nothing arrived. */
  was: string;
  now: string;
  /** Commits that arrived, newest first, for a short summary. */
  arrived: string[];
  installed: boolean;
}

/**
 * Pulls the latest main and installs what came with it.
 *
 * Fast-forward only, and refused outright over local changes. An update is
 * meant to be the boring option: it should never be the thing that starts a
 * merge, resolves a conflict, or quietly stashes work somebody was in the
 * middle of. Where it cannot be boring it stops and says what is in the way.
 */
export async function update(
  options: UpdateOptions = {},
  say: (line: string) => void = () => {},
): Promise<Updated> {
  const root = options.root ?? odinRoot();
  const branch = options.branch ?? "main";
  const git = (...args: string[]) => run("git", args, { cwd: root });

  if (!existsSync(join(root, ".git"))) {
    throw new Error(
      `${root} is not a git checkout, so there is nothing to pull. ` +
        "Odin updates the clone it was installed from.",
    );
  }

  const dirty = (await git("status", "--porcelain")).stdout.trim();
  if (dirty) {
    throw new Error(
      `${root} has changes that are not committed. Odin will not pull over ` +
        "them; commit or stash them first.",
    );
  }

  const on = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
  if (on !== branch) {
    throw new Error(
      `${root} is on ${on}, not ${branch}. Switch to ${branch} first, or say ` +
        `--branch ${on} if that is what you meant to follow.`,
    );
  }

  const was = (await git("rev-parse", "HEAD")).stdout.trim();

  if (options.dryRun) {
    say(`would pull ${branch} into ${root} and run scripts/install.sh`);
    return { root, branch, was, now: was, arrived: [], installed: false };
  }

  say(`Pulling ${branch}`);
  await git("fetch", "origin", branch);
  /*
   * `merge --ff-only` rather than `pull`, and that is the whole safety of it.
   * A pull is allowed to make a merge commit, and an update that quietly wrote
   * one — or stopped halfway through a conflict — would leave somebody's copy
   * of Odin in a state they did not ask for and cannot read.
   */
  await git("merge", "--ff-only", `origin/${branch}`);

  const now = (await git("rev-parse", "HEAD")).stdout.trim();
  const arrived = was === now
    ? []
    : (await git("log", "--oneline", `${was}..${now}`)).stdout.trim().split("\n");

  if (was === now) {
    say("Already the latest.");
    return { root, branch, was, now, arrived, installed: false };
  }

  for (const line of arrived.slice(0, 10)) say(`  ${line}`);
  if (arrived.length > 10) say(`  …and ${arrived.length - 10} more`);

  /*
   * The same script a first install runs, rather than a second description of
   * how to build this. It installs dependencies, builds, packages the
   * extension, installs it, and relinks the command line tool — and if any of
   * that changes, an update changes with it.
   */
  say("Building and installing");
  const script = join(root, "scripts", "install.sh");
  if (!existsSync(script)) {
    throw new Error(
      `The new version has no ${script}, so this cannot install itself. ` +
        "Build it by hand: yarn install && yarn build",
    );
  }
  await run("bash", [script], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

  return { root, branch, was, now, arrived, installed: true };
}
