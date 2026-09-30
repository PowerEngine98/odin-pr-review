import { describe, expect, it } from "vitest";

import { sinceToAsk, viewOf, viewSuffix } from "../src/views.js";

const HEAD = "a".repeat(40);
const REVIEWED = "b".repeat(40);

describe("which view a reading is", () => {
  it("is the whole change when it starts at the merge base", () => {
    expect(viewOf({ headSha: HEAD })).toBe("all");
    expect(viewOf({ headSha: HEAD, worktree: true })).toBe("all");
    expect(viewSuffix({ headSha: HEAD })).toBe("");
  });

  it("is the uncommitted work when a live reading starts at its own head", () => {
    const meta = { headSha: HEAD, worktree: true, since: HEAD };
    expect(viewOf(meta)).toBe("uncommitted");
    expect(viewSuffix(meta)).toBe(" (uncommitted)");
  });

  it("is what came after a review when it starts anywhere else", () => {
    const meta = { headSha: HEAD, since: REVIEWED };
    expect(viewOf(meta)).toBe("since");
    expect(viewOf({ ...meta, worktree: true })).toBe("since");
    expect(viewSuffix(meta)).toBe(" (since bbbbbbb)");
  });
});

describe("what a rebuild asks to start from", () => {
  it("follows HEAD for the uncommitted view, so a commit moves work out of it", () => {
    expect(sinceToAsk({ headSha: HEAD, worktree: true, since: HEAD })).toBe("HEAD");
  });

  it("keeps the reviewed commit, and asks for nothing for the whole change", () => {
    expect(sinceToAsk({ headSha: HEAD, since: REVIEWED })).toBe(REVIEWED);
    expect(sinceToAsk({ headSha: HEAD })).toBeUndefined();
  });
});
