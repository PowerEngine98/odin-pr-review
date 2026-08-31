import { describe, expect, it } from "vitest";

import { PHASES, Progress, type Told } from "../src/progress.js";

/** Everything a build said about itself. */
function watched(): { told: Told[]; step: Progress } {
  const told: Told[] = [];
  return { told, step: new Progress((one) => told.push(one)) };
}

/**
 * How far through a build is, as one number.
 *
 * Every phase used to report in its own words and only one of them could say
 * how far along it was, so a large change showed a note that sat still for six
 * seconds, then a percentage that ran to a hundred, then another note that sat
 * still for three — none of which a reader can tell from the thing having
 * stopped.
 */
describe("saying how far through a build is", () => {
  it("adds up to the whole of it", () => {
    // Or the bar stops short of the end, or runs out before the work does.
    expect(PHASES.reduce((sum, phase) => sum + phase.weight, 0)).toBe(100);
  });

  it("only ever moves forwards", () => {
    const { told, step } = watched();
    for (const phase of PHASES) {
      step.begins(phase.key);
      step.within(1, 4);
      step.within(3, 4);
    }
    step.done();

    const percents = told.map((one) => one.percent);
    for (let at = 1; at < percents.length; at++) {
      expect(percents[at]!).toBeGreaterThanOrEqual(percents[at - 1]!);
    }
  });

  it("counts a phase within its own share, not the whole bar", () => {
    /*
     * Resolving is half the wait, so halfway through resolving is a quarter of
     * the way through the build plus whatever came before it — not half.
     */
    const { told, step } = watched();
    step.begins("resolve");
    const start = told.at(-1)!.percent;
    step.within(1, 2);
    const half = told.at(-1)!.percent;

    const weight = PHASES.find((p) => p.key === "resolve")!.weight;
    expect(half - start).toBeGreaterThanOrEqual(weight / 2 - 1);
    expect(half - start).toBeLessThanOrEqual(weight / 2 + 1);
  });

  it("says a phase is starting even when that phase cannot count", () => {
    // "This is happening" and "that much of it is done" are different claims,
    // and a phase with nothing to count should still make the first.
    const { told, step } = watched();
    step.begins("context");
    expect(told).toHaveLength(1);
    expect(told[0]!.note).toContain("Reading the code around it");
    expect(told[0]!.percent).toBeGreaterThan(0);
  });

  it("does not reach a hundred until the picture is there", () => {
    /*
     * A bar that sits full while the reader waits is worse than one that sits
     * at ninety-nine: the first says the tool is broken, the second says it is
     * nearly done.
     */
    const { told, step } = watched();
    step.begins("draw");
    step.within(1, 1);
    expect(Math.max(...told.map((one) => one.percent))).toBe(99);

    step.done();
    expect(told.at(-1)!.percent).toBe(100);
  });

  it("speaks only when the number changes", () => {
    // A change of any size is tens of thousands of lines, and a message per
    // line is a channel full of arithmetic nobody can read.
    const { told, step } = watched();
    step.begins("resolve");
    const after = told.length;
    for (let line = 0; line < 500; line++) step.within(line, 100_000);
    expect(told.length - after).toBeLessThan(3);
  });

  it("carries a detail when a phase has one", () => {
    const { told, step } = watched();
    step.begins("resolve", "1 of 3 checkouts");
    expect(told.at(-1)!.note).toContain("1 of 3 checkouts");
  });

  it("ignores a phase nobody declared", () => {
    const { told, step } = watched();
    step.begins("nothing-like-this" as never);
    expect(told).toHaveLength(0);
  });
});
