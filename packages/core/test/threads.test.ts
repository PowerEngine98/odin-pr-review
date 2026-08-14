import { describe, expect, it } from "vitest";

import { parseThreads } from "../src/git/review.js";

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
