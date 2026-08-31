import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Bringing a copy of Odin level with what is on main, and installing it.
 *
 * Odin is installed from a checkout rather than from a registry, so updating it
 * is "pull, then build, then put the result back in the editor" — which anybody
 * could do by hand, and is three commands and a directory to remember.
 *
 * Which directory is the interesting part. Somebody standing in a clone means
 * *this* clone, including whatever they have not committed yet: the common
 * reason to reinstall is to try the change you just made. Somebody standing
 * anywhere else means the copy that is installed. And somebody with no clone at
 * all means "fetch me one", which is a thing this can do rather than a thing to
 * tell them to do.
 */

/** Where Odin comes from, for a machine that has no clone of it yet. */
export const ORIGIN = "https://github.com/PowerEngine98/odin-pr-review.git";

export interface UpdateOptions {
  /** Where the command was run. The first place looked. */
  cwd?: string;
  /** Skip the search and use this checkout. */
  root?: string;
  /** Say what would happen and change nothing. */
  dryRun?: boolean;
  /** The branch a pull follows. */
  branch?: string;
  /** Where to clone from when there is no checkout anywhere. */
  origin?: string;
  /** Where a fetched clone is kept. */
  home?: string;
  /**
   * The checkout this command was built from.
   *
   * Worked out from the running file when not given, and given by tests, which
   * cannot otherwise reach the second of the three answers: the file they are
   * running *is* inside a clone of Odin.
   */
  installed?: string;
}

/** Which of the three checkouts this ended up working on. */
export type Where = "here" | "installed" | "fetched";

/** How a checkout stands against the branch it follows. */
export interface Standing {
  branch: string;
  /** Changes that are not committed, which are reason enough to install. */
  dirty: boolean;
  /** Commits here that main has not got. */
  ahead: number;
  /** Commits on main that are not here. */
  behind: number;
}

export interface Updated {
  root: string;
  where: Where;
  standing: Standing;
  /** Whether anything was actually pulled. */
  pulled: boolean;
  /** Commits that arrived, newest first. */
  arrived: string[];
  installed: boolean;
  /** What was built and installed, in one line, for the caller to print. */
  because: string;
}

/**
 * Whether a directory is the root of an Odin clone.
 *
 * Asked of the workspace manifest rather than of the directory's name, because
 * a clone can be called anything and usually is.
 */
export function isOdinCheckout(dir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return manifest.name === "odin-pr-review-workspace";
  } catch {
    return false;
  }
}

/**
 * The Odin clone a directory is inside, if it is inside one.
 *
 * Walked upwards, so running this from `packages/cli` — or from anywhere under
 * the tree — means the same thing as running it from the root.
 */
export function findCheckout(from: string): string | undefined {
  let here = from;
  const stop = parse(here).root;
  for (;;) {
    if (isOdinCheckout(here)) return here;
    if (here === stop) return undefined;
    here = dirname(here);
  }
}

/**
 * The checkout this copy of Odin was built from.
 *
 * Followed through the symlink deliberately: `odin` on a PATH is a link into
 * the clone, and asking the link where it is would answer `~/.local/bin`, which
 * has no repository in it and never will.
 */
export function odinRoot(from: string = fileURLToPath(import.meta.url)): string {
  const here = realpathSync(from);
  // …/packages/cli/dist/update.js → …/packages/cli → the workspace root.
  return dirname(dirname(dirname(dirname(here))));
}

/**
 * Where a clone is kept for a machine that had none.
 *
 * Under the data directory rather than beside the binary: it is a checkout that
 * gets rebuilt, not a program, and somebody who goes looking for it should find
 * it where their other tools keep such things.
 */
export function fetchedPath(home: string = homedir()): string {
  const data = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(data, "odin", "checkout");
}

/** Where this update will work, and how that was decided. */
export async function chooseRoot(
  options: UpdateOptions = {},
  say: (line: string) => void = () => {},
): Promise<{ root: string; where: Where }> {
  if (options.root) return { root: options.root, where: "here" };

  const here = findCheckout(options.cwd ?? process.cwd());
  if (here) return { root: here, where: "here" };

  const installed = options.installed ?? odinRoot();
  if (existsSync(join(installed, ".git")) && isOdinCheckout(installed)) {
    return { root: installed, where: "installed" };
  }

  /*
   * Nowhere to update from, so one is fetched.
   *
   * This is the case where Odin was copied onto a machine rather than cloned
   * onto it — the extension installed from a `.vsix`, or a binary handed over.
   * Telling that reader to go and clone something is telling them to do the
   * one thing this command is for.
   */
  const kept = fetchedPath(options.home);
  if (!existsSync(join(kept, ".git"))) {
    const origin = options.origin ?? ORIGIN;
    say(`No checkout here or behind the command, so fetching one into ${kept}`);
    mkdirSync(dirname(kept), { recursive: true });
    await run("git", ["clone", origin, kept]);
  }
  return { root: kept, where: "fetched" };
}

/** How a checkout stands against the branch it follows, having asked the forge. */
export async function standing(
  root: string,
  branch: string,
  fetch = true,
): Promise<Standing> {
  const git = (...args: string[]) => run("git", args, { cwd: root });

  const on = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
  const dirty = (await git("status", "--porcelain")).stdout.trim() !== "";

  if (fetch) {
    // Best effort: a machine with no network, or a clone with no remote, is
    // still a copy of Odin somebody can build.
    await git("fetch", "origin", branch).catch(() => undefined);
  }

  let ahead = 0;
  let behind = 0;
  try {
    const counts = (
      await git("rev-list", "--left-right", "--count", `origin/${branch}...HEAD`)
    ).stdout.trim().split(/\s+/);
    behind = Number(counts[0] ?? 0);
    ahead = Number(counts[1] ?? 0);
  } catch {
    // No `origin/<branch>` to compare against. Nothing to pull, then.
  }

  return { branch: on, dirty, ahead, behind };
}

/**
 * Updates a copy of Odin and installs it.
 *
 * The rule, in one sentence: local work wins. A checkout with changes of its
 * own — uncommitted, or committed and not yet on main — is installed as it
 * stands, because that is what somebody standing in it means. Only a clean
 * checkout that is purely behind gets pulled, and it is pulled by
 * fast-forward, so an update is never the thing that starts a merge or
 * resolves a conflict on somebody's behalf.
 */
export async function update(
  options: UpdateOptions = {},
  say: (line: string) => void = () => {},
): Promise<Updated> {
  const branch = options.branch ?? "main";
  const { root, where } = await chooseRoot(options, say);
  const git = (...args: string[]) => run("git", args, { cwd: root });

  if (!existsSync(join(root, ".git"))) {
    throw new Error(
      `${root} is not a git checkout, so there is nothing to compare against. ` +
        "Odin updates a clone of itself.",
    );
  }

  say(
    where === "here"
      ? `Odin in ${root}`
      : where === "installed"
        ? `Odin as installed, in ${root}`
        : `Odin in the copy it keeps, ${root}`,
  );

  const state = await standing(root, branch);
  const was = (await git("rev-parse", "HEAD")).stdout.trim();

  /*
   * What the checkout is: ahead, behind, both, or neither. Said before
   * anything happens, because which of the four it is decides everything
   * below and the reader should not have to infer it from what follows.
   */
  const local = state.dirty || state.ahead > 0;
  const parts: string[] = [];
  if (state.dirty) parts.push("changes that are not committed");
  if (state.ahead > 0) parts.push(`${state.ahead} commit${state.ahead === 1 ? "" : "s"} main has not got`);
  if (state.behind > 0) parts.push(`${state.behind} behind ${branch}`);
  say(parts.length > 0 ? `  ${parts.join(", ")}` : `  level with ${branch}`);

  const pulling = !local && state.behind > 0 && state.branch === branch;

  if (options.dryRun) {
    const would = pulling
      ? `would fast-forward ${branch} and install`
      : local
        ? "would install this checkout as it stands"
        : state.behind > 0
          ? `would install this checkout as it stands; it is on ${state.branch}, so ${branch} is left alone`
          : "would do nothing; it is already the latest";
    say(would);
    return {
      root, where, standing: state, pulled: false, arrived: [],
      installed: false, because: would,
    };
  }

  let arrived: string[] = [];
  if (pulling) {
    say(`Pulling ${branch}`);
    /*
     * `merge --ff-only` rather than `pull`. A pull may write a merge commit,
     * and an update that quietly wrote one — or stopped halfway through a
     * conflict — would leave somebody's copy of Odin in a state they did not
     * ask for and cannot read.
     */
    await git("merge", "--ff-only", `origin/${branch}`);
    const now = (await git("rev-parse", "HEAD")).stdout.trim();
    arrived = was === now
      ? []
      : (await git("log", "--oneline", `${was}..${now}`)).stdout.trim().split("\n");
    for (const line of arrived.slice(0, 10)) say(`  ${line}`);
    if (arrived.length > 10) say(`  …and ${arrived.length - 10} more`);
  }

  /*
   * Nothing local, nothing pulled, nothing to do.
   *
   * Rebuilding an unchanged copy is a minute of somebody's time for the answer
   * they already had. A checkout with work of its own is never in this branch,
   * because "install what I have" is the whole reason to run this from one.
   */
  if (!local && arrived.length === 0) {
    const because = state.behind > 0
      ? `on ${state.branch}, ${state.behind} behind ${branch} — left alone`
      : "already the latest";
    say(because === "already the latest" ? "Already the latest." : `Nothing done: ${because}.`);
    return { root, where, standing: state, pulled: false, arrived, installed: false, because };
  }

  const because = arrived.length > 0
    ? `${arrived.length} commit${arrived.length === 1 ? "" : "s"} from ${branch}`
    : state.dirty && state.ahead > 0
      ? `this checkout: ${state.ahead} commit${state.ahead === 1 ? "" : "s"} of its own and changes on top`
      : state.dirty
        ? "this checkout, changes and all"
        : `this checkout: ${state.ahead} commit${state.ahead === 1 ? "" : "s"} main has not got`;

  /*
   * The same script a first install runs, rather than a second description of
   * how to build this. It installs dependencies, builds, packages the
   * extension, installs it and relinks the command line tool — and when that
   * changes, an update changes with it.
   */
  say(`Building and installing ${because}`);
  const script = join(root, "scripts", "install.sh");
  if (!existsSync(script)) {
    throw new Error(
      `There is no ${script}, so this cannot install itself. ` +
        "Build it by hand: yarn install && yarn build",
    );
  }
  await run("bash", [script], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

  return {
    root, where, standing: state, pulled: arrived.length > 0, arrived,
    installed: true, because,
  };
}
