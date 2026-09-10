import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PairingSession } from "../src/pairing.js";
import { conversationKey, keyOf } from "../src/session.js";

/**
 * Which conversation belongs to which change.
 *
 * A live reading's tab is named after its checkout and deliberately not after a
 * branch: a working tree holds one HEAD, so there is one live picture of it, and
 * naming that picture after a branch lets two exist where only one can be true.
 *
 * That is the right answer to "which tab is this" and the wrong one to "what is
 * this conversation about". Filed under the tab's name, everything written
 * against one branch came back the moment another branch was read live in the
 * same checkout — the remarks, the threads, the agents' sessions, and the name
 * the reader had given one. A reviewer opened a pull request they had never
 * discussed and found somebody else's conversation on it, anchored to line
 * numbers that mean nothing in the file in front of them.
 */
function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
    held,
  };
}

describe("what a conversation is filed under", () => {
  it("keeps the branch, where the tab's name drops it", () => {
    const one = { repo: "/repo", baseRef: "development", headRef: "a", worktree: true };
    const two = { repo: "/repo", baseRef: "development", headRef: "b", worktree: true };

    // The fault, stated as the fact it rests on: one tab name for two branches.
    expect(keyOf(one)).toBe(keyOf(two));
    expect(conversationKey(one)).not.toBe(conversationKey(two));
  });

  it("still tells a live reading from a committed one", () => {
    // The same branch read two ways is two readings, and always was.
    expect(
      conversationKey({ repo: "/repo", headRef: "a", worktree: true }),
    ).not.toBe(conversationKey({ repo: "/repo", headRef: "a" }));
  });
});

describe("a second branch read live in one checkout", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "odin-keys-"));
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const where = { path: "src/one.ts", line: 3, side: "RIGHT" as const, author: "marco" };

  it("does not inherit the first one's conversation", () => {
    const store = memento();
    const first = new PairingSession(
      store as never,
      conversationKey({ repo, baseRef: "development", headRef: "one", worktree: true }),
      repo,
      () => {},
      true,
    );
    first.ask({ ...where, body: "about the first branch" });
    first.rename("claude", "Upload labor media onboarding");

    const second = new PairingSession(
      store as never,
      conversationKey({ repo, baseRef: "development", headRef: "two", worktree: true }),
      repo,
      () => {},
      true,
    );

    expect(second.local()).toEqual([]);
    // Including the name the reader gave the other one, which is what made this
    // visible: a console on a change nobody had discussed, wearing a title from
    // a conversation about something else.
    expect(second.label("claude")).toBe("");
  });
});

describe("conversations written before the distinction existed", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "odin-adopt-"));
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const where = { path: "src/one.ts", line: 3, side: "RIGHT" as const, author: "marco" };
  const old = keyOf({ repo: "/repo", baseRef: "development", worktree: true });
  const now = conversationKey({
    repo: "/repo",
    baseRef: "development",
    headRef: "one",
    worktree: true,
  });

  it("are taken over by the branch that is checked out", () => {
    // Losing a reviewer's notes to a rename of a storage key is not a fix.
    const store = memento();
    new PairingSession(store as never, old, repo, () => {}, true).ask({
      ...where,
      body: "written before the fix",
    });

    const after = new PairingSession(store as never, now, repo, () => {}, true, old);
    expect(after.local()).toHaveLength(1);
    expect(after.local()[0]?.body).toBe("written before the fix");
  });

  it("are taken over once, and not by every branch after it", () => {
    /*
     * The adoption has to consume what it adopted. Left in place, the next
     * branch read live in this checkout finds it too and inherits the same
     * notes — which is the original fault wearing a migration's clothes.
     */
    const store = memento();
    new PairingSession(store as never, old, repo, () => {}, true).ask({
      ...where,
      body: "written before the fix",
    });

    new PairingSession(store as never, now, repo, () => {}, true, old);

    const other = conversationKey({
      repo: "/repo",
      baseRef: "development",
      headRef: "two",
      worktree: true,
    });
    const next = new PairingSession(store as never, other, repo, () => {}, true, old);
    expect(next.local()).toEqual([]);
  });

  it("do not displace a branch that already has one of its own", () => {
    const store = memento();
    new PairingSession(store as never, old, repo, () => {}, true).ask({
      ...where,
      body: "the older conversation",
    });
    new PairingSession(store as never, now, repo, () => {}, true).ask({
      ...where,
      body: "this branch's own",
    });

    const back = new PairingSession(store as never, now, repo, () => {}, true, old);
    expect(back.local()).toHaveLength(1);
    expect(back.local()[0]?.body).toBe("this branch's own");
  });
});
