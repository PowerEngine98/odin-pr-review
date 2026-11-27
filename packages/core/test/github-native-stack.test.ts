import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "../src/model/types.js";
import { nativeStack, stackFrom, usesStacks } from "../src/git/pullRequest.js";

const answer = JSON.stringify([
  {
    id: 1,
    number: 9,
    base: { ref: "main" },
    open: true,
    pull_requests: [
      { number: 11, state: "open", head: { ref: "orders" } },
      { number: 12, state: "open", head: { ref: "totals" } },
      { number: 13, state: "open", head: { ref: "receipts" } },
    ],
  },
]);

const summary = (number: number, branch: string) => ({ number, branch, title: `#${number}` }) as unknown as PullRequestSummary;

describe("a pull request's stack, as GitHub itself keeps it", () => {
  it("is read in GitHub's order, bottom first, on GitHub's base", () => {
    expect(nativeStack(answer, 12)).toEqual({
      base: "main",
      pulls: [
        { number: 11, head: "orders" },
        { number: 12, head: "totals" },
        { number: 13, head: "receipts" },
      ],
    });
  });

  it("is nothing for a pull request GitHub has in no stack, or an answer that is not one", () => {
    expect(nativeStack(answer, 99)).toBeUndefined();
    expect(nativeStack("[]", 12)).toBeUndefined();
    expect(nativeStack('{"message":"Not Found"}', 12)).toBeUndefined();
    expect(nativeStack(undefined, 12)).toBeUndefined();
  });

  it("places the pull request being read where GitHub does, so 1/3 here is 1/3 there", async () => {
    const heads: Record<string, PullRequestSummary[]> = {
      orders: [summary(11, "orders")],
      totals: [summary(12, "totals")],
      receipts: [summary(13, "receipts")],
    };
    const stack = await stackFrom(nativeStack(answer, 11)!, 11, async (branch) => heads[branch]);
    expect(stack?.pulls.map((one) => one.number)).toEqual([11, 12, 13]);
    expect(stack?.at).toBe(0);
    expect(stack?.base).toBe("main");
    expect(await stackFrom(nativeStack(answer, 11)!, 11, async (branch) => (branch === "totals" ? [] : heads[branch]))).toBeUndefined();
  });

  it("is trusted even when empty, once the repository keeps stacks on GitHub at all", () => {
    expect(usesStacks(answer)).toBe(true);
    expect(usesStacks("[]")).toBe(false);
    expect(usesStacks(undefined)).toBe(false);
  });
});
