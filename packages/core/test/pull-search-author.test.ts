import { describe, expect, it } from "vitest";

import { findPulls } from "../src/git/pullSearch.js";

const pull = (number: number, author: string) => ({ number, author });

describe("the pull requests of one author, when the search index has nothing", () => {
  const sources = (searched: { number: number; author: string }[] | undefined, theirs?: { number: number; author: string }[]) => {
    const asked: string[] = [];
    return {
      asked,
      search: async () => searched,
      recent: async () => {
        asked.push("recent");
        return [pull(1, "someone")];
      },
      loginOf: (one: { author: string }) => one.author,
      ...(theirs ? { byAuthor: async (login: string) => {
        asked.push(`byAuthor:${login}`);
        return theirs;
      } } : {}),
    };
  };

  it("asks for the author's own pull requests before guessing from the recent ones", async () => {
    const from = sources([], [pull(7, "octocat"), pull(9, "octocat")]);
    expect(await findPulls({ state: "open", author: "octocat" }, from)).toEqual([pull(7, "octocat"), pull(9, "octocat")]);
    expect(from.asked).toEqual(["byAuthor:octocat"]);
  });

  it("does the same when the search failed outright", async () => {
    const from = sources(undefined, [pull(7, "octocat")]);
    expect(await findPulls({ state: "open", author: "octocat" }, from)).toEqual([pull(7, "octocat")]);
  });

  it("still falls back to the recent ones when the author has none either", async () => {
    const from = sources([], []);
    expect(await findPulls({ state: "open", author: "someone" }, from)).toEqual([pull(1, "someone")]);
    expect(from.asked).toEqual(["byAuthor:someone", "recent"]);
  });

  it("trusts the search when it answered", async () => {
    const from = sources([pull(3, "octocat")], [pull(7, "octocat")]);
    expect(await findPulls({ state: "open", author: "octocat" }, from)).toEqual([pull(3, "octocat")]);
    expect(from.asked).toEqual([]);
  });
});

describe("the state chip", () => {
  it("says open includes drafts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const asked = readFileSync(join(__dirname, "../../webview/src/app/sidebar/Asked.svelte"), "utf8");
    expect(asked).toMatch(/\{ value: "open", label: "Open\/draft" \}/);
  });
});
