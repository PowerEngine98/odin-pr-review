import { execFile } from "node:child_process";

import type { GitOptions } from "./exec.js";
import { forgeEnv } from "./pullRequest.js";

/** A comment already on the pull request. */
export interface ReviewComment {
  id: number;
  path: string;
  /** Line in the file the comment is anchored to, on `side`. */
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  author: string;
  createdAt: string;
  url: string;
  /** Set when this is a reply within a thread. */
  inReplyTo?: number;
  /** The forge no longer knows where this belongs; the code moved under it. */
  outdated: boolean;
}

/** A comment the reviewer has written but not yet sent. */
export interface DraftComment {
  path: string;
  line: number;
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
  if (!json) return [];

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
      side: string | null;
      body: string;
      user?: { login?: string };
      created_at: string;
      html_url: string;
      in_reply_to_id?: number;
    }[];

    return parsed.map((c) => {
      // A comment whose line is null has been outdated by later commits; the
      // original line still says where it was written, which is more useful
      // than dropping it.
      const line = c.line ?? c.original_line ?? 0;
      const comment: ReviewComment = {
        id: c.id,
        path: c.path,
        line,
        side: c.side === "LEFT" ? "LEFT" : "RIGHT",
        body: c.body,
        author: c.user?.login ?? "",
        createdAt: c.created_at,
        url: c.html_url,
        outdated: c.line === null,
      };
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
  const payload = JSON.stringify({
    event: request.event,
    ...(request.body ? { body: request.body } : {}),
    ...(request.comments.length > 0
      ? {
          comments: request.comments.map((c) => ({
            path: c.path,
            line: c.line,
            side: c.side,
            body: c.body,
          })),
        }
      : {}),
  });

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
