import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STACK_FRESH_MS } from "../src/panel.js";

const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
const chip = readFileSync(join(__dirname, "../../webview/src/app/chrome/StackChip.svelte"), "utf8");
const store = readFileSync(join(__dirname, "../../webview/src/app/chrome/stack.svelte.ts"), "utf8");

describe("the stack a pull request sits in, once a pull request in it has moved on", () => {
  it("is asked again when the pull request's own state, branch or base changes, or after a minute", () => {
    expect(STACK_FRESH_MS).toBe(60_000);
    expect(panel).toMatch(/const key = \[pull\.number, pull\.state \?\? "", pull\.headRefName, pull\.baseRefName\]\.join\(" "\);/);
    expect(panel).toMatch(/if \(key !== this\.stackKey \|\| Date\.now\(\) - this\.stackAt > STACK_FRESH_MS\) this\.stackAsked = undefined;/);
  });

  it("shows the pull request being read in the state its header shows, merged included", () => {
    expect(panel).toMatch(/if \(here && pull\.state\) here\.state = pull\.state\.toLowerCase\(\);/);
  });

  it("is asked for each time the stack is opened, not only once per page", () => {
    expect(store).not.toMatch(/if \(stack\.asked \|\| !host\) return;/);
    expect(chip).toMatch(/if \(!open\) askStack\(\);\s*open = true;/);
  });
});
