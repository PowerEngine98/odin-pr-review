import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BaseStore } from "../src/base.js";

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

describe("remembering a base this reader picked", () => {
  it("says nothing about a repository they never answered for", () => {
    expect(new BaseStore(memento()).read()).toBeUndefined();
  });

  it("gives back what it was told", async () => {
    const store = new BaseStore(memento());
    await store.write("origin/development");
    expect(store.read()).toBe("origin/development");
  });

  it("survives a host that will not answer", async () => {
    // Read while a review is being built; a preference is never worth failing
    // a review over.
    const broken = {
      keys: () => [],
      get: () => {
        throw new Error("no store");
      },
      update: () => Promise.reject(new Error("no store")),
    };
    expect(new BaseStore(broken).read()).toBeUndefined();
    await expect(new BaseStore(broken).write("main")).resolves.toBeUndefined();
  });
});

/**
 * Nothing Odin does may write into the repository being reviewed.
 *
 * The base branch used to be remembered by updating `odin.baseRef` at workspace
 * scope, which VS Code writes to `.vscode/settings.json` — a file most
 * repositories commit. One person answering "review against which base?" once
 * therefore wrote a permanent instruction for everybody who cloned it, and for
 * every change any of them ever looked at. It is not discoverable as a setting
 * from the inside: what it looks like is other people's merged work appearing
 * inside your own branch.
 */
describe("the reviewer's repository", () => {
  it("is never written to by remembering a preference", () => {
    const source = ["extension.ts", "panel.ts", "sidebar.ts", "base.ts"]
      .map((name) =>
        readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"),
      )
      .join("\n");

    // The call that writes a settings file. Reading configuration is fine and
    // expected; updating it is what puts a file in somebody's working tree.
    expect(source).not.toMatch(/getConfiguration\([^)]*\)[\s\S]{0,80}\.update\(/);
    expect(source).not.toContain("ConfigurationTarget.Workspace");
  });
});
