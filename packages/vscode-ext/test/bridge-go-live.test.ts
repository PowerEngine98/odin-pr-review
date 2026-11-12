import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BrowserBridge } from "../src/bridge.js";

type Mirror = { html(html: string): void; message(message: unknown): void };

function reading(name: string, live: boolean) {
  const mirrors = new Set<Mirror>();
  const received: unknown[] = [];
  return {
    name,
    received,
    mirrors,
    changeGraph: { meta: { worktree: live, headRef: live ? "feat/x" : "origin/feat/x", pullRequest: { number: 7 } } },
    attach(mirror: Mirror) {
      mirror.html(`<p>${name}</p>`);
      mirrors.add(mirror);
      return () => mirrors.delete(mirror);
    },
    receive(message: unknown) {
      received.push(message);
    },
  };
}

function bridgeWith(goLive?: (repo: string, number: number) => Promise<unknown>) {
  const context = { globalStorageUri: { fsPath: mkdtempSync(join(tmpdir(), "odin-bridge-")) }, extensionUri: { fsPath: "/nowhere" } };
  const committed = reading("committed", false);
  const bridge = new BrowserBridge(context as never, async () => committed as never, goLive as never);
  (bridge as unknown as { where: () => Promise<{ path: string }> }).where = async () => ({ path: "/repo" });
  const sent: Record<string, unknown>[] = [];
  const sink = { send: (event: Record<string, unknown>) => sent.push(event) };
  const open = () =>
    (bridge as unknown as {
      session(o: string, r: string, n: number, b: string, s: unknown): Promise<{ deliver(m: unknown): void; close(): void }>;
    }).session("o", "r", 7, "main", sink);
  return { committed, sent, open };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("going live from the browser", () => {
  it("moves the session onto the live reading VS Code opened, in place", async () => {
    const live = reading("live", true);
    let asked: unknown[] = [];
    const { committed, sent, open } = bridgeWith(async (repo, number) => {
      asked = [repo, number];
      return live;
    });
    const session = await open();
    sent.length = 0;
    session.deliver({ odinGoLive: true });
    await settle();
    expect(asked).toEqual(["/repo", 7]);
    expect(sent.map((one) => one.type)).toEqual(["graph", "reading", "html"]);
    expect(sent[1]).toMatchObject({ live: true, branch: "feat/x" });
    expect(sent[2]).toMatchObject({ html: "<p>live</p>" });
    expect(committed.mirrors.size).toBe(0);
    session.deliver({ type: "ping" });
    expect(live.received).toEqual([{ type: "ping" }]);
    expect(committed.received).toEqual([]);
  });

  it("tells the browser why, when VS Code could not go live, and stays where it was", async () => {
    const { committed, sent, open } = bridgeWith(async () => {
      throw new Error("/repo has uncommitted changes.");
    });
    const session = await open();
    sent.length = 0;
    session.deliver({ odinGoLive: true });
    await settle();
    expect(sent).toEqual([{ type: "goLiveFailed", message: "VS Code could not go live: /repo has uncommitted changes." }]);
    expect(committed.mirrors.size).toBe(1);
  });

  it("never claims to have gone live without a way to", async () => {
    const { sent, open } = bridgeWith(undefined);
    const session = await open();
    sent.length = 0;
    session.deliver({ odinGoLive: true });
    await settle();
    expect(sent.map((one) => one.type)).toEqual(["goLiveFailed"]);
  });
});

describe("where VS Code goes live for the browser", () => {
  it("reads the checkout that already holds the branch, instead of refusing it", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(join(__dirname, "../src/extension.ts"), "utf8");
    const body = source.slice(source.indexOf("async function liveForBrowser("), source.indexOf("async function presentForBrowser("));
    expect(body).toMatch(/const elsewhere = await worktreeFor\(branch, \{ cwd: repo \}\);\s*if \(elsewhere && elsewhere !== repo\) \{\s*at = elsewhere;/);
    expect(body).toMatch(/if \(dirty\) \{\s*throw new Error/);
    expect(body).toMatch(/await review\(pull\.baseRef, undefined, true, at, number, going\);/);
    expect(source).toMatch(/const open = liveReadingOf\(repo, number\) \?\? GraphPanel\.find\(repo, number\);/);
  });
});
