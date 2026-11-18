import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
const extension = readFileSync(join(__dirname, "../src/extension.ts"), "utf8");
const showLoading = panel.slice(panel.indexOf("static async showLoading"), panel.indexOf("private static async paint("));

describe("fetching a pull request while another reading is in front", () => {
  it("never paints the wait over a reading already drawn, so going back to it finds it drawn", () => {
    expect(showLoading).toMatch(/static async showLoading\(note: string, where\?: string, aside = false\)/);
    expect(showLoading).toMatch(/const taken =\s*\(where !== undefined \|\| aside\) &&\s*!own &&/);
  });

  it("is said in the pull request's own tab when it has one, and in a new tab when it has none", () => {
    expect(extension).toMatch(/showLoading\(`Fetching #\$\{number\}`, readingsOf\(number, false, pull\.branch\)\[0\], true\)/);
    expect(extension).toMatch(/showLoading\(`Fetching #\$\{pull\.number\}`, readingsOf\(pull\.number, false, pull\.branch\)\[0\], true\)/);
  });

  it("still takes the tab in front when the reading on it is being replaced on purpose", () => {
    expect(extension).toMatch(/showLoading\(`Checking out #\$\{number\}`\)/);
  });
});
