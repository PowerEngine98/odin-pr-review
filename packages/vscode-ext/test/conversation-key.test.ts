import { describe, expect, it } from "vitest";

import { conversationKey, plainRef, savedFor } from "../src/session.js";

const repo = "/work/shop";
const live = (baseRef: string, headRef = "orders") => conversationKey({ repo, baseRef, headRef, worktree: true });

describe("the conversation a reading is filed under", () => {
  it("is the same whichever way its base is spelled", () => {
    expect(plainRef("origin/main")).toBe("main");
    expect(plainRef("refs/remotes/origin/main")).toBe("main");
    expect(plainRef("refs/heads/feature/totals")).toBe("feature/totals");
    expect(plainRef("feature/origin/x")).toBe("feature/origin/x");
    expect(live("origin/main")).toBe(live("main"));
  });

  it("is found where it was saved under the other spelling, the most recently used first", () => {
    const old = { comments: [{ createdAt: "2026-01-01T00:00:00Z" }], sessions: { claude: "older" } };
    const recent = { comments: [{ createdAt: "2026-01-05T00:00:00Z" }], sessions: { claude: "recent" } };
    const saved = {
      [["/work/shop", "origin/main", "orders", "live"].join("\u0000")]: old,
      [["/work/shop", "refs/remotes/origin/main", "orders", "live"].join("\u0000")]: recent,
      [["/work/shop", "main", "receipts", "live"].join("\u0000")]: { comments: [], sessions: { claude: "other branch" } },
    };
    expect(savedFor(saved, live("main"))?.sessions.claude).toBe("recent");
  });

  it("prefers what is saved under its own key", () => {
    const mine = { comments: [], sessions: { claude: "mine" } };
    const saved = { [live("main")]: mine, [["/work/shop", "origin/main", "orders", "live"].join("\u0000")]: { comments: [{ createdAt: "2027-01-01T00:00:00Z" }], sessions: { claude: "theirs" } } };
    expect(savedFor(saved, live("main"))).toBe(mine);
  });
});
