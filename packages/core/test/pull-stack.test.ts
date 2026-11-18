import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "../src/model/types.js";
import { stackAround } from "../src/git/pullRequest.js";

const pr = (number: number, branch: string, baseRef: string, updatedAt = "2026-01-01T00:00:00Z"): PullRequestSummary => ({
  number,
  title: `#${number}`,
  url: "",
  branch,
  baseRef,
  draft: false,
  author: "octocat",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt,
});

function forge(pulls: PullRequestSummary[]) {
  return {
    headed: async (branch: string) => pulls.filter((one) => one.branch === branch),
    based: async (branch: string) => pulls.filter((one) => one.baseRef === branch),
  };
}

describe("a pull request stacked on others", () => {
  const bottom = pr(1, "a", "main");
  const middle = pr(2, "b", "a");
  const top = pr(3, "c", "b");
  const loose = pr(9, "z", "main");

  it("is found with what is under it and what is on it, bottom first, and where it sits", async () => {
    const stack = await stackAround({ number: 2, head: "b", base: "a" }, forge([bottom, middle, top, loose]));
    expect(stack?.pulls.map((one) => one.number)).toEqual([1, 2, 3]);
    expect(stack?.base).toBe("main");
    expect(stack?.at).toBe(1);
  });

  it("is the first of the stack when it sits right on the base branch", async () => {
    const stack = await stackAround({ number: 1, head: "a", base: "main" }, forge([bottom, middle, top]));
    expect(stack?.pulls.map((one) => one.number)).toEqual([1, 2, 3]);
    expect(stack?.at).toBe(0);
  });

  it("is no stack at all when nothing is under it or on it", async () => {
    expect(await stackAround({ number: 9, head: "z", base: "main" }, forge([bottom, loose]))).toBeUndefined();
  });

  it("follows the most recently active of two pull requests on the same branch", async () => {
    const older = pr(4, "d", "a", "2026-01-01T00:00:00Z");
    const newer = pr(5, "e", "a", "2026-02-01T00:00:00Z");
    const stack = await stackAround({ number: 1, head: "a", base: "main" }, forge([bottom, older, newer]));
    expect(stack?.pulls.map((one) => one.number)).toEqual([1, 5]);
  });

  it("stops at a loop instead of walking it forever", async () => {
    const one = pr(6, "x", "y");
    const two = pr(7, "y", "x");
    const stack = await stackAround({ number: 6, head: "x", base: "y" }, forge([one, two]));
    expect(stack?.pulls.map((each) => each.number).sort()).toEqual([6, 7]);
  });
});
