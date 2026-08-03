import { execFile } from "node:child_process";

import type { GitOptions } from "./exec.js";
import { forgeEnv } from "./pullRequest.js";

/** A comment already on the pull request. */
export interface ReviewComment {
  id: number;
  path: string;
  /** Last line the comment covers, on `side`. A one-line comment ends here. */
  line: number;
  /** First line of a multi-line comment. Absent when it covers one line. */
  startLine?: number;
  side: "LEFT" | "RIGHT";
  body: string;
  author: string;
  /** The author's picture, inlined by the caller so no page fetches anything. */
  avatarUrl?: string;
  createdAt: string;
  url: string;
  /** Set when this is a reply within a thread. */
  inReplyTo?: number;
  /** The forge no longer knows where this belongs; the code moved under it. */
  outdated: boolean;
  /** About the file rather than any line in it. */
  wholeFile?: boolean;
  /** Emoji left on this comment, most-used first. */
  reactions?: Reaction[];
}

/** One kind of emoji on a comment, and how many people left it. */
export interface Reaction {
  /** The forge's name for it: `+1`, `heart`, `rocket`. */
  content: string;
  count: number;
}

/** The eight the forge offers, in the order it offers them. */
export const REACTIONS = [
  "+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes",
] as const;

/**
 * A comment the reviewer has written but not yet sent.
 *
 * A remark is often about a passage rather than a line — a loop, a condition
 * and its body, three declarations that should be one. `startLine` carries the
 * top of that passage; `line` is always its last line, which is where the forge
 * hangs the thread.
 */
export interface DraftComment {
  path: string;
  /**
   * The line the remark is about, or absent for one about the file itself.
   *
   * Not everything worth saying is about a line. "This file should not exist"
   * belongs to the file, and pinning it to line one makes it look like a note
   * about an import.
   */
  line?: number;
  /** Top of the passage, when the comment covers more than one line. */
  startLine?: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface SubmitRequest {
  number: number;
  event: ReviewEvent;
  /** The review's summary. GitHub requires one for anything but an approval. */
  body: string;
  comments: DraftComment[];
}

/**
 * Reading and writing pull request reviews through the `gh` command line.
 *
 * Everything here goes through `gh api` rather than a hand-rolled HTTP client,
 * for the same reason the rest of the forge integration does: it inherits the
 * reviewer's existing authentication, follows their enterprise host
 * configuration, and adds no credentials of its own to store or leak.
 *
 * The read side is best-effort — a review is still worth doing when the
 * comments cannot be fetched. The write side is not: a failure to post must be
 * reported, never swallowed, because the reviewer will otherwise believe they
 * have said something they have not.
 */
export async function listReviewComments(
  number: number,
  options: GitOptions & { timeoutMs?: number },
): Promise<ReviewComment[]> {
  const json = await read(
    [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`,
    ],
    options,
  );
  return json ? parseComments(json) : [];
}

/**
 * Reads the forge's answer into comments.
 *
 * Exported for its own sake: everything that can go wrong in reading a comment
 * — a thread whose code has moved, a remark about a passage rather than a line
 * — goes wrong in here, and none of it needs a network to reproduce.
 */
export function parseComments(json: string): ReviewComment[] {
  try {
    // `--paginate` concatenates pages as separate arrays when they are large;
    // stitching them is cheaper than asking for them one at a time.
    const pages = json
      .replace(/\]\s*\[/g, ",")
      .trim();
    const parsed = JSON.parse(pages) as {
      id: number;
      path: string;
      line: number | null;
      original_line: number | null;
      start_line?: number | null;
      original_start_line?: number | null;
      side: string | null;
      body: string;
      user?: { login?: string; avatar_url?: string };
      reactions?: Record<string, number> & { url?: string };
      created_at: string;
      html_url: string;
      in_reply_to_id?: number;
    }[];

    return parsed.map((c) => {
      // A comment whose line is null has been outdated by later commits; the
      // original line still says where it was written, which is more useful
      // than dropping it.
      // A comment about the file itself carries no line at all — the forge was
      // told its subject rather than a position — and is not the same thing as
      // one whose line has been outdated by later commits.
      const wholeFile = c.line == null && c.original_line == null;
      const line = c.line ?? c.original_line ?? 0;
      const start = c.start_line ?? c.original_start_line ?? undefined;
      const comment: ReviewComment = {
        id: c.id,
        path: c.path,
        line,
        ...(wholeFile ? { wholeFile: true } : {}),
        // A span whose top is the line itself is not a span; keeping it would
        // draw a one-row bracket beside every ordinary comment.
        ...(start !== undefined && start !== null && start < line
          ? { startLine: start }
          : {}),
        side: c.side === "LEFT" ? "LEFT" : "RIGHT",
        body: c.body,
        author: c.user?.login ?? "",
        ...(c.user?.avatar_url ? { avatarUrl: c.user.avatar_url } : {}),
        createdAt: c.created_at,
        url: c.html_url,
        // Outdated means it had a line and the code moved out from under it.
        // A remark about the file never had one, and calling it stale would be
        // a claim about code it was never attached to.
        outdated: c.line == null && !wholeFile,
      };

      const reactions = REACTIONS
        .map((content) => ({ content, count: Number(c.reactions?.[content] ?? 0) }))
        .filter((r) => r.count > 0);
      if (reactions.length > 0) comment.reactions = reactions;
      if (c.in_reply_to_id) comment.inReplyTo = c.in_reply_to_id;
      return comment;
    });
  } catch {
    return [];
  }
}

/**
 * Sends a review, with any line comments attached to it.
 *
 * Posted as one review rather than as individual comments so that the team sees
 * a single notification carrying a verdict, which is what a review is. Sending
 * each comment separately would spray notifications and leave the verdict
 * unattached to the remarks that justify it.
 */
export async function submitReview(
  request: SubmitRequest,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  const payload = JSON.stringify(reviewPayload(request));

  await write(
    [
      "api",
      "--method", "POST",
      `repos/{owner}/{repo}/pulls/${request.number}/reviews`,
      "--input", "-",
    ],
    payload,
    options,
  );
}

/**
 * The body of the review request, in the shape the forge expects.
 *
 * Separated from the call so the translation can be tested without a network
 * or a repository: the mistakes possible here — a span sent as a point, a
 * summary omitted where one is required — are all mistakes of shape.
 */
export function reviewPayload(request: SubmitRequest): Record<string, unknown> {
  return {
    event: request.event,
    ...(request.body ? { body: request.body } : {}),
    ...(request.comments.length > 0
      ? {
          comments: request.comments.map((c) => ({
            path: c.path,
            // A remark about the file carries no line and says so: the forge
            // rejects a comment with neither a line nor a subject.
            ...(c.line === undefined
              ? { subject_type: "file" }
              : {
                  line: c.line,
                  side: c.side,
                  // Sent only for a real span. A start equal to the end is
                  // rejected, so a one-line comment must carry no start at all
                  // — and a start below the end would be a range backwards.
                  ...(c.startLine !== undefined && c.startLine < c.line
                    ? { start_line: c.startLine, start_side: c.side }
                    : {}),
                }),
            body: c.body,
          })),
        }
      : {}),
  };
}

/**
 * Takes a pull request out of draft, or puts it back.
 *
 * Leaving draft is not a quiet change: it is the moment the team is asked to
 * look, and reviewers are notified. Callers should confirm before calling this,
 * for the same reason they confirm before sending a review.
 */
export async function setDraft(
  number: number,
  draft: boolean,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  await write(
    ["pr", "ready", String(number), ...(draft ? ["--undo"] : [])],
    undefined,
    options,
  );
}

/**
 * The node id a pull request has in the forge's graph API.
 *
 * Marking a file read is only offered there, and it takes ids rather than
 * numbers, so this is the one place the two APIs have to be bridged.
 */
export async function pullRequestNodeId(
  number: number,
  options: GitOptions & { timeoutMs?: number },
): Promise<string | undefined> {
  const json = await read(
    ["api", `repos/{owner}/{repo}/pulls/${number}`, "--jq", ".node_id"],
    options,
  );
  const id = json?.trim();
  return id || undefined;
}

/** Which files the forge already believes the reviewer has read. */
export async function listViewedFiles(
  number: number,
  options: GitOptions & { timeoutMs?: number },
): Promise<string[]> {
  const query = `query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$number){
        files(first:100){ nodes { path viewerViewedState } }
      }
    }
  }`;

  const json = await read(
    [
      "api", "graphql",
      "-F", "owner={owner}",
      "-F", "repo={repo}",
      "-F", `number=${number}`,
      "-f", `query=${query}`,
      "--jq", '[.data.repository.pullRequest.files.nodes[] | select(.viewerViewedState == "VIEWED") | .path]',
    ],
    options,
  );
  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Records, on the forge, that a file has or has not been read. */
export async function markFileViewed(
  nodeId: string,
  path: string,
  viewed: boolean,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  const mutation = viewed
    ? `mutation($id:ID!,$path:String!){ markFileAsViewed(input:{pullRequestId:$id,path:$path}){ clientMutationId } }`
    : `mutation($id:ID!,$path:String!){ unmarkFileAsViewed(input:{pullRequestId:$id,path:$path}){ clientMutationId } }`;

  await write(
    ["api", "graphql", "-F", `id=${nodeId}`, "-F", `path=${path}`, "-f", `query=${mutation}`],
    undefined,
    options,
  );
}

/** Best-effort read: returns undefined rather than throwing. */
function read(
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
        timeout: options.timeoutMs ?? 8000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

/** Write: reports failure, because silence would be mistaken for success. */
function write(
  args: string[],
  input: string | undefined,
  options: GitOptions & { timeoutMs?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      args,
      {
        cwd: options.cwd,
        env: forgeEnv(),
        timeout: options.timeoutMs ?? 20_000,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

/**
 * Replaces every avatar url with the picture itself.
 *
 * The rendered page is one file with no network access — that is the whole
 * point of it — so a picture it is going to show has to be carried inside it.
 * Small on purpose: forty pixels is what the mark is drawn at, and a page
 * holding thirty full-size avatars would be several megabytes of nothing.
 *
 * Best-effort throughout. An avatar that cannot be fetched leaves the comment
 * without one, and the page falls back to the author's initials.
 */
export async function inlineAvatars(
  comments: ReviewComment[],
  options: { timeoutMs?: number } = {},
): Promise<ReviewComment[]> {
  const urls = new Set(
    comments.map((c) => c.avatarUrl).filter((u): u is string => Boolean(u)),
  );
  if (urls.size === 0) return comments;

  // Kept between calls. The comments are re-read after every reaction and every
  // reply, and refetching a dozen pictures each time is both slow and a way to
  // lose them: one timeout and a face turns back into initials in front of the
  // reader, for no reason they can see.
  await Promise.all(
    [...urls]
      .filter((url) => !avatarCache.has(url))
      .map(async (url) => {
        const data = await fetchImage(sized(url), options.timeoutMs ?? 4000);
        if (data) avatarCache.set(url, data);
      }),
  );
  const inlined = avatarCache;

  return comments.map((c) => {
    const data = c.avatarUrl ? inlined.get(c.avatarUrl) : undefined;
    if (!data) {
      const { avatarUrl: _dropped, ...rest } = c;
      return rest;
    }
    return { ...c, avatarUrl: data };
  });
}

/**
 * A picture as a data uri, so it can be shown where the network cannot reach.
 *
 * An editor webview refuses remote images outright, which is why every face in
 * this page travels inside the document rather than as a link to one. Shares
 * the cache with the comment avatars: the same people appear in both places.
 */
export async function inlineAvatar(
  url: string,
  timeoutMs = 4000,
): Promise<string | undefined> {
  const cached = avatarCache.get(url);
  if (cached) return cached;

  const data = await fetchImage(sized(url), timeoutMs);
  if (data) avatarCache.set(url, data);
  return data;
}

/** Pictures already fetched, by their url. Small, and the process is short. */
const avatarCache = new Map<string, string>();

/** Ask the forge for the size actually drawn rather than the original. */
function sized(url: string): string {
  return url.includes("?") ? `${url}&s=80` : `${url}?s=80`;
}

async function fetchImage(url: string, timeoutMs: number): Promise<string | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) return undefined;

    const type = response.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) return undefined;

    const bytes = Buffer.from(await response.arrayBuffer());
    // A picture larger than this is not the forty-pixel avatar we asked for,
    // and is not worth carrying in the document.
    if (bytes.byteLength > 256 * 1024) return undefined;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adds an emoji to a comment, or takes yours off it.
 *
 * The forge has no single call for this: leaving one is a POST, taking one back
 * is a DELETE that needs the id of the reaction, and the id is only obtainable
 * by listing them and finding your own. Hence the three steps — and the login
 * lookup, which is cached because it cannot change between two clicks.
 */
export async function toggleReaction(
  commentId: number,
  content: string,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  const me = await viewerLogin(options);
  const listed = await read(
    [
      "api",
      `repos/{owner}/{repo}/pulls/comments/${commentId}/reactions`,
      "--jq",
      ".[] | [.id, .content, .user.login] | @tsv",
    ],
    options,
  );

  const mine = (listed ?? "")
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, kind, login]) => kind === content && login === me);

  if (mine) {
    await write(
      [
        "api", "--method", "DELETE",
        `repos/{owner}/{repo}/pulls/comments/${commentId}/reactions/${mine[0]}`,
      ],
      undefined,
      options,
    );
    return;
  }

  await write(
    [
      "api", "--method", "POST",
      `repos/{owner}/{repo}/pulls/comments/${commentId}/reactions`,
      "-f", `content=${content}`,
    ],
    undefined,
    options,
  );
}

let cachedLogin: string | undefined;

/** Who the `gh` command line is signed in as, for deciding what can be edited. */
export async function currentUser(
  options: GitOptions & { timeoutMs?: number },
): Promise<string> {
  return viewerLogin(options);
}

async function viewerLogin(
  options: GitOptions & { timeoutMs?: number },
): Promise<string> {
  if (cachedLogin) return cachedLogin;
  const login = (await read(["api", "user", "--jq", ".login"], options))?.trim();
  cachedLogin = login || "";
  return cachedLogin;
}

/**
 * Answers a comment in its own thread.
 *
 * A reply rather than a new remark on the same line: the forge keeps threads,
 * and a second top-level comment beside the first is how a conversation turns
 * into two conversations.
 */
export async function replyToComment(
  number: number,
  commentId: number,
  body: string,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  await write(
    [
      "api", "--method", "POST",
      `repos/{owner}/{repo}/pulls/${number}/comments/${commentId}/replies`,
      "--input", "-",
    ],
    JSON.stringify({ body }),
    options,
  );
}

/** Rewrites a comment. Only its author may, which the forge enforces. */
export async function editComment(
  commentId: number,
  body: string,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  await write(
    [
      "api", "--method", "PATCH",
      `repos/{owner}/{repo}/pulls/comments/${commentId}`,
      "--input", "-",
    ],
    JSON.stringify({ body }),
    options,
  );
}

/**
 * Removes a comment.
 *
 * There is no undo on the forge either, so a caller with a person in front of
 * it should ask first.
 */
export async function deleteComment(
  commentId: number,
  options: GitOptions & { timeoutMs?: number },
): Promise<void> {
  await write(
    [
      "api", "--method", "DELETE",
      `repos/{owner}/{repo}/pulls/comments/${commentId}`,
    ],
    undefined,
    options,
  );
}
