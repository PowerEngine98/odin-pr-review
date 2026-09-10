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

describe("conversations written before a conversation had a name of its own", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "odin-old-"));
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

  it("are left where they are rather than handed to whichever branch is open", () => {
    /*
     * The first attempt at this took them over, on the reasoning that a
     * reviewer's notes should not be lost to a rename. It was wrong, and wrong
     * in exactly the way being fixed: the old record was filed under a name
     * with no branch in it, so nothing in it says which branch it was about,
     * and giving it to the branch that happens to be checked out is the same
     * guess that put one change's conversation onto another in the first place.
     *
     * Nothing is deleted. There is a command for a reading that has ended up
     * holding somebody else's conversation, which is the only honest remedy
     * once one has.
     */
    const store = memento();
    new PairingSession(store as never, old, repo, () => {}, true).ask({
      ...where,
      body: "written before the fix",
    });

    const after = new PairingSession(store as never, now, repo, () => {}, true);
    expect(after.local()).toEqual([]);
  });

  it("can be thrown away when a reading is holding the wrong one", () => {
    const store = memento();
    const paired = new PairingSession(store as never, now, repo, () => {}, true);
    paired.ask({ ...where, body: "about some other branch entirely" });
    paired.rename("claude", "Upload labor media onboarding");
    expect(paired.weight().remarks).toBe(1);

    paired.forgetEverything();

    expect(paired.local()).toEqual([]);
    expect(paired.label("claude")).toBe("");
    // And it stays gone across a reload, rather than coming back with the
    // window.
    const back = new PairingSession(store as never, now, repo, () => {}, true);
    expect(back.local()).toEqual([]);
    expect(back.label("claude")).toBe("");
  });
});
