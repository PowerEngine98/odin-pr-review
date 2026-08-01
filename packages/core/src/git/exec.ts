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
