import { describe, expect, it } from "vitest";

import { pullQuery } from "@odin/core";

import { GitHubError, listPulls, placeOf, readPull, stateOf, type PullJson } from "../src/github.js";

function pull(number: number, extra: Partial<PullJson> = {}): PullJson {
  return {
    number,
    title: `Change ${number}`,
    html_url: `https://github.com/acme/shop/pull/${number}`,
    state: "open",
    base: { ref: "main", sha: "b".repeat(40) },
    head: { ref: `feature/${number}`, sha: "h".repeat(40) },
    user: { login: "ada" },
    ...extra,
  };
}

function answering(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const key = Object.keys(routes).find((k) => url.includes(k.split(" ")[0]!) && (!k.includes(" ") || accept.includes(k.split(" ")[1]!)));
    if (!key) return new Response("{}", { status: 404 });
    return routes[key]!();
  }) as typeof fetch;
}

describe("where the reader is on GitHub", () => {
  it("finds the repository and the pull request", () => {
    expect(placeOf("/acme/shop/pull/12/files")).toEqual({ owner: "acme", repo: "shop", number: 12 });
    expect(placeOf("/acme/shop/pulls")).toEqual({ owner: "acme", repo: "shop" });
    expect(placeOf("/acme/shop")).toEqual({ owner: "acme", repo: "shop" });
  });

  it("is nowhere on pages that are not a repository", () => {
    expect(placeOf("/settings/profile")).toBeUndefined();
    expect(placeOf("/orgs/acme/teams")).toBeUndefined();
    expect(placeOf("/acme")).toBeUndefined();
  });
});

describe("reading GitHub", () => {
  it("asks for the pull request and its diff, with the token when there is one", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(`${headers.get("accept")} ${headers.get("authorization")}`);
      if (headers.get("accept")?.includes("diff")) return new Response("diff --git a/x b/x\n");
      return new Response(JSON.stringify(pull(7)));
    }) as typeof fetch;
    const read = await readPull({ owner: "acme", repo: "shop", number: 7 }, { token: "t0k", fetch: fetcher });
    expect(read.pull.number).toBe(7);
    expect(read.diff).toContain("diff --git");
    expect(seen.sort()).toEqual([
      "application/vnd.github+json Bearer t0k",
      "application/vnd.github.diff Bearer t0k",
    ]);
  });

  it("says why it could not read", async () => {
    const limited = answering({
      "/pulls/7": () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    });
    await expect(readPull({ owner: "acme", repo: "shop", number: 7 }, { fetch: limited }))
      .rejects.toMatchObject({ reason: "limited" });

    const missing = answering({});
    await expect(readPull({ owner: "acme", repo: "shop", number: 7 }, { fetch: missing }))
      .rejects.toBeInstanceOf(GitHubError);
  });

  it("filters merged, closed and by author the way the picker asks", async () => {
    const pulls = [
      pull(1, { state: "closed", merged_at: "2026-01-01T00:00:00Z" }),
      pull(2, { state: "closed" }),
      pull(3, { user: { login: "Grace" } }),
    ];
    const fetcher = (async (input: string | URL | Request) => {
      const state = new URL(String(input)).searchParams.get("state");
      const answered = pulls.filter((p) => state === "all" || p.state === state);
      return new Response(JSON.stringify(answered));
    }) as typeof fetch;
    const place = { owner: "acme", repo: "shop" };
    const numbers = async (state: "open" | "merged" | "closed" | "all", author = "") =>
      (await listPulls(place, { fetch: fetcher }, { state, author })).map((p) => p.number);
    expect(await numbers("merged")).toEqual([1]);
    expect(await numbers("closed")).toEqual([2]);
    expect(await numbers("all", "grace")).toEqual([3]);
  });

  it("calls a landed change merged", () => {
    expect(stateOf(pull(1, { state: "closed", merged_at: "2026-01-01T00:00:00Z" }))).toBe("MERGED");
    expect(stateOf(pull(1))).toBe("OPEN");
  });
});

describe("listing pull requests in a repository with many contributors", () => {
  const place = { owner: "acme", repo: "shop" };
  const found = (number: number, login: string) => ({
    number,
    title: `t${number}`,
    html_url: `https://github.com/acme/shop/pull/${number}`,
    state: "open",
    user: { login },
    pull_request: { merged_at: null },
  });

  it("asks GitHub's search for an author's pull requests, however old", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ items: [found(4, "marco")] }));
    }) as typeof fetch;
    const pulls = await listPulls(place, { fetch: fetcher }, { state: "open", author: "marco" });
    expect(pulls.map((one) => one.number)).toEqual([4]);
    expect(decodeURIComponent(seen[0]!)).toContain("/search/issues?q=repo:acme/shop is:pr is:open author:marco sort:updated-desc");
  });

  it("asks the same question VS Code asks, with the repository in front", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      seen.push(decodeURIComponent(String(input)));
      return new Response(JSON.stringify({ items: [found(5, "ada")] }));
    }) as typeof fetch;
    await listPulls(place, { fetch: fetcher }, { state: "merged", author: "", search: "pricing" });
    expect(seen[0]).toContain(`q=repo:acme/shop ${pullQuery({ state: "merged", author: "", search: "pricing" })}`);
  });

  it("falls back to part of a login among the newest when the search finds no such author", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/search/issues")) return new Response(JSON.stringify({ items: [] }));
      return new Response(JSON.stringify([pull(1), { ...pull(2), user: { login: "marcos" } }]));
    }) as typeof fetch;
    const pulls = await listPulls(place, { fetch: fetcher }, { state: "open", author: "marc" });
    expect(pulls.map((one) => one.number)).toEqual([2]);
    expect(seen[1]).toContain("/repos/acme/shop/pulls?");
  });
});

