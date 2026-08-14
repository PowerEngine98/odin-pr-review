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
      "--json",
      "number,title,url,isDraft,state,baseRefName,reviewDecision,reviewRequests,latestReviews",
    ],
    options,
  );
  if (!json) return undefined;

  try {
    const parsed = JSON.parse(json) as Partial<PullRequest> & {
      isDraft?: boolean;
      state?: string;
      baseRefName?: string;
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
    if (parsed.state) pull.state = parsed.state;
    if (parsed.baseRefName) pull.baseRefName = parsed.baseRefName;
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

/** Which pull requests to ask the forge for. */
export type PullRequestState = "open" | "merged" | "closed" | "all";

/**
 * The pull requests on this repository, most recently active first.
 *
 * Activity is what a reviewer is actually looking for: the branch somebody
 * pushed to an hour ago is the one waiting on them, and the one that has not
 * moved in a fortnight is not. Within the same hour the order falls back to
 * creation, so a burst of comments across several pull requests does not
 * reshuffle them under the reader between one refresh and the next.
 */
export async function listPullRequests(
  options: GitOptions & {
    timeoutMs?: number;
    limit?: number;
    /**
     * Which pull requests to ask for. Open by default, since that is what a
     * reviewer is here to do; a change that has already landed is read for a
     * different reason — to see how something came to be the way it is.
     */
    state?: PullRequestState;
    /**
     * Narrow to one author, by any part of their login.
     *
     * Matched here rather than by the forge, which takes a whole login and
     * nothing else: typing the first few letters of a name is how a reader
     * looks for somebody, and `--author 5erg` finds nothing at all while
     * `5ergio` is right there in the list.
     */
    author?: string;
  },
): Promise<PullRequestSummary[] | undefined> {
  const json = await run(
    [
      "pr", "list",
      "--state", options.state ?? "open",
      // Asking for more when a name is being matched here: the forge's own
      // limit applies before the narrowing, so a small page of everything can
      // easily hold nothing of theirs.
      "--limit", String(options.limit ?? (options.author ? 200 : 50)),
      "--json",
      "number,title,url,headRefName,headRefOid,isDraft,author,createdAt,updatedAt," +
        "reviewDecision,reviewRequests,state,mergedAt,closedAt,baseRefName,mergeCommit",
    ],
    {
      ...options,
      // A list of fifty with every field the row needs takes a couple of
      // seconds against a busy repository, and longer when the token has to be
      // refreshed first. The old four-second ceiling turned a slow answer into
      // "there are none", which is a different and much worse statement.
      timeoutMs: options.timeoutMs ?? 20_000,
    },
  );
  // Nothing came back at all: no `gh`, not signed in, or it gave up. That is
  // not the same as an empty answer, and the difference is worth carrying.
  if (!json) return undefined;

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
      state?: string;
      mergedAt?: string | null;
      closedAt?: string | null;
      baseRefName?: string;
      mergeCommit?: { oid?: string } | null;
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

        // How it ended, and what is left of it to read. A merged change no
        // longer has its branch — the merge commit is the only thing that
        // still points at what it did.
        const state = String(pr.state ?? "OPEN").toUpperCase();
        summary.state =
          state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open";
        if (pr.mergedAt) summary.mergedAt = pr.mergedAt;
        if (pr.closedAt) summary.closedAt = pr.closedAt;
        if (pr.baseRefName) summary.baseRef = pr.baseRefName;
        if (pr.mergeCommit?.oid) summary.mergeCommit = pr.mergeCommit.oid;
        return summary;
      })
      .filter(
        (pr) =>
          !options.author ||
          pr.author.toLowerCase().includes(options.author.toLowerCase()),
      )
      .sort(byActivity);
  } catch {
    return undefined;
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

/** How a pull request stands against being merged. */
export interface MergeStatus {
  /** `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` while the forge works it out. */
  mergeable: string;
  /**
   * Why it cannot be merged, in the forge's own words: `CLEAN`, `BLOCKED`
   * (waiting on approvals or checks), `BEHIND` (the base has moved on),
   * `DIRTY` (conflicts), `UNSTABLE` (checks failing but not required).
   */
  state: string;
  /**
   * Whether this account could merge it anyway.
   *
   * Administrators and maintainers can override a blocked merge. Offering that
   * to somebody who cannot is a button that fails with a permissions error
   * after they have already decided to press it.
   */
  canBypass: boolean;
  /**
   * The ways this repository allows a change to be put onto the base.
   *
   * Repositories turn these off: plenty allow only a squash, and offering a
   * rebase there is a button that fails after it has been pressed. Empty means
   * nothing could be read, and the caller falls back to the one the forge
   * itself defaults to.
   */
  methods: MergeMethod[];
}

/**
 * What the forge would say if asked to merge this now.
 *
 * Two questions rather than one: the pull request's own standing, and what this
 * account is allowed to do about it. They come from different places — the
 * second is a property of the repository — and neither is worth failing the
 * other for, so a missing answer leaves the conservative value.
 */
export async function readMergeStatus(
  branch: string,
  options: GitOptions & { timeoutMs?: number },
): Promise<MergeStatus | undefined> {
  const [json, rights] = await Promise.all([
    run(["pr", "view", branch, "--json", "mergeable,mergeStateStatus"], options),
    run(
      [
        "api", "repos/{owner}/{repo}",
        "--jq",
        "{permissions, allow_squash_merge, allow_merge_commit, allow_rebase_merge}",
      ],
      options,
    ),
  ]);
  if (!json) return undefined;

  try {
    const parsed = JSON.parse(json) as {
      mergeable?: string;
      mergeStateStatus?: string;
    };
    let canBypass = false;
    const methods: MergeMethod[] = [];
    if (rights) {
      try {
        const about = JSON.parse(rights) as {
          permissions?: Record<string, boolean>;
          allow_squash_merge?: boolean;
          allow_merge_commit?: boolean;
          allow_rebase_merge?: boolean;
        };
        const permissions = about.permissions ?? {};
        canBypass = permissions["admin"] === true || permissions["maintain"] === true;
        // Squash first, because it is what most repositories that restrict
        // anything restrict everything else down to.
        if (about.allow_squash_merge) methods.push("squash");
        if (about.allow_merge_commit) methods.push("merge");
        if (about.allow_rebase_merge) methods.push("rebase");
      } catch {
        // Not being sure means not offering it.
      }
    }
    return {
      mergeable: parsed.mergeable ?? "UNKNOWN",
      state: parsed.mergeStateStatus ?? "UNKNOWN",
      canBypass,
      methods,
    };
  } catch {
    return undefined;
  }
}

/**
 * Brings the base branch's commits into this one.
 *
 * `gh` refuses when there is nothing to bring, which is not a failure worth
 * reporting as one — so the caller is told what happened rather than handed an
 * error to interpret.
 */
export async function updateBranch(
  number: number,
  options: GitOptions & { timeoutMs?: number; rebase?: boolean },
): Promise<boolean> {
  const out = await run(
    [
      "pr", "update-branch", String(number),
      ...(options.rebase ? ["--rebase"] : []),
    ],
    { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
  );
  return out !== undefined;
}

/** How the commits of a change are put onto the base branch. */
export type MergeMethod = "squash" | "merge" | "rebase";

/**
 * Merges the change.
 *
 * The one thing here that cannot be undone from this window, so it is the one
 * thing every caller confirms first. `admin` is the forge's own word for
 * merging past rules that have not been met; it fails for an account that may
 * not, which is why nothing offers it without asking whether this one can.
 */
export async function mergePullRequest(
  number: number,
  options: GitOptions & {
    timeoutMs?: number;
    method?: MergeMethod;
    admin?: boolean;
  },
): Promise<boolean> {
  const method = options.method ?? "squash";
  const out = await run(
    [
      "pr", "merge", String(number),
      `--${method}`,
      ...(options.admin ? ["--admin"] : []),
    ],
    { ...options, timeoutMs: options.timeoutMs ?? 60_000 },
  );
  return out !== undefined;
}
