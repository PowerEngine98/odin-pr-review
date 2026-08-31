import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const measured = readFileSync(
  new URL("../src/app/canvas/measured.svelte.ts", import.meta.url),
  "utf8",
);

/**
 * A round of measurements, published once.
 *
 * Every card measures itself and the placement reads all of the measurements,
 * so a card writing its own height wakes the placement, which places every
 * card, which measures every card again. On a change of a hundred and
 * ninety-nine files that is n² — and measured in a browser it was a single
 * thirty-one-second task at boot, which is precisely the window that stops
 * answering.
 *
 * Collected and published together it is n: the same numbers, one invalidation.
 * The browser measurement after the change was four seconds, and the profile
 * went from a third of its time in reactivity bookkeeping to eighty-five per
 * cent idle.
 */
describe("publishing what the cards measured", () => {
  it("gathers a round rather than writing each one straight in", () => {
    expect(measured).toMatch(/let waiting: Record<string, number> \| null = null/);
    expect(measured).toMatch(/\(waiting \?\?= \{\}\)\[id\] = height/);
  });

  it("asks nothing of the state it is about to write", () => {
    /*
     * The check for "this has not changed" is against an unreactive copy.
     * Reading the reactive one inside the effect that writes it is the
     * dependency this module exists to avoid — an effect that depends on its
     * own answer never settles.
     */
    expect(measured).toMatch(/const known: Record<string, number> = \{\}/);
    expect(measured).toMatch(/if \(known\[id\] === height\) return/);
  });

  it("publishes on the beat the measurements arrive on", () => {
    // They are taken after the browser has drawn, so gathering them until it is
    // about to draw again collects the whole round.
    expect(measured).toMatch(/requestAnimationFrame/);
    // And somewhere with no frames — a page rendered to a string, a test — the
    // same promise a beat later.
    expect(measured).toMatch(/setTimeout\(publish, 0\)/);
  });

  it("wakes only the cards whose height actually changed", () => {
    // Each card is its own piece of state; assigning the batch wholesale would
    // wake every card for one card's answer.
    expect(measured).toMatch(/for \(const id of Object\.keys\(batch\)\) heights\[id\] = batch\[id\]!/);
  });

  it("schedules one publication, not one per card", () => {
    expect(measured).toMatch(/if \(!publishing\) \{[\s\S]{0,80}?publishing = 1/);
  });
});
