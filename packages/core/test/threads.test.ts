import { describe, expect, it } from "vitest";

import { parseThreads, stampThreads } from "../src/git/review.js";

import type { ReviewComment } from "../src/git/review.js";

/** The forge's answer, nested as deeply as it really is. */
function answer(threads: unknown[]): string {
  return JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
  });
}

describe("which conversations the forge calls settled", () => {
  it("marks every comment in a thread, not only its first", () => {
    // A reader clicks a reply as often as a root, and both have to answer the
    // same question about the conversation they are in.
    const found = parseThreads(
      answer([
        {
          id: "T_1",
          isResolved: true,
          comments: { nodes: [{ databaseId: 11 }, { databaseId: 12 }] },
        },
      ]),
    );
    expect(found.get(11)).toEqual({ threadId: "T_1", resolved: true });
    expect(found.get(12)).toEqual({ threadId: "T_1", resolved: true });
  });

  it("tells an open conversation from a settled one", () => {
    const found = parseThreads(
      answer([
        { id: "T_1", isResolved: false, comments: { nodes: [{ databaseId: 1 }] } },
        { id: "T_2", isResolved: true, comments: { nodes: [{ databaseId: 2 }] } },
      ]),
    );
    expect(found.get(1)?.resolved).toBe(false);
    expect(found.get(2)?.resolved).toBe(true);
  });

  it("treats a thread with no verdict as open", () => {
    // Absent is not resolved. A tick on a conversation nobody settled is the
    // one wrong answer here, because it says the discussion is over.
    const found = parseThreads(
      answer([{ id: "T_1", comments: { nodes: [{ databaseId: 5 }] } }]),
    );
    expect(found.get(5)?.resolved).toBe(false);
  });

  it("steps over the holes the forge leaves", () => {
    // Every level of that query is nullable, and a null anywhere used to be a
    // thrown error rather than a missing tick.
    const found = parseThreads(
      answer([null, { id: undefined }, { id: "T_1", comments: { nodes: [null] } }]),
    );
    expect(found.size).toBe(0);
  });

  it("says nothing rather than throwing on an answer it cannot read", () => {
    expect(parseThreads("not json").size).toBe(0);
    expect(parseThreads("{}").size).toBe(0);
  });
});

/**
 * Putting the two answers together.
 *
 * The forge answers comments and conversations apart — one request knows the
 * bodies and the reply pointers, the other knows which run of them is one
 * thread and whether anybody has settled it — so every reader of a comment
 * gets whichever of the two the code path happened to fetch unless they are
 * joined in one place.
 */
function comment(id: number): ReviewComment {
  return {
    id,
    path: "src/a.ts",
    line: 3,
    side: "RIGHT",
    body: "",
    author: "someone",
    createdAt: "2026-01-01T00:00:00Z",
    url: "",
    outdated: false,
  } as ReviewComment;
}

describe("comments with their conversations on them", () => {
  it("puts the thread and its state on the comments in it", () => {
    const joined = stampThreads(
      [comment(5), comment(6)],
      new Map([[5, { threadId: "T_1", resolved: true }]]),
    );
    expect(joined[0]!.threadId).toBe("T_1");
    expect(joined[0]!.resolved).toBe(true);
  });

  it("leaves a comment the query never mentioned as it was", () => {
    // The ordinary case on a pull request with more conversations than the
    // shallow query asks for. A comment that lost its thread because the second
    // request was truncated would be worse than one that never had it.
    const joined = stampThreads(
      [comment(6)],
      new Map([[5, { threadId: "T_1", resolved: true }]]),
    );
    expect(joined[0]!.threadId).toBeUndefined();
    expect(joined[0]!.resolved).toBeUndefined();
  });

  it("says an open conversation is open rather than saying nothing", () => {
    const joined = stampThreads(
      [comment(5)],
      new Map([[5, { threadId: "T_1", resolved: false }]]),
    );
    expect(joined[0]!.resolved).toBe(false);
  });

  it("hands back the comments when the forge knew of no threads", () => {
    const given = [comment(5)];
    expect(stampThreads(given, new Map())).toEqual(given);
  });

  it("does not write on the comments it was given", () => {
    const given = [comment(5)];
    stampThreads(given, new Map([[5, { threadId: "T_1", resolved: true }]]));
    expect(given[0]!.threadId).toBeUndefined();
  });
});
