import { describe, expect, it } from "vitest";

import { SeenStore } from "../src/seen.js";

/** The editor's key-value store, as much of it as this uses. */
function memento() {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback?: T) =>
      (values.has(key) ? values.get(key) : fallback) as T,
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

const REPO = "/work/app";

describe("knowing a pull request has moved since it was read", () => {
  it("says nothing about one that has never been opened", () => {
    // Never read is new, not updated, and a badge on every row the first time
    // the list appears says nothing at all.
    const store = new SeenStore(memento());
    expect(store.movedOn(REPO, 7, "abc123")).toBe(false);
  });

  it("says nothing while the head is where it was", () => {
    const store = new SeenStore(memento());
    store.mark(REPO, 7, "abc123", "2026-08-01T09:00:00Z");
    expect(store.movedOn(REPO, 7, "abc123")).toBe(false);
  });

  it("reports a head that has changed since it was read", () => {
    const store = new SeenStore(memento());
    store.mark(REPO, 7, "abc123", "2026-08-01T09:00:00Z");
    expect(store.movedOn(REPO, 7, "def456")).toBe(true);
  });

  it("keeps repositories and pull requests apart", () => {
    const store = new SeenStore(memento());
    store.mark(REPO, 7, "abc123", "2026-08-01T09:00:00Z");
    expect(store.movedOn("/work/other", 7, "def456")).toBe(false);
    expect(store.movedOn(REPO, 8, "def456")).toBe(false);
  });

  it("says nothing when the forge did not report a head", () => {
    const store = new SeenStore(memento());
    store.mark(REPO, 7, "abc123", "2026-08-01T09:00:00Z");
    expect(store.movedOn(REPO, 7, undefined)).toBe(false);
  });

  it("refuses to record an empty commit, which would flag everything after it", () => {
    const store = new SeenStore(memento());
    store.mark(REPO, 7, "", "2026-08-01T09:00:00Z");
    expect(store.get(REPO, 7)).toBeUndefined();
  });
});
