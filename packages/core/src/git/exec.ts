import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitOptions {
  /** Repository working directory. */
  cwd: string;
  /** Raise the buffer for large patches; git output can be tens of megabytes. */
  maxBuffer?: number;
}

/**
 * Runs git and returns stdout.
 *
 * Uses `execFile`, never a shell, so refs and paths containing shell
 * metacharacters cannot be interpreted as commands.
 */
export async function git(args: string[], options: GitOptions): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout;
}

export async function revParse(ref: string, options: GitOptions): Promise<string> {
  return (await git(["rev-parse", ref], options)).trim();
}

/**
 * The commit a pull request is actually diffed against: where the branch left
 * the base, not the current tip of the base. Using the tip would surface
 * unrelated changes that landed on the base after the branch was cut.
 */
export async function mergeBase(
  baseRef: string,
  headRef: string,
  options: GitOptions,
): Promise<string> {
  return (await git(["merge-base", baseRef, headRef], options)).trim();
}

export async function repoRoot(options: GitOptions): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], options)).trim();
}

/**
 * Branch name at HEAD, or undefined when the checkout is detached.
 *
 * Worth resolving before recording it: a graph whose metadata says "HEAD" tells
 * a reader nothing once the file is saved or shared, and a panel titled
 * "main → HEAD" is no help when two reviews are open at once.
 */
export async function currentBranch(
  options: GitOptions,
): Promise<string | undefined> {
  try {
    const name = (await git(["rev-parse", "--abbrev-ref", "HEAD"], options)).trim();
    return name && name !== "HEAD" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Bases to try when none is configured, most likely first. */
const COMMON_BASES = ["main", "master", "develop", "trunk"];

/** Whether a ref names something git can resolve to a commit. */
export async function refExists(
  ref: string,
  options: GitOptions,
): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], options);
    return true;
  } catch {
    return false;
  }
}

/** The default branch the origin remote points at, e.g. `origin/main`. */
export async function remoteDefaultBranch(
  options: GitOptions,
): Promise<string | undefined> {
  try {
    const ref = (
      await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], options)
    ).trim();
    return ref || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds a base branch that actually exists in this checkout.
 *
 * A configured name is not enough on its own. Worktrees and fresh clones very
 * often have no local `main` at all — only `origin/main` — and plenty of
 * repositories still use `master`. Passing an unresolvable name straight to
 * `git merge-base` produces "fatal: Not a valid object name", which tells a
 * reviewer nothing about what to do next.
 */
export async function resolveBaseRef(
  preferred: string | undefined,
  options: GitOptions,
): Promise<string> {
  const candidates: string[] = [];
  const add = (ref?: string) => {
    if (ref && !candidates.includes(ref)) candidates.push(ref);
  };

  if (preferred) {
    add(preferred);
    // A worktree may only carry the remote-tracking copy of the branch.
    if (!preferred.includes("/")) add(`origin/${preferred}`);
  }
  add(await remoteDefaultBranch(options));
  for (const name of COMMON_BASES) {
    add(name);
    add(`origin/${name}`);
  }

  for (const candidate of candidates) {
    if (await refExists(candidate, options)) return candidate;
  }

  const available = await listRefs(options);
  const tried = candidates.join(", ");
  throw new Error(
    `no base branch found (tried ${tried}). ` +
      (available.length
        ? `This repository has: ${available.slice(0, 12).join(", ")}. ` +
          `Set odin.baseRef, or pass --base.`
        : "This repository has no branches yet."),
  );
}

/** Branch names in the repository, most recently committed first. */
export async function listRefs(options: GitOptions): Promise<string[]> {
  try {
    const output = await git(
      ["for-each-ref", "--format=%(refname:short)", "--sort=-committerdate",
       "refs/heads", "refs/remotes"],
      options,
    );
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
