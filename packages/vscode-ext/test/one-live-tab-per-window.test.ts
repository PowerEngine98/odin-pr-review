import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { liveFitsHere } from "../src/liveRule.js";

const extension = readFileSync(join(__dirname, "../src/extension.ts"), "utf8");
const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
const bridge = readFileSync(join(__dirname, "../src/bridge.ts"), "utf8");

describe("where a live reading may be drawn", () => {
  it("is this window when the checkout is this window's and nothing else is live here", () => {
    expect(liveFitsHere("/work/app", "/work/app", [])).toBe(true);
    expect(liveFitsHere("/work/app", "/work/app", [{ repo: "/work/app", live: false }])).toBe(true);
  });

  it("is still this window when the live reading already here is of the same checkout", () => {
    expect(liveFitsHere("/work/app", "/work/app", [{ repo: "/work/app", live: true }])).toBe(true);
  });

  it("is another window when the checkout is another folder", () => {
    expect(liveFitsHere("/work/app", "/work/app/.worktrees/feature", [])).toBe(false);
    expect(liveFitsHere(undefined, "/work/app", [])).toBe(false);
  });

  it("is another window when a reading of another checkout is already live here", () => {
    expect(liveFitsHere("/work/app", "/work/app", [{ repo: "/work/app/.worktrees/other", live: true }])).toBe(false);
  });
});

describe("going live on a pull request read from its commits", () => {
  const goLive = extension.slice(extension.indexOf("async function goLiveOn("), extension.indexOf("async function presentForBrowser("));

  it("opens a window at the pull request's checkout instead of checking it out under a live session", () => {
    expect(goLive).toMatch(/const busy = !\(await liveBelongsHere\(repo\)\);/);
    expect(goLive).toMatch(/readableCheckout\(branch, \{ cwd: repo \}\)/);
    expect(goLive).toMatch(/await liveInNewWindow\(at, number\);\s*throw new LiveElsewhere\(at, number\);/);
  });

  it("hands the new window the reading, so it goes live there on its own", () => {
    expect(extension).toMatch(/leaveHandoff\(handoffs, \{ path: at, number, live: true, at: Date\.now\(\) \}\);\s*await vscode\.commands\.executeCommand\("vscode\.openFolder", vscode\.Uri\.file\(at\), \{ forceNewWindow: true \}\);/);
  });

  it("does the same from the side bar's Local, for a branch checked out elsewhere", () => {
    expect(extension).toMatch(/if \(await liveBelongsHere\(checkout\.path\)\) \{[\s\S]*?\} else \{\s*await liveInNewWindow\(checkout\.path, pull\.number\);/);
  });

  it("says where it went rather than calling it a failure", () => {
    expect(panel).toMatch(/error instanceof LiveElsewhere \? error\.message : `VS Code could not go live/);
    expect(bridge).toMatch(/error instanceof LiveElsewhere \|\| error instanceof Diverged \? error\.message : `VS Code could not go live/);
  });
});
