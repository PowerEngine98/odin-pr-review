import { describe, expect, it } from "vitest";

import {
  alreadyThere,
  brokenConnection,
  inlineAvatars,
  parseComments,
  reviewPayload,
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

describe("a remark about the file rather than a line", () => {
  const base = { number: 7, event: "COMMENT" as const, body: "" };

  it("says what it is about instead of pointing at a line", () => {
    // "This file should not exist" belongs to the file. Pinned to line one it
    // reads as a note about an import, and the forge rejects a comment that
    // carries neither a line nor a subject.
    const payload = reviewPayload({
      ...base,
      comments: [{ path: "a.kt", side: "RIGHT", body: "does this belong here?" }],
    });
    expect(payload.comments).toEqual([
      { path: "a.kt", subject_type: "file", body: "does this belong here?" },
    ]);
  });

  it("still sends a line comment as a line comment", () => {
    const payload = reviewPayload({
      ...base,
      comments: [
        { path: "a.kt", line: 12, side: "RIGHT", body: "here" },
        { path: "b.kt", side: "LEFT", body: "and this file" },
      ],
    });
    const [line, file] = payload.comments as Record<string, unknown>[];
    expect(line).toHaveProperty("line", 12);
    expect(line).not.toHaveProperty("subject_type");
    expect(file).toHaveProperty("subject_type", "file");
    expect(file).not.toHaveProperty("line");
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
