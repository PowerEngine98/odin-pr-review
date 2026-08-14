import { describe, expect, it } from "vitest";

import { SettingsStore } from "../src/settings.js";

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

describe("remembering how the reader likes to read", () => {
  it("says nothing about a reader who has never chosen", () => {
    // Nothing stored has to be distinguishable from something stored, because
    // the page lays what it is given over its own defaults and an empty object
    // is not the same as no answer.
    expect(new SettingsStore(memento()).read()).toBeUndefined();
  });

  it("gives back what it was told", async () => {
    const store = new SettingsStore(memento());
    await store.write({ showImports: false, hud: { map: false } });
    expect(store.read()).toEqual({ showImports: false, hud: { map: false } });
  });

  it("holds no opinion about what a setting is", async () => {
    // The page owns what these mean. A host that knew the names would have to
    // be taught every new one, and a field the page has stopped using costs a
    // few bytes and nothing else.
    const store = new SettingsStore(memento());
    await store.write({ somethingAddedLater: 3 });
    expect(store.read()).toEqual({ somethingAddedLater: 3 });
  });

  it("ignores a stored value it cannot use", async () => {
    // Written by a version that meant something different by this key. The
    // page's own defaults beat a shape it will not understand.
    const held = memento();
    await held.update("odin.settings", "unified");
    expect(new SettingsStore(held).read()).toBeUndefined();
  });

  /**
   * A preference is never worth a blank panel.
   *
   * This is read while a page is being built, so anything it throws takes the
   * whole review down — and what the reader would get instead is their own
   * defaults, which is what somebody who has never opened the settings sees.
   */
  describe("a host that will not answer", () => {
    const broken = {
      keys: () => [],
      get: () => {
        throw new Error("no store");
      },
      update: () => Promise.reject(new Error("no store")),
    };

    it("reads as though nothing were stored", () => {
      expect(new SettingsStore(broken).read()).toBeUndefined();
    });

    it("lets a write fail quietly", async () => {
      await expect(
        new SettingsStore(broken).write({ showImports: false }),
      ).resolves.toBeUndefined();
    });
  });
});
