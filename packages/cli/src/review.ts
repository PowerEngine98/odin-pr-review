import { readFile } from "node:fs/promises";

import {
  currentBranch,
  listReviewComments,
  readPullRequest,
  reviewPayload,
  submitReview,
  type DraftComment,
  type ReviewComment,
} from "@odin/core";

import type { CommentsOptions, ReviewOptions } from "./args.js";

/**
 * Reviewing from the command line.
 *
 * The same operations the panel offers, for the callers that have no window:
 * scripts, and agents working through a terminal. Everything goes through the
 * `gh` command line for the same reason the rest of the tool does — it inherits
 * the reviewer's own authentication, and this program stores no credentials.
 */
export async function runComments(
  opts: CommentsOptions,
  out: (text: string) => void,
): Promise<number> {
  const number = await pullNumber(opts.cwd, opts.number);
  if (!number) return missing(out);

  const comments = await listReviewComments(number, { cwd: opts.cwd });
  if (opts.json) {
    out(`${JSON.stringify(comments, null, 2)}\n`);
    return 0;
  }

  if (comments.length === 0) {
    out(`no review comments on #${number}\n`);
    return 0;
  }

  for (const comment of comments) {
    out(`${describe(comment)}\n`);
  }
  return 0;
}

function describe(comment: ReviewComment): string {
  const where = comment.startLine
    ? `${comment.path}:${comment.startLine}-${comment.line}`
    : `${comment.path}:${comment.line}`;
  const flags = [
    comment.side === "LEFT" ? "base side" : "",
    comment.outdated ? "outdated" : "",
    comment.inReplyTo ? `reply to ${comment.inReplyTo}` : "",
  ].filter(Boolean);

  const head = `${where}  ${comment.author}${flags.length ? ` (${flags.join(", ")})` : ""}`;
  // Indented so a body of several lines cannot be mistaken for another comment.
  const body = comment.body.split("\n").map((line) => `    ${line}`).join("\n");
  return `${head}\n${body}`;
}

export async function runReview(
  opts: ReviewOptions,
  out: (text: string) => void,
): Promise<number> {
  const number = await pullNumber(opts.cwd, opts.number);
  if (!number) return missing(out);

  const comments: DraftComment[] = opts.comments.map((c) => ({
    path: c.path,
    line: c.line,
    ...(c.startLine !== undefined ? { startLine: c.startLine } : {}),
    side: c.side ?? "RIGHT",
    body: c.body,
  }));

  if (opts.commentsFile) {
    const loaded = await loadComments(opts.commentsFile);
    if (typeof loaded === "string") {
      out(`odin: ${loaded}\n`);
      return 2;
    }
    comments.push(...loaded);
  }

  const request = {
    number,
    event: opts.event,
    body: opts.body,
    comments,
  } as const;

  // Dry runs print exactly what would go out, not a description of it: the
  // point of asking is to see the thing, and a summary would hide the mistake
  // the caller is checking for.
  if (opts.dryRun) {
    out(`${JSON.stringify(reviewPayload(request), null, 2)}\n`);
    return 0;
  }

  await submitReview(request, { cwd: opts.cwd });

  const verdict = opts.event === "APPROVE"
    ? "approved"
    : opts.event === "REQUEST_CHANGES"
      ? "requested changes on"
      : "commented on";
  const count = comments.length === 1 ? "1 line comment" : `${comments.length} line comments`;
  out(`${verdict} #${number}${comments.length ? ` with ${count}` : ""}\n`);
  return 0;
}

/** Reads a json array of comments, and says what is wrong rather than throwing. */
async function loadComments(file: string): Promise<DraftComment[] | string> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return `cannot read ${file}`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return `${file} is not valid json`;
  }
  if (!Array.isArray(parsed)) {
    return `${file} should hold an array of comments`;
  }

  const comments: DraftComment[] = [];
  for (const [index, item] of parsed.entries()) {
    const c = item as Partial<DraftComment>;
    if (typeof c.path !== "string" || typeof c.line !== "number" || typeof c.body !== "string") {
      return `${file}[${index}] needs at least path, line and body`;
    }
    if (c.startLine !== undefined && typeof c.startLine !== "number") {
      return `${file}[${index}] has a startLine that is not a number`;
    }
    comments.push({
      path: c.path,
      line: c.line,
      ...(c.startLine !== undefined ? { startLine: c.startLine } : {}),
      side: c.side === "LEFT" ? "LEFT" : "RIGHT",
      body: c.body,
    });
  }
  return comments;
}

/** The pull request for this branch, unless one was named. */
async function pullNumber(cwd: string, given?: number): Promise<number | undefined> {
  if (given) return given;
  const branch = await currentBranch({ cwd }).catch(() => undefined);
  if (!branch) return undefined;
  const pull = await readPullRequest(branch, { cwd });
  return pull?.number;
}

function missing(out: (text: string) => void): number {
  out(
    "odin: no pull request found for this branch. Pass --number, or check that " +
      "the gh command line is installed and authenticated.\n",
  );
  return 2;
}
