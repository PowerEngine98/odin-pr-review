import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  alreadyThere,
  brokenConnection,
  failureDetail,
  failureMessage,
  fileCommentPayload,
  FileCommentsNotPosted,
  inlineAvatars,
  parseComments,
  ReviewNotPosted,
  reviewPayload,
  submitReview,
} from "../src/git/review.js";

function raw(overrides: Record<string, unknown>): string {
  return JSON.stringify([
    {
      id: 1,
      path: "src/App.kt",
      line: 12,
      original_line: 12,
      side: "RIGHT",
      body: "why",
      user: { login: "ada" },
      created_at: "2026-08-01T00:00:00Z",
      html_url: "https://example.test/1",
      ...overrides,
    },
  ]);
}

describe("reading comments off the forge", () => {
  it("keeps the span a comment was written against", () => {
    const [c] = parseComments(raw({ start_line: 9, line: 12 }));
    expect(c.startLine).toBe(9);
    expect(c.line).toBe(12);
  });

  it("treats a span of one line as no span at all", () => {
    // A bracket drawn beside a single row is noise, and a start equal to the
    // end would round-trip back to the forge as an invalid range.
    const [c] = parseComments(raw({ start_line: 12, line: 12 }));
    expect(c.startLine).toBeUndefined();
  });

  it("falls back to where an outdated span was written", () => {
    const [c] = parseComments(
      raw({ line: null, start_line: null, original_line: 40, original_start_line: 37 }),
    );
    expect(c.outdated).toBe(true);
    expect(c.startLine).toBe(37);
    expect(c.line).toBe(40);
  });

  it("stitches the pages --paginate concatenated", () => {
    const two = raw({}) + "\n" + raw({ id: 2 });
    expect(parseComments(two)).toHaveLength(2);
  });

  it("returns nothing rather than throwing on an unreadable answer", () => {
    expect(parseComments("not json")).toEqual([]);
  });
});

describe("the review sent to the forge", () => {
  const base = { number: 7, event: "COMMENT" as const, body: "looks fine" };

  it("sends a span as start and end", () => {
    const payload = reviewPayload({
      ...base,
      comments: [
        { path: "a.kt", line: 23, startLine: 19, side: "RIGHT", body: "this loop" },
      ],
    });
    expect(payload.comments).toEqual([
      {
        path: "a.kt",
        line: 23,
        side: "RIGHT",
        start_line: 19,
        start_side: "RIGHT",
        body: "this loop",
      },
    ]);
  });

  it("omits the start when the comment covers one line", () => {
    const payload = reviewPayload({
      ...base,
      comments: [{ path: "a.kt", line: 23, side: "RIGHT", body: "here" }],
    });
    expect(payload.comments).toEqual([
      { path: "a.kt", line: 23, side: "RIGHT", body: "here" },
    ]);
  });

  it("omits a start that is not above the end", () => {
    // The forge rejects the whole review for this, taking every other remark
    // in it down with the malformed one.
    const payload = reviewPayload({
      ...base,
      comments: [
        { path: "a.kt", line: 23, startLine: 23, side: "RIGHT", body: "here" },
        { path: "b.kt", line: 4, startLine: 9, side: "LEFT", body: "backwards" },
      ],
    });
    for (const c of payload.comments as Record<string, unknown>[]) {
      expect(c).not.toHaveProperty("start_line");
    }
  });

  it("carries no comments key when there are none", () => {
    expect(reviewPayload({ ...base, comments: [] })).toEqual({
      event: "COMMENT",
      body: "looks fine",
    });
  });

  it("sends an approval with no summary as an event alone", () => {
    expect(reviewPayload({ number: 7, event: "APPROVE", body: "", comments: [] })).toEqual({
      event: "APPROVE",
    });
  });
});

describe("carrying the pictures", () => {
  it("fetches an avatar once and keeps it", async () => {
    // The comments are re-read after every reaction and every reply. Refetching
    // each time is slow, and one timeout turns a face back into initials in
    // front of the reader for no reason they can see.
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls > 1) throw new Error("network");
      return {
        ok: true,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    }) as unknown as typeof fetch;

    const comment = {
      id: 1,
      path: "a.ts",
      line: 1,
      side: "RIGHT" as const,
      body: "",
      author: "ada",
      avatarUrl: "https://example.test/only-once.png",
      createdAt: "",
      url: "",
      outdated: false,
    };

    try {
      const first = await inlineAvatars([comment]);
      const second = await inlineAvatars([comment]);
      expect(calls).toBe(1);
      expect(first[0]!.avatarUrl?.startsWith("data:")).toBe(true);
      expect(second[0]!.avatarUrl?.startsWith("data:")).toBe(true);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("leaves a comment without one rather than half a picture", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("no network");
    }) as unknown as typeof fetch;

    try {
      const out = await inlineAvatars([
        {
          id: 2,
          path: "a.ts",
          line: 1,
          side: "RIGHT" as const,
          body: "",
          author: "grace",
          avatarUrl: "https://example.test/never.png",
          createdAt: "",
          url: "",
          outdated: false,
        },
      ]);
      expect(out[0]!.avatarUrl).toBeUndefined();
    } finally {
      globalThis.fetch = real;
    }
  });
});

/**
 * "This file should not exist" belongs to the file, not to line one of it.
 *
 * The comments a review carries take a path, a body, a line or a position and a
 * side, and nothing else — there is no way to say "this is about the file"
 * among them. A remark that tried to, by carrying a subject instead of a line,
 * was refused; and since a review is one request, every other remark in it was
 * refused with it. That is the ten-comment review a reviewer lost to one note
 * about a file, and these say it cannot happen again: the review carries lines
 * only, and the whole-file remark is a request of its own to the endpoint that
 * accepts a subject.
 */
describe("a remark about the file rather than a line", () => {
  const base = { number: 7, event: "COMMENT" as const, body: "" };

  it("is left out of the review rather than sent inside it", () => {
    const payload = reviewPayload({
      ...base,
      comments: [{ path: "a.kt", side: "RIGHT", body: "does this belong here?" }],
    });
    expect(payload.comments).toBeUndefined();
  });

  it("does not take the line comments beside it down", () => {
    const payload = reviewPayload({
      ...base,
      comments: [
        { path: "a.kt", line: 12, side: "RIGHT", body: "here" },
        { path: "b.kt", side: "LEFT", body: "and this file" },
      ],
    });
    const comments = payload.comments as Record<string, unknown>[];
    expect(comments).toHaveLength(1);
    expect(comments[0]).toHaveProperty("line", 12);
    for (const c of comments) expect(c).not.toHaveProperty("subject_type");
  });

  it("names its subject and its commit when it goes out on its own", () => {
    // The subject is documented on this endpoint and only on this endpoint, and
    // a comment sent here with neither a line nor a subject is what the forge
    // genuinely refuses. The commit is required too: a remark with no line has
    // nothing else to say which version of the file it is about.
    expect(
      fileCommentPayload({ path: "a.kt", side: "RIGHT", body: "why?" }, "cafe1234"),
    ).toEqual({
      path: "a.kt",
      commit_id: "cafe1234",
      subject_type: "file",
      body: "why?",
    });
  });
});

describe("a comment the forge gives no line", () => {
  it("is read as being about the file, not as an outdated line", () => {
    // A file-level remark has neither a line nor an original line. Treating it
    // as outdated would put it beside line zero and call it stale.
    const [c] = parseComments(raw({ line: null, original_line: null }));
    expect(c.wholeFile).toBe(true);
    expect(c.outdated).toBe(false);
  });

  it("leaves a genuinely outdated comment alone", () => {
    const [c] = parseComments(raw({ line: null, original_line: 40 }));
    expect(c.wholeFile).toBeUndefined();
    expect(c.outdated).toBe(true);
    expect(c.line).toBe(40);
  });
});

describe("telling a broken connection from a refusal", () => {
  it("recognises the answer that never came", () => {
    // The one the reviewer actually saw: gh reporting that the server hung up
    // before it replied, which says nothing about whether it read the review.
    expect(
      brokenConnection(
        'Post "https://api.github.com/repos/o/r/pulls/80/reviews": unexpected EOF',
      ),
    ).toBe(true);
    expect(brokenConnection("HTTP 502: Bad gateway")).toBe(true);
    expect(brokenConnection("read tcp 10.0.0.1:1: connection reset by peer")).toBe(true);
  });

  it("leaves a refusal alone, because sending it again would fail again", () => {
    expect(brokenConnection("HTTP 422: Validation Failed")).toBe(false);
    expect(brokenConnection("HTTP 403: Resource not accessible")).toBe(false);
    expect(brokenConnection("pull request review cannot be empty")).toBe(false);
  });
});

describe("looking for a review that may already be there", () => {
  const sent = {
    login: "ada",
    event: "APPROVE" as const,
    body: "looks right",
    since: Date.parse("2026-08-04T12:00:00Z"),
  };
  const posted = (overrides: Record<string, unknown> = {}) => [
    {
      user: { login: "ada" },
      state: "APPROVED",
      body: "looks right",
      submitted_at: "2026-08-04T12:00:05Z",
      ...overrides,
    },
  ];

  it("finds the one just sent, so it is not sent twice", () => {
    expect(alreadyThere(posted(), sent)).toBe(true);
  });

  it("is not fooled by somebody else's approval", () => {
    expect(alreadyThere(posted({ user: { login: "grace" } }), sent)).toBe(false);
  });

  it("is not fooled by a different verdict", () => {
    expect(alreadyThere(posted({ state: "CHANGES_REQUESTED" }), sent)).toBe(false);
  });

  it("is not fooled by a different summary", () => {
    expect(alreadyThere(posted({ body: "one question" }), sent)).toBe(false);
  });

  it("ignores an old review that happens to match", () => {
    // The same reviewer approving the same pull request with the same words
    // last week is not this attempt, and treating it as one would swallow the
    // review being sent now.
    expect(alreadyThere(posted({ submitted_at: "2026-07-28T09:00:00Z" }), sent)).toBe(
      false,
    );
  });

  it("matches an approval with no summary, which is the usual kind", () => {
    expect(
      alreadyThere(posted({ body: "" }), { ...sent, body: "" }),
    ).toBe(true);
    expect(alreadyThere(posted({ body: null }), { ...sent, body: "" })).toBe(true);
  });
});

/**
 * Why the request was refused, rather than only that it was.
 *
 * `gh` writes a one-line summary of the status to standard error and the
 * forge's own answer to standard output, and only the second one says which
 * field was wrong. Odin used to report the first and throw the second away,
 * which is how a reviewer came to be holding "gh: Unprocessable Entity (HTTP
 * 422)" and nothing else, and why finding the cause took an afternoon rather
 * than a glance.
 */
describe("what a refused call is reported as", () => {
  const VALIDATION = JSON.stringify({
    message: "Validation Failed",
    errors: [{ resource: "Search", field: "q", code: "missing" }],
    documentation_url: "https://docs.github.com/rest",
  });

  it("names the field the forge objected to, not just the status", () => {
    const said = failureMessage("gh: Validation Failed (HTTP 422)\n", VALIDATION, "exit 1");
    expect(said).toContain("gh: Validation Failed (HTTP 422)");
    expect(said).toContain("Search.q is missing");
    // The parts nobody reads stay behind.
    expect(said).not.toContain("documentation_url");
  });

  it("uses the forge's own wording for a fault that has some", () => {
    const detail = failureDetail(
      JSON.stringify({
        message: "Validation Failed",
        errors: [
          {
            resource: "PullRequestReviewComment",
            field: "subject_type",
            code: "custom",
            message: "subject_type is not permitted",
          },
        ],
      }),
    );
    // The refusal that started all this, said once rather than twice: the
    // forge's sentence already names the field.
    expect(detail).toBe("Validation Failed: subject_type is not permitted");
  });

  it("adds nothing when there is no body, rather than an empty aside", () => {
    expect(failureDetail(undefined)).toBeUndefined();
    expect(failureDetail("   \n")).toBeUndefined();
    expect(failureMessage("gh: Not Found (HTTP 404)", "", "exit 1")).toBe(
      "gh: Not Found (HTTP 404)",
    );
  });

  it("survives a body that is not json and one that is enormous", () => {
    // Something in front of the forge answering with an html page, and a
    // paginated read that came back with megabytes: neither may throw, and
    // neither may become the error message.
    const html = failureDetail("<html>\n  <body>502 Bad Gateway</body>\n</html>");
    expect(html).toContain("502 Bad Gateway");
    expect(html!.length).toBeLessThan(400);

    const huge = failureDetail(`{"message":"${"x".repeat(200_000)}"}`);
    expect(huge!.length).toBeLessThan(600);
  });

  it("falls back to the summary when the body says nothing useful", () => {
    expect(failureMessage("", "", "spawn gh ENOENT")).toBe("spawn gh ENOENT");
  });
});

/**
 * The two halves of sending a review, and what happens when one of them fails.
 *
 * A review is one request and a remark about a whole file is another, so there
 * is a moment where half of a submission is on the pull request and half of it
 * is not. Both orders of that were tried against a fake forge here, because the
 * cost of getting it wrong is paid in someone else's pull request: a remark
 * posted before a refused review is a remark with no verdict beside it and no
 * way to retry that does not post it twice, and a review reported as unposted
 * when it is posted is a second verdict on the same change.
 */
describe("sending a review that has a whole-file remark in it", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  const call = (file: string): string[] => {
    try {
      return readFileSync(join(repo, file), "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-gh-review-"));
    repo = mkdtempSync(join(tmpdir(), "odin-gh-review-repo-"));

    // A forge that answers the head commit, takes a review and takes a comment,
    // and refuses whichever of the two a test has left a note asking it to.
    const file = join(bin, "gh");
    writeFileSync(
      file,
      "#!/bin/sh\n" +
        `echo "$*" >> "${join(repo, "calls.log")}"\n` +
        'case "$*" in\n' +
        `  *--jq*) echo "cafe1234"; exit 0;;\n` +
        "esac\n" +
        "body=$(cat)\n" +
        'case "$*" in\n' +
        `  *reviews*)\n` +
        `    echo "$body" >> "${join(repo, "reviews.log")}"\n` +
        `    if [ -f "${join(repo, "refuse-review")}" ]; then\n` +
        `      echo '{\"message\":\"Validation Failed\",\"errors\":[{\"resource\":\"PullRequestReview\",\"field\":\"line\",\"code\":\"invalid\"}]}'\n` +
        '      echo "gh: Validation Failed (HTTP 422)" >&2\n' +
        "      exit 1\n" +
        "    fi\n" +
        "    echo '{\"id\":1}';;\n" +
        `  *comments*)\n` +
        `    echo "$body" >> "${join(repo, "comments.log")}"\n` +
        `    if [ -f "${join(repo, "refuse-file")}" ]; then\n` +
        `      echo '{\"message\":\"Validation Failed\",\"errors\":[{\"resource\":\"PullRequestReviewComment\",\"field\":\"path\",\"code\":\"custom\",\"message\":\"path is not part of the diff\"}]}'\n` +
        '      echo "gh: Validation Failed (HTTP 422)" >&2\n' +
        "      exit 1\n" +
        "    fi\n" +
        "    echo '{\"id\":2}';;\n" +
        "  *) exit 1;;\n" +
        "esac\n",
    );
    chmodSync(file, 0o755);
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const name of ["calls.log", "reviews.log", "comments.log", "refuse-review", "refuse-file"]) {
      rmSync(join(repo, name), { force: true });
    }
  });

  const request = {
    number: 7,
    event: "COMMENT" as const,
    body: "looks fine",
    comments: [
      { path: "a.kt", line: 12, side: "RIGHT" as const, body: "here" },
      { path: "b.kt", side: "RIGHT" as const, body: "why does this file exist?" },
    ],
  };

  it("sends the review first and the whole-file remark on its own after it", async () => {
    await submitReview(request, { cwd: repo });

    const sent = JSON.parse(call("reviews.log")[0]!) as Record<string, unknown>;
    expect(sent.comments).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toContain("subject_type");

    const remark = JSON.parse(call("comments.log")[0]!) as Record<string, unknown>;
    expect(remark).toEqual({
      path: "b.kt",
      commit_id: "cafe1234",
      subject_type: "file",
      body: "why does this file exist?",
    });

    // And in that order, which is the whole of the failure story below.
    const order = call("calls.log");
    expect(order.findIndex((one) => one.includes("reviews"))).toBeLessThan(
      order.findIndex((one) => one.includes("pulls/7/comments")),
    );
  });

  it("says the review is posted when only the remark was refused", async () => {
    writeFileSync(join(repo, "refuse-file"), "");

    const failed = await submitReview(request, { cwd: repo }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(FileCommentsNotPosted);
    // Not a ReviewNotPosted, because the review is on the pull request. A
    // reviewer told otherwise sends their verdict a second time.
    expect(failed).not.toBeInstanceOf(ReviewNotPosted);

    const said = failed as FileCommentsNotPosted;
    expect(said.paths).toEqual(["b.kt"]);
    expect(said.comments[0]!.body).toBe("why does this file exist?");
    expect(said.message).toContain("the review was posted");
    // And why, which is the part that used to be thrown away.
    expect(said.reason).toContain("path is not part of the diff");

    // The review itself went out all the same.
    expect(call("reviews.log")).toHaveLength(1);
  });

  it("sends no whole-file remark at all when the review itself is refused", async () => {
    writeFileSync(join(repo, "refuse-review"), "");

    const failed = await submitReview(request, { cwd: repo }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ReviewNotPosted);
    // Nothing is on the pull request, so the drafts the caller still holds can
    // all go out again on the next press. A remark posted here would have been
    // posted twice.
    expect(call("comments.log")).toEqual([]);
    expect((failed as Error).message).toContain("Validation Failed");
  });

  it("carries on to the second remark when the first is refused", async () => {
    writeFileSync(join(repo, "refuse-file"), "");

    const failed = await submitReview(
      {
        ...request,
        comments: [
          { path: "b.kt", side: "RIGHT", body: "one" },
          { path: "c.kt", side: "RIGHT", body: "two" },
        ],
      },
      { cwd: repo },
    ).catch((e: unknown) => e);

    // Both were tried. Stopping at the first refusal would lose the rest for a
    // reason that says nothing about them.
    expect(call("comments.log")).toHaveLength(2);
    expect((failed as FileCommentsNotPosted).paths).toEqual(["b.kt", "c.kt"]);
  });
});
