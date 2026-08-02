import { execFile } from "node:child_process";

import type { Reviewer, PullRequest, PullRequestSummary } from "../model/types.js";
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
    [
      "pr", "view", branch,
      "--json", "number,title,url,isDraft,reviewDecision,reviewRequests,latestReviews",
    ],
    options,
  );
  if (!json) return undefined;

  try {
    const parsed = JSON.parse(json) as Partial<PullRequest> & {
      isDraft?: boolean;
      reviewDecision?: string | null;
      reviewRequests?: { login?: string; name?: string; slug?: string }[];
      latestReviews?: {
        state?: string;
        author?: { login?: string; url?: string };
      }[];
    };
    if (
      typeof parsed.number !== "number" ||
      typeof parsed.title !== "string" ||
      typeof parsed.url !== "string"
    ) {
      return undefined;
    }

    const pull: PullRequest = {
      number: parsed.number,
      title: parsed.title,
      url: parsed.url,
    };
    if (parsed.isDraft === true) pull.draft = true;
    if (parsed.reviewDecision) pull.reviewDecision = parsed.reviewDecision;

    const reviewers = readReviewers(parsed.reviewRequests, parsed.latestReviews);
    if (reviewers.length > 0) pull.reviewers = reviewers;
    return pull;
  } catch {
    return undefined;
  }
}

/**
 * Who is on the review, and what they have said.
 *
 * Two lists from the forge and one answer: the reviews people have left, and
 * the requests nobody has answered yet. Somebody who has already spoken is not
 * also waiting, so a request is only carried through when it has no review
 * against it. Faces come from the avatar service by login, which needs no
 * second call and no token.
 */
function readReviewers(
  requests: { login?: string; name?: string; slug?: string }[] | undefined,
  reviews: { state?: string; author?: { login?: string; url?: string } }[] | undefined,
): Reviewer[] {
  const out: Reviewer[] = [];
  const seen = new Set<string>();

  for (const review of reviews ?? []) {
    const login = review.author?.login;
    if (!login || seen.has(login)) continue;
    seen.add(login);
    out.push({
      login,
      state: review.state ?? "COMMENTED",
      url: review.author?.url ?? `https://github.com/${login}`,
      avatarUrl: `https://github.com/${login}.png?size=64`,
    });
  }

  for (const request of requests ?? []) {
    // A team request has a slug where a person has a login, and no face.
    const login = request.login ?? request.slug ?? request.name;
    if (!login || seen.has(login)) continue;
    seen.add(login);

    const reviewer: Reviewer = {
      login,
      state: "PENDING",
      url: request.login
        ? `https://github.com/${request.login}`
        : `https://github.com/orgs/${login}/teams`,
    };
    if (request.login) reviewer.avatarUrl = `https://github.com/${request.login}.png?size=64`;
    else reviewer.team = true;
    out.push(reviewer);
  }

  return out;
}

/**
 * Places a command line tool is installed that a windowed application will not
 * find on its own.
 *
 * An editor launched from the dock inherits a bare PATH, not the one a login
 * shell builds, so anything installed by Homebrew or asdf is invisible to it.
 * Without this the pull request lookup fails silently in the editor while
 * working perfectly from a terminal, which is a maddening thing to debug.
 */
const EXTRA_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/opt/local/bin",
  `${process.env.HOME ?? ""}/.local/bin`,
];

/** The environment to run the forge client in, with those places added. */
export function forgeEnv(): NodeJS.ProcessEnv {
  const parts = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of EXTRA_PATH) {
    if (dir && !parts.includes(dir)) parts.push(dir);
  }
  return { ...process.env, PATH: parts.join(":") };
}

/**
 * Runs a `gh` command and hands back its output, or nothing.
 *
 * Shared with the other readers here so they all fail the same way: `gh` may
 * be missing, signed out, pointed at a host with no such branch, or slow, and
 * none of those is worth interrupting a review for.
 */
export function run(
  args: string[],
  options: GitOptions & { timeoutMs?: number },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      {
        cwd: options.cwd,
        env: forgeEnv(),
        // Bounded so that a slow or hanging forge cannot hold up a review that
        // does not depend on it.
        timeout: options.timeoutMs ?? 4000,
        encoding: "utf8",
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

/**
 * The open pull requests on this repository, newest first.
 *
 * Ordered by creation rather than by update, because "what is in flight" is a
 * more stable thing to scan than "what was touched last", which reshuffles
 * under the reader whenever anyone comments.
 */
export async function listPullRequests(
  options: GitOptions & { timeoutMs?: number; limit?: number },
): Promise<PullRequestSummary[]> {
  const json = await run(
    [
      "pr", "list",
      "--state", "open",
      "--limit", String(options.limit ?? 50),
      "--json", "number,title,url,headRefName,isDraft,author,createdAt,reviewDecision",
    ],
    options,
  );
  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as {
      number: number;
      title: string;
      url: string;
      headRefName: string;
      isDraft: boolean;
      author?: { login?: string };
      createdAt: string;
      reviewDecision?: string | null;
    }[];

    return parsed
      .map((pr) => {
        const summary: PullRequestSummary = {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          branch: pr.headRefName,
          draft: pr.isDraft === true,
          author: pr.author?.login ?? "",
          createdAt: pr.createdAt,
        };
        if (pr.reviewDecision) summary.reviewDecision = pr.reviewDecision;
        return summary;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.number - b.number));
  } catch {
    return [];
  }
}
