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
 * The open pull requests on this repository, most recently active first.
 *
 * Activity is what a reviewer is actually looking for: the branch somebody
 * pushed to an hour ago is the one waiting on them, and the one that has not
 * moved in a fortnight is not. Within the same hour the order falls back to
 * creation, so a burst of comments across several pull requests does not
 * reshuffle them under the reader between one refresh and the next.
 */
export async function listPullRequests(
  options: GitOptions & { timeoutMs?: number; limit?: number },
): Promise<PullRequestSummary[]> {
  const json = await run(
    [
      "pr", "list",
      "--state", "open",
      "--limit", String(options.limit ?? 50),
      "--json",
      "number,title,url,headRefName,headRefOid,isDraft,author,createdAt,updatedAt," +
        "reviewDecision,reviewRequests",
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
      headRefOid?: string;
      isDraft: boolean;
      author?: { login?: string };
      createdAt: string;
      updatedAt?: string;
      reviewDecision?: string | null;
      reviewRequests?: { login?: string; slug?: string; name?: string }[];
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
        // The commit the branch is on, so a reader can be told when it has
        // moved since they last looked at it.
        if (pr.headRefOid) summary.headSha = pr.headRefOid;
        // `pr list` does not carry a picture, and the forge serves one at a
        // predictable address. Whoever draws it has to inline it anyway.
        if (pr.author?.login) {
          summary.avatarUrl = `https://github.com/${pr.author.login}.png`;
        }
        if (pr.updatedAt) summary.updatedAt = pr.updatedAt;
        // Who the forge is waiting on. A reviewer's own list starts here.
        const asked = (pr.reviewRequests ?? [])
          .map((who) => who.login ?? who.slug ?? who.name ?? "")
          .filter(Boolean);
        if (asked.length > 0) summary.requestedFrom = asked;
        if (pr.reviewDecision) summary.reviewDecision = pr.reviewDecision;
        return summary;
      })
      .sort(byActivity);
  } catch {
    return [];
  }
}

/**
 * Most recently active first, with creation as the tie-break.
 *
 * "Same hour" rather than "same instant": two pull requests touched minutes
 * apart are, to a reader scanning the list, equally recent, and letting a
 * comment on one of them jump it above the other every few minutes makes the
 * list impossible to learn. The hour is coarse enough to hold still and fine
 * enough to keep today above yesterday.
 */
export function byActivity(
  a: PullRequestSummary,
  b: PullRequestSummary,
): number {
  const hourA = hourOf(a.updatedAt ?? a.createdAt);
  const hourB = hourOf(b.updatedAt ?? b.createdAt);
  if (hourA !== hourB) return hourA < hourB ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.number - b.number;
}

/** An ISO timestamp cut back to the hour, which is all the order uses. */
function hourOf(stamp: string): string {
  return stamp.slice(0, 13);
}
