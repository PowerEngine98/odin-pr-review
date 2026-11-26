import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const row = readFileSync(join(__dirname, "../src/app/canvas/Row.svelte"), "utf8");

describe("an expanded card", () => {
  it("reads as the whole file, without the bands that stood for the lines now shown", () => {
    expect(row).toMatch(/\.row\.gap\.expandable\.revealed \{ display: none; \}/);
  });

  it("keeps a band whose lines were never sent, since there is nothing to show in its place", () => {
    expect(row).not.toMatch(/\.row\.gap\.revealed \{ display: none; \}/);
  });
});
