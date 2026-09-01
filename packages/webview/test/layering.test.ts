import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * What covers what.
 *
 * The page has a dozen fixed panels and one axis to arrange them on, and the
 * ordering is an argument rather than a preference: a log is read while doing
 * something else, so anything deliberately opened is over it; the map and the
 * chrome are how a reader leaves where they are, so nothing covers those.
 *
 * Written down here because the failure is silent and looks like nothing. The
 * composer sat one below the console column, so a reader who opened a remark
 * beside a card on the right had the buttons that finish it — Cancel, Ask
 * agents, Start a review — drawn over by an agent talking. Nothing was broken,
 * nothing was logged; the buttons were simply behind something.
 */
function ranks(): Map<string, number> {
  // The source rather than the rendered sheet: `tokens()` wants a theme and a
  // set of measurements to answer, and none of that has any bearing on which
  // panel is over which.
  const source = readFileSync(new URL("../src/tokens.ts", import.meta.url), "utf8");
  const found = new Map<string, number>();
  for (const [, name, value] of source.matchAll(/--z-([\w-]+):\s*(\d+)/g)) {
    found.set(name!, Number(value!));
  }
  return found;
}

/** What a component's own rule asks for, fallback included. */
function asks(file: string): { token: string; fallback?: number } {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const found = source.match(/z-index:\s*var\(--z-([\w-]+)(?:,\s*(\d+))?\)/);
  if (!found) throw new Error(`no z-index in ${file}`);
  return found[2] === undefined
    ? { token: found[1]! }
    : { token: found[1]!, fallback: Number(found[2]) };
}

describe("the order the page is stacked in", () => {
  const rank = ranks();

  it("puts a remark being written over the agent logs", () => {
    // The report. `Ask agents` under the agent that would answer it.
    expect(rank.get("compose")!).toBeGreaterThan(rank.get("terminals")!);
  });

  it("keeps both under the panels a reader leaves by", () => {
    // The map, the checks, the file list: a composer that covered those would
    // trap somebody mid-sentence.
    expect(rank.get("compose")!).toBeLessThan(rank.get("hud")!);
    expect(rank.get("terminals")!).toBeLessThan(rank.get("hud")!);
  });

  it("keeps the loading cover over everything it says is not ready", () => {
    for (const name of ["compose", "terminals", "hud", "chrome", "panel", "thread"]) {
      expect(rank.get("settling")!).toBeGreaterThan(rank.get(name)!);
    }
  });

  it("gives the console column a rank of its own", () => {
    // It used to take one step below the panels, which put it above the
    // composer by arithmetic nobody had looked at since.
    const column = asks("../src/app/hud/Terminals.svelte");
    expect(column.token).toBe("terminals");
  });

  it("agrees with itself when the tokens are missing", () => {
    // A fallback is what the rule falls back to, and two rules falling back to
    // the same number are ordered by whichever happens to be written last.
    const composer = asks("../src/app/panels/Composer.svelte");
    const column = asks("../src/app/hud/Terminals.svelte");
    expect(composer.fallback).toBe(rank.get("compose"));
    expect(column.fallback).toBe(rank.get("terminals"));
    expect(composer.fallback!).toBeGreaterThan(column.fallback!);
  });
});
