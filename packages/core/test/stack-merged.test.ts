import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "../src/model/types.js";
import { formerBases, landedUnder, stackAround } from "../src/git/pullRequest.js";

function pr(number: number, branch: string, baseRef: string, extra: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return { number, title: `#${number}`, url: "", branch, baseRef, draft: false, author: "someone", createdAt: "2026-01-01T00:00:00Z", state: "open", ...extra } as PullRequestSummary;
}

describe("a stack whose first pull request has already merged", () => {
  const merged = pr(1, "orders", "main", { state: "merged", mergeCommit: "a".repeat(40), mergedAt: "2026-01-05T00:00:00Z" });
  const middle = pr(2, "totals", "main");
  const top = pr(3, "receipts", "totals");

  it("still counts it, at the bottom, so the second is 2 of 3", async () => {
    const stack = await stackAround(
      { number: 2, head: "totals", base: "main" },
      {
        headed: async (branch) => [middle, top].filter((one) => one.branch === branch),
        based: async (branch) => [middle, top].filter((one) => one.baseRef === branch),
        merged: async (pull) => (pull.number === 2 ? merged : undefined),
      },
    );
    expect(stack?.pulls.map((one) => one.number)).toEqual([1, 2, 3]);
    expect(stack?.at).toBe(1);
    expect(stack?.base).toBe("main");
  });

  it("is found from the branch GitHub moved the next one off when it merged", () => {
    const json = JSON.stringify({
      data: { repository: { pullRequest: { createdAt: "2026-01-02T00:00:00Z", timelineItems: { nodes: [{ previousRefName: "main" }, { previousRefName: "orders" }] } } } },
    });
    expect(formerBases(json)).toEqual({ createdAt: "2026-01-02T00:00:00Z", former: ["orders", "main"] });
    expect(formerBases("not json")).toEqual({ former: [] });
  });

  it("is found from its merge commit, when the next one was opened before it merged and now sits on it", () => {
    const sha = "a".repeat(40);
    expect(landedUnder({ createdAt: "2026-01-02T00:00:00Z" }, sha, [merged])).toBe(merged);
    expect(landedUnder({ createdAt: "2026-01-06T00:00:00Z" }, sha, [merged])).toBeUndefined();
    expect(landedUnder({ createdAt: "2026-01-02T00:00:00Z" }, "b".repeat(40), [merged])).toBeUndefined();
  });
});
