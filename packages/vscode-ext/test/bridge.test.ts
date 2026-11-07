import { afterEach, describe, expect, it } from "vitest";

import { listen, NotHere, type BridgeBackend } from "../src/bridge-server.js";
import { pairingFrom, remoteFor } from "../src/bridge.js";

const TOKEN = "a".repeat(48);
const ORIGIN = `chrome-extension://${"b".repeat(32)}`;

const backend: BridgeBackend = {
  version: "1.2.3",
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
