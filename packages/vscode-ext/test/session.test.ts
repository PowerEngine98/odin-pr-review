import { describe, expect, it } from "vitest";

import { keyOf, SessionStore, type Session } from "../src/session.js";

/** A workspace memento that forgets nothing and asks nobody. */
function memento(seed: Record<string, unknown> = {}) {
  const held: Record<string, unknown> = { ...seed };
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      if (value === undefined) delete held[key];
      else held[key] = value;
      return Promise.resolve();
    },
    held,
  };
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("coming back to the review that was on screen", () => {
  it("remembers the question rather than the answer", () => {
    // The graph is derived from the repository and would be stale the moment
    // anyone committed. The refs that produced it stay true.
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w", baseRef: "origin/development", number: 152 });

    const back = store.last();
    expect(back?.repo).toBe("/w");
    expect(back?.baseRef).toBe("origin/development");
    expect(back?.number).toBe(152);
    expect(back).not.toHaveProperty("nodes");
  });

  it("carries whether the reading included uncommitted work", () => {
    // A local reading and the forge's reading of one branch are two different
    // changes, and reopening the wrong one would be worse than reopening none.
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w", worktree: true });
    expect(store.last()?.worktree).toBe(true);
  });

  it("offers nothing when nothing was ever shown", () => {
    expect(new SessionStore(memento() as never).last()).toBeUndefined();
  });

  it("reopens a review from a moment ago", () => {
    const seed: Session = { repo: "/w", at: ago(30_000) };
    expect(new SessionStore(memento({ "odin.session": seed }) as never).last()?.repo).toBe("/w");
  });

  it("lets a day-old review go", () => {
    // A reload is measured in seconds and a lunch break in hours. Beyond a day
    // the branch has moved on, and rebuilding a graph unasked is the tool
    // deciding what the reader came here to do.
    const seed: Session = { repo: "/w", at: ago(25 * 60 * 60 * 1000) };
    expect(new SessionStore(memento({ "odin.session": seed }) as never).last()).toBeUndefined();
  });

  it("ignores a record with no repository in it", () => {
    const seed = { at: new Date().toISOString() } as Session;
    expect(new SessionStore(memento({ "odin.session": seed }) as never).last()).toBeUndefined();
  });

  it("forgets on request", () => {
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w" });
    store.clear();
    expect(store.last()).toBeUndefined();
  });
});

/**
 * A base that stopped meaning what it meant.
 *
 * `HEAD~4` was a good answer at the moment it was written down and means
 * something else by the next commit — it is measured from wherever `HEAD` now
 * is. Replaying one compares the change against a point nobody chose, and it
 * shows up as other people's work inside the reader's branch rather than as a
 * stale session.
 */
describe("reopening against a base that has moved", () => {
  it("forgets a base that names a commit rather than a branch", () => {
    const held = memento();
    const store = new SessionStore(held);
    store.remember({ repo: "/w", baseRef: "HEAD~4" });
    expect(store.last()?.baseRef).toBeUndefined();
    // The rest of the session is still worth reopening.
    expect(store.last()?.repo).toBe("/w");
  });

  it("keeps one that names a branch", () => {
    const store = new SessionStore(memento());
    store.remember({ repo: "/w", baseRef: "origin/development" });
    expect(store.last()?.baseRef).toBe("origin/development");
  });
});

/**
 * Every reading that was on screen, not merely the last one.
 *
 * There is one tab per reading now. The single slot this store used to be
 * answered for whichever was opened most recently, so a reviewer comparing two
 * changes came back to one of them and no sign the other had existed.
 */
describe("coming back to all of them", () => {
  it("keeps one entry per reading", () => {
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w", baseRef: "main", headRef: "one", number: 1 });
    store.remember({ repo: "/w", baseRef: "main", headRef: "two", number: 2 });

    expect(store.readings().map((r) => r.headRef)).toEqual(["two", "one"]);
  });

  it("tells the live reading of a branch from the committed one", () => {
    // Two tabs onto the same branch, and the reader means to have both: one
    // follows their typing and the other does not.
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w", baseRef: "main", headRef: "one" });
    store.remember({ repo: "/w", baseRef: "main", headRef: "one", worktree: true });

    expect(store.readings()).toHaveLength(2);
  });

  it("replaces a reading rather than stacking it up", () => {
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w", baseRef: "main", headRef: "one" });
    store.remember({ repo: "/w", baseRef: "main", headRef: "one" });

    expect(store.readings()).toHaveLength(1);
  });

  it("forgets the one whose tab was closed and keeps the rest", () => {
    const store = new SessionStore(memento() as never);
    store.remember({ repo: "/w", baseRef: "main", headRef: "one" });
    store.remember({ repo: "/w", baseRef: "main", headRef: "two" });
    store.forget(keyOf({ repo: "/w", baseRef: "main", headRef: "one" }));

    expect(store.readings().map((r) => r.headRef)).toEqual(["two"]);
  });

  it("reads a window that last ran a build with only the one slot", () => {
    // Nothing wrote the list, and the reading that build did record is still a
    // reading. Coming back to nothing would be worse than coming back to one.
    const store = new SessionStore(
      memento({ "odin.session": { repo: "/w", baseRef: "main", at: ago(1000) } }) as never,
    );
    expect(store.readings().map((r) => r.repo)).toEqual(["/w"]);
  });

  it("drops the ones nobody has been back to", () => {
    const stale = { repo: "/w", headRef: "old", at: ago(48 * 60 * 60 * 1000) };
    const store = new SessionStore(
      memento({
        "odin.sessions": [stale, { repo: "/w", headRef: "new", at: ago(1000) }],
      }) as never,
    );
    expect(store.readings().map((r) => r.headRef)).toEqual(["new"]);
  });

  it("bounds how many a reload will rebuild", () => {
    // Each one is a diff read and every reference in it resolved. A dozen at
    // once is a minute of a machine doing nothing else.
    const store = new SessionStore(memento() as never);
    for (let i = 0; i < 12; i++) {
      store.remember({ repo: "/w", baseRef: "main", headRef: `b${i}` });
    }
    expect(store.readings().length).toBeLessThanOrEqual(6);
    expect(store.readings()[0]?.headRef).toBe("b11");
  });
});
