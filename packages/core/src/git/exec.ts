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
/**
 * The better-informed of a base branch and the forge's copy of it.
 *
 * The diff starts where the branch left the base, and "the base" is a moving
 * target: a long-lived `develop` gains commits daily. A checkout that has not
 * pulled for a week has a `develop` a week old, and the merge base computed
 * against it is a week old too — so everything that landed on `develop` in
 * that week and arrived on the branch through a merge is reported as part of
 * the change. The files are real and the diff is arithmetically correct; it is
 * simply answering a question nobody asked, about a base that no longer exists
 * anywhere but here. Somebody reviewing that sees a colleague's work with
 * their own name on the pull request.
 *
 * So when both copies are present, the one that contains the other wins. If
 * they have diverged — local commits on a base that were never pushed — the
 * forge's copy is preferred, because the pull request is measured against what
 * the forge has and a review that disagreed with the forge would be answering
 * a question about this machine.
 *
 * Only ever moves between a branch and its own remote-tracking ref, so it
 * cannot silently change which branch is being compared against.
 */
/**
 * Which side of a base branch a reading should be measured against.
 *
 * `forge` for a change as the forge has it — a pull request, a commit range.
 * The forge merges into its own copy of the base, so that is what the change is
 * a change to, whatever this checkout happens to have fetched or not fetched.
 * A stale local `development` makes a pull request look like it contains work
 * somebody else landed weeks ago.
 *
 * `local` for a reading of the files on disk. Comparing uncommitted work
 * against a branch this machine has not got is measuring against something the
 * reader cannot see; their own copy is the one they have been working from, and
 * differences from the forge belong to a different question.
 */
export type BaseSide = "forge" | "local";

/**
 * Whether this names a branch, as opposed to picking out a commit.
 *
 * `HEAD~4`, `abc1234` and `main@{yesterday}` are all things git will resolve,
 * and none of them is a branch: there is no remote-tracking copy of them to
 * prefer, and pasting `origin/` in front produces either nothing or — worse —
 * something that resolves to a different commit entirely. `origin/HEAD~4` is a
 * real revision in most repositories, four commits back from the default
 * branch, and it silently drifts every time anybody merges anything.
 */
function looksLikeBranch(ref: string): boolean {
  return !/[~^:@]|^[0-9a-f]{7,40}$/.test(ref);
}

/**
 * The copy of this base the reading should use.
 *
 * Named rather than guessed. This used to pick whichever copy was ahead, which
 * is a reasonable-sounding rule that gives different answers on different
 * machines: two reviewers looking at the same pull request saw different files
 * depending on when each of them last fetched.
 */
export async function sided(
  ref: string,
  options: GitOptions,
  prefer: BaseSide,
): Promise<string> {
  // Already says which side it means, or is not a branch at all.
  if (ref.includes("/") || !looksLikeBranch(ref)) return ref;

  const remote = `origin/${ref}`;
  const [hasRemote, hasLocal] = await Promise.all([
    refExists(remote, options),
    refExists(ref, options),
  ]);

  if (prefer === "forge") return hasRemote ? remote : ref;

  // A local reading still needs something that exists: a worktree, or a fresh
  // clone, often carries only the remote-tracking copy.
  if (!hasLocal) return remote;
  if (!hasRemote) return ref;

  /*
   * The reader's own copy, unless they have not fetched it in a while.
   *
   * A base branch this checkout is behind on is a base from before other
   * people's work landed, and measuring against it puts all of that work inside
   * the reader's change — which is the complaint this whole distinction exists
   * to answer. Their copy is preferred because it is what they have been
   * working from; it stops being preferable the moment it stops being current.
   */
  const counts = (
    await git(["rev-list", "--left-right", "--count", `${ref}...${remote}`], options)
      .catch(() => "")
  ).trim().split(/\s+/);
  const there = Number(counts[1]);
  return Number.isFinite(there) && there > 0 ? remote : ref;
}

export async function resolveBaseRef(
  preferred: string | undefined,
  options: GitOptions,
  // Local by default, which is what a caller with no view on the matter means:
  // this checkout's own copy while it is current, the forge's once it is not.
  // Asking for the forge's is a deliberate statement about whose change it is.
  prefer: BaseSide = "local",
): Promise<string> {
  const candidates: string[] = [];
  const add = (ref?: string) => {
    if (ref && !candidates.includes(ref)) candidates.push(ref);
  };

  if (preferred) {
    add(preferred);
    // A worktree may only carry the remote-tracking copy of the branch. Only
    // for something that is a branch: `origin/HEAD~4` resolves in most
    // repositories and means something else entirely.
    if (!preferred.includes("/") && looksLikeBranch(preferred)) {
      add(`origin/${preferred}`);
    }
  }
  add(await remoteDefaultBranch(options));
  for (const name of COMMON_BASES) {
    add(name);
    add(`origin/${name}`);
  }

  for (const candidate of candidates) {
    if (await refExists(candidate, options)) return sided(candidate, options, prefer);
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
