import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { claimHandoff, HANDOFF_MS, handoffFor, leaveHandoff } from "../src/handoff.js";

describe("a pull request handed to the window that opens its checkout", () => {
  const folder = mkdtempSync(join(tmpdir(), "odin-handoff-"));
  const at = 1_000_000;

  it("is taken by the window open on that folder, live or not as it was asked", () => {
    expect(handoffFor({ path: folder, number: 7, live: true, at }, [folder], at + 5_000)).toEqual({
      path: folder,
      number: 7,
      live: true,
      at,
    });
    expect(handoffFor({ path: folder, number: 7, at }, ["/elsewhere", folder], at)?.live).toBe(false);
  });

  it("matches the folder however the path to it is spelled", () => {
    const link = join(mkdtempSync(join(tmpdir(), "odin-handoff-link-")), "here");
    symlinkSync(folder, link);
    expect(handoffFor({ path: `${folder}/`, number: 7, live: true, at }, [link], at)?.number).toBe(7);
  });

  it("is left alone by other windows, and goes stale", () => {
    expect(handoffFor({ path: folder, number: 7, live: true, at }, ["/elsewhere"], at)).toBeUndefined();
    expect(handoffFor({ path: folder, number: 7, live: true, at }, [folder], at + HANDOFF_MS + 1)).toBeUndefined();
    expect(handoffFor(undefined, [folder], at)).toBeUndefined();
    expect(handoffFor({ path: folder, number: "7", at }, [folder], at)).toBeUndefined();
  });
});

describe("a handoff left on disk for whichever window holds the folder", () => {
  it("is claimed once, by the window on that folder, and is gone afterwards", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-handoff-store-"));
    const folder = mkdtempSync(join(tmpdir(), "odin-handoff-there-"));
    const now = Date.now();
    leaveHandoff(dir, { path: folder, number: 463, live: true, at: now });
    expect(claimHandoff(dir, ["/somewhere/else"], now)).toBeUndefined();
    expect(claimHandoff(dir, [folder], now)).toMatchObject({ number: 463, live: true });
    expect(claimHandoff(dir, [folder], now)).toBeUndefined();
  });

  it("is nothing when none was left", () => {
    expect(claimHandoff(mkdtempSync(join(tmpdir(), "odin-handoff-none-")), ["/x"], Date.now())).toBeUndefined();
  });
});

describe("the extension", () => {
  it("leaves the handoff before opening the other folder, and takes it on starting and whenever a window comes to the front", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(join(__dirname, "../src/extension.ts"), "utf8");
    expect(source).toMatch(/leaveHandoff\(handoffs, \{ path: elsewhere, number, live: !draw[\s\S]{0,200}"vscode\.openFolder"/);
    expect(source).toMatch(/void takeHandoff\(\);\n\}/);
    expect(source).toMatch(/onDidChangeWindowState\(\(window\) => \{\s*if \(!window\.focused\) return;\s*void refreshStale\(\);\s*void takeHandoff\(\);/);
  });
});
