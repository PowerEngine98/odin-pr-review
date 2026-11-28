import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const terminals = readFileSync(join(__dirname, "../src/app/hud/Terminals.svelte"), "utf8");

describe("a live reading, as it starts", () => {
  it("opens the console of every agent switched on, even one closed last time", () => {
    expect(terminals).toMatch(/if \(reopened \|\| !live \|\| undock\.as\) return;/);
    expect(terminals).toMatch(/const enabled = \(settings\.pairing \?\? \[\]\)\.filter\(\(id\) => found\.some\(\(agent\) => agent\.id === id\) && !held\.includes\(id\)\);/);
    expect(terminals).toMatch(/if \(enabled\.length > 0\) settings\.terminals = \[\.\.\.held, \.\.\.enabled\];/);
  });

  it("does it once, so a console closed during the session stays closed", () => {
    expect(terminals).toMatch(/let reopened = false;/);
    expect(terminals).toMatch(/if \(found\.length === 0\) return;\s*reopened = true;/);
  });
});
