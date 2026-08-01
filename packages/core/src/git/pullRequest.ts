import { execFile } from "node:child_process";

import type { PullRequest } from "../model/types.js";
import type { GitOptions } from "./exec.js";

/**
 * The pull request a branch belongs to, if the forge knows of one.
 *
 * Asked of the `gh` command line rather than of an API directly, so it inherits
 * whatever authentication the reviewer already has and needs no configuration
 * of its own. Everything about this is best-effort: `gh` may be absent, logged
 * out, pointed at a host that has no such branch, or simply slow. A review of
 * the diff is perfectly useful without a title, so any of those is treated as
 * "no pull request" rather than as an error worth interrupting for.
 */
export async function readPullRequest(
  branch: string,
  options: GitOptions & { timeoutMs?: number },
): Promise<PullRequest | undefined> {
  const json = await run(
    ["pr", "view", branch, "--json", "number,title,url"],
    options,
  );
  if (!json) return undefined;

  try {
    const parsed = JSON.parse(json) as Partial<PullRequest>;
    if (
      typeof parsed.number !== "number" ||
      typeof parsed.title !== "string" ||
      typeof parsed.url !== "string"
    ) {
      return undefined;
    }
    return { number: parsed.number, title: parsed.title, url: parsed.url };
  } catch {
    return undefined;
  }
}

function run(
  args: string[],
  options: GitOptions & { timeoutMs?: number },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      {
        cwd: options.cwd,
        // Bounded so that a slow or hanging forge cannot hold up a review that
        // does not depend on it.
        timeout: options.timeoutMs ?? 4000,
        encoding: "utf8",
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}
