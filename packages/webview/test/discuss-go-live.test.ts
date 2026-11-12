import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const panel = readFileSync(join(__dirname, "../src/app/tour/panel.svelte.ts"), "utf8");
const dialog = readFileSync(join(__dirname, "../src/app/tour/GoLiveDiscuss.svelte"), "utf8");
const app = readFileSync(join(__dirname, "../src/app/App.svelte"), "utf8");

describe("Discuss on a reading of the change as committed", () => {
  it("asks to go live first instead of opening a console that cannot run", () => {
    expect(panel).toMatch(/if \(model\.current\.meta\.worktree !== true\) \{\s*tourPanel\.goLiveFor = attached;/);
    expect(panel).toMatch(/notify\("goLiveDiscuss", \{ attached: \$state\.snapshot\(tourPanel\.goLiveFor\) \}\)/);
    expect(app).toMatch(/<GoLiveDiscuss \/>/);
  });

  it("lets the reader decline, and says why when VS Code could not go live", () => {
    expect(dialog).toMatch(/onclick=\{stayCommitted\}>Not now</);
    expect(dialog).toMatch(/\{#if tourPanel\.liveFailed\}/);
    expect(panel).toMatch(/message\?\.type === "goLiveFailed" && tourPanel\.goingLive/);
  });

  it("opens the discussion in the live reading once its agents are known", () => {
    expect(panel).toMatch(/message\?\.type === "discussPending" && message\.attached[\s\S]{0,80}tour\.attached = message\.attached;/);
    expect(dialog).toMatch(/if \(openDiscussion\(\)\) tourPanel\.pendingDiscuss = false;/);
  });
});
