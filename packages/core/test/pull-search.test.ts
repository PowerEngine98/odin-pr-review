import { describe, expect, it } from "vitest";

import { findPulls, pullQuery } from "../src/git/pullSearch.js";

describe("the one search both VS Code and the browser use for pull requests", () => {
  it("says the state, the author and the words the way the forge's search reads them, newest first", () => {
    expect(pullQuery({ state: "open", author: "marco", search: "" })).toBe("is:pr is:open author:marco sort:updated-desc");
    expect(pullQuery({ state: "merged", author: "", search: "pricing gallery" })).toBe("is:pr is:merged pricing gallery sort:updated-desc");
    expect(pullQuery({ state: "closed", author: "", search: "" }, "acme/shop")).toBe("repo:acme/shop is:pr is:closed is:unmerged sort:updated-desc");
    expect(pullQuery({ state: "all", author: "ada", search: "" })).toBe("is:pr author:ada sort:updated-desc");
  });

  const sources = (searched: string[], fromSearch: string[], recent: string[]) => ({
    search: async (query: string) => {
      searched.push(query);
      return fromSearch;
    },
    recent: async () => recent,
    loginOf: (login: string) => login,
  });

  it("lists the newest when nothing narrows it, without searching", async () => {
    const searched: string[] = [];
    expect(await findPulls({ state: "open", author: "" }, sources(searched, ["x"], ["a", "b"]))).toEqual(["a", "b"]);
    expect(searched).toEqual([]);
  });

  it("asks the search for an author, however old their pull requests", async () => {
    const searched: string[] = [];
    expect(await findPulls({ state: "open", author: "marco" }, sources(searched, ["marco"], ["ada"]))).toEqual(["marco"]);
    expect(searched).toEqual(["is:pr is:open author:marco sort:updated-desc"]);
  });

  it("matches part of a login among the newest when the search knows no such author", async () => {
    expect(await findPulls({ state: "open", author: "marc" }, sources([], [], ["ada", "marcos"]))).toEqual(["marcos"]);
  });

  it("trusts the search when words were typed, even when it finds nothing", async () => {
    expect(await findPulls({ state: "open", author: "marc", search: "pricing" }, sources([], [], ["marcos"]))).toEqual([]);
  });
});
