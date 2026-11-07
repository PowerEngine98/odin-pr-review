import { afterEach, describe, expect, it } from "vitest";

import { listen, NotHere, type BridgeBackend } from "../src/bridge-server.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pairingFrom, remoteFor } from "../src/bridge.js";
import { githubRepositories, Repositories } from "../src/repositories.js";

const TOKEN = "a".repeat(48);
const ORIGIN = `chrome-extension://${"b".repeat(32)}`;

const delivered: unknown[] = [];
let closed = 0;

const backend: BridgeBackend = {
  async session(_owner, repo, number, _base, sink) {
    if (repo === "elsewhere") throw new NotHere("not here");
    sink.send({ type: "html", html: `<p>#${number}</p>` });
    sink.send({ type: "message", message: { type: "agents" } });
    return { id: "s1", deliver: (message) => delivered.push(message), close: () => closed++ };
  },
  version: "1.2.3",
  async where(_owner, repo) {
    if (repo === "twice") return { need: "pick" };
    return { path: `/code/${repo}` };
  },
  async graph(owner, repo, number, base) {
    if (repo === "elsewhere") throw new NotHere(`${owner}/${repo} is not open in VS Code.`);
    return { graph: { owner, repo, number, base }, snippets: [] };
  },
};

let close: (() => void) | undefined;
afterEach(() => close?.());

async function served(): Promise<number> {
  const opened = await listen(() => ({ token: TOKEN, origin: ORIGIN }), backend);
  if (!opened) throw new Error("no port");
  close = () => opened.server.close();
  return opened.port;
}

describe("the bridge the browser extension talks to", () => {
  it("answers the paired extension, and only it", async () => {
    const port = await served();
    const url = `http://127.0.0.1:${port}/odin/hello`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: `Bearer ${TOKEN}`, origin: "https://example.com" } })).status).toBe(403);
    const ok = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await ok.json()).toEqual({ odin: true, version: "1.2.3" });
  });

  it("serves a pull request's graph, and says when its repository is not open", async () => {
    const port = await served();
    const auth = { authorization: `Bearer ${TOKEN}` };
    const graph = await fetch(`http://127.0.0.1:${port}/odin/graph?owner=acme&repo=shop&number=7&base=main`, { headers: auth });
    expect(await graph.json()).toEqual({ graph: { owner: "acme", repo: "shop", number: 7, base: "main" }, snippets: [] });
    const missing = await fetch(`http://127.0.0.1:${port}/odin/graph?owner=acme&repo=elsewhere&number=7`, { headers: auth });
    expect(missing.status).toBe(404);
    const bad = await fetch(`http://127.0.0.1:${port}/odin/graph?owner=acme&repo=shop&number=x`, { headers: auth });
    expect(bad.status).toBe(400);
  });
});

describe("a reading shared with the browser", () => {
  it("streams the page and what the host says, and carries the page's messages back", async () => {
    const port = await served();
    const auth = { authorization: `Bearer ${TOKEN}` };
    const stop = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/odin/session?owner=acme&repo=shop&number=7&base=main`, {
      headers: auth,
      signal: stop.signal,
    });
    const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (text.split("\n").length < 4) text += (await reader.read()).value ?? "";
    const events = text.trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    expect(events.map((e) => e.type)).toEqual(["html", "message", "session"]);

    const sent = await fetch(`http://127.0.0.1:${port}/odin/session/s1`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ type: "askAgent", text: "why?" }),
    });
    expect(sent.status).toBe(200);
    expect(delivered).toEqual([{ type: "askAgent", text: "why?" }]);

    stop.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(1);
  });

  it("says when the repository has no folder yet", async () => {
    const port = await served();
    const stream = await fetch(`http://127.0.0.1:${port}/odin/session?owner=acme&repo=elsewhere&number=7`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(JSON.parse((await stream.text()).trim())).toEqual({ type: "error", missing: true, error: "not here" });
  });
});

describe("asking where a repository is", () => {
  it("answers with its folder, or with what the reader has to decide", async () => {
    const port = await served();
    const auth = { authorization: `Bearer ${TOKEN}` };
    const one = await fetch(`http://127.0.0.1:${port}/odin/where?owner=acme&repo=shop`, { headers: auth });
    expect(await one.json()).toEqual({ path: "/code/shop" });
    const two = await fetch(`http://127.0.0.1:${port}/odin/where?owner=acme&repo=twice`, { headers: auth });
    expect(await two.json()).toEqual({ need: "pick" });
    const bad = await fetch(`http://127.0.0.1:${port}/odin/where?owner=acme&repo=a%20b`, { headers: auth });
    expect(bad.status).toBe(400);
  });
});

describe("the folders Odin remembers for each repository", () => {
  const registry = () => new Repositories(join(mkdtempSync(join(tmpdir(), "odin-")), "repositories.json"));

  it("reads every GitHub repository a folder's remotes point at", () => {
    const remotes = "origin\tgit@github.com:Acme/Shop.git (fetch)\nfork\thttps://github.com/ada/shop (fetch)\nlab\thttps://gitlab.com/x/y (fetch)";
    expect(githubRepositories(remotes)).toEqual(["acme/shop", "ada/shop"]);
  });

  it("keeps each folder once, and the reader's choice among them", async () => {
    const known = registry();
    const here = mkdtempSync(join(tmpdir(), "shop-"));
    const there = mkdtempSync(join(tmpdir(), "shop-"));
    known.record("Acme/Shop", here);
    known.record("acme/shop", here);
    known.record("acme/shop", there);
    expect(await known.candidates("acme/shop", async () => true)).toEqual({ paths: [here, there] });
    known.choose("acme/shop", there);
    expect((await known.candidates("acme/shop", async () => true)).chosen).toBe(there);
  });

  it("forgets folders that are gone or no longer that repository", async () => {
    const known = registry();
    const kept = mkdtempSync(join(tmpdir(), "shop-"));
    const moved = mkdtempSync(join(tmpdir(), "shop-"));
    known.record("acme/shop", "/nowhere/shop");
    known.record("acme/shop", kept);
    known.record("acme/shop", moved);
    known.choose("acme/shop", moved);
    const left = await known.candidates("acme/shop", async (path) => path !== moved);
    expect(left).toEqual({ paths: [kept] });
  });
});

describe("finding the pull request's repository among the open folders", () => {
  it("matches a GitHub remote by owner and name, over https or ssh", () => {
    const remotes = [
      "origin\tgit@github.com:Acme/Shop.git (fetch)",
      "fork\thttps://github.com/ada/shop (fetch)",
    ].join("\n");
    expect(remoteFor(remotes, "acme", "shop")).toBe("origin");
    expect(remoteFor(remotes, "ada", "shop")).toBe("fork");
    expect(remoteFor(remotes, "acme", "other")).toBeUndefined();
  });

  it("only pairs with a browser extension's own origin and a real token", () => {
    expect(pairingFrom(`token=${TOKEN}&from=${encodeURIComponent(ORIGIN)}`)).toEqual({ token: TOKEN, origin: ORIGIN });
    expect(pairingFrom(`token=${TOKEN}&from=${encodeURIComponent("https://example.com")}`)).toBeUndefined();
    expect(pairingFrom(`token=short&from=${encodeURIComponent(ORIGIN)}`)).toBeUndefined();
  });
});
