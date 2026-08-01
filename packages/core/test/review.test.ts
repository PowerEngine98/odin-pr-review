import { describe, expect, it } from "vitest";

import { parseComments, reviewPayload } from "../src/git/review.js";

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
