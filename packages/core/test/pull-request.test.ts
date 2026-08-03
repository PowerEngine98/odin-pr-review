import { describe, expect, it } from "vitest";

import { byActivity } from "../src/git/pullRequest.js";
import type { PullRequestSummary } from "../src/model/types.js";

function pull(
  number: number,
  createdAt: string,
  updatedAt?: string,
): PullRequestSummary {
  return {
    number,
    title: `#${number}`,
    url: `https://example.test/${number}`,
    branch: `b${number}`,
    draft: false,
    author: "ada",
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

const order = (pulls: PullRequestSummary[]) =>
  [...pulls].sort(byActivity).map((p) => p.number);

describe("the order the open pull requests are shown in", () => {
  it("puts what moved most recently first", () => {
    const stale = pull(1, "2026-07-01T09:00:00Z", "2026-07-02T09:00:00Z");
    const busy = pull(2, "2026-06-01T09:00:00Z", "2026-08-01T09:00:00Z");
    expect(order([stale, busy])).toEqual([2, 1]);
  });

  it("falls back to when it was opened within the same hour", () => {
    // Two comments minutes apart are equally recent to someone scanning the
    // list; letting them swap places every refresh makes it unlearnable.
    const older = pull(1, "2026-07-01T09:00:00Z", "2026-08-01T09:05:00Z");
    const newer = pull(2, "2026-07-20T09:00:00Z", "2026-08-01T09:55:00Z");
    expect(order([older, newer])).toEqual([2, 1]);
  });

  it("keeps a different hour ahead of a newer pull request", () => {
    const touchedLater = pull(1, "2026-07-01T09:00:00Z", "2026-08-01T10:00:00Z");
    const openedLater = pull(2, "2026-07-31T09:00:00Z", "2026-08-01T09:00:00Z");
    expect(order([openedLater, touchedLater])).toEqual([1, 2]);
  });

  it("uses creation for a pull request the forge said nothing else about", () => {
    const withoutUpdate = pull(1, "2026-08-01T11:00:00Z");
    const withUpdate = pull(2, "2026-01-01T09:00:00Z", "2026-08-01T09:00:00Z");
    expect(order([withUpdate, withoutUpdate])).toEqual([1, 2]);
  });

  it("settles a complete tie by number, so the order never wobbles", () => {
    const a = pull(7, "2026-08-01T09:00:00Z", "2026-08-01T09:00:00Z");
    const b = pull(3, "2026-08-01T09:00:00Z", "2026-08-01T09:00:00Z");
    expect(order([a, b])).toEqual([3, 7]);
  });
});
