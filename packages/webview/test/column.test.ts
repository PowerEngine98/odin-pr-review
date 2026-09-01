import { describe, expect, it } from "vitest";

import { shareOut } from "../src/app/hud/column.js";

/**
 * A column of agent consoles, divided.
 *
 * Two agents at once is the ordinary case — one reading, one writing — and what
 * they share is whatever the panels above have left. Divided badly it is a log
 * with a paragraph in it and a log with eleven pixels: the second agent
 * present, unreadable, and easy to mistake for a rendering fault. That is not
 * hypothetical; it is what the first version of this did, and it did it because
 * it counted how many would fit without ever saying how tall each could be.
 */
const SIZES = { least: 160, bar: 38, between: 8 };

describe("dividing the console column", () => {
  it("gives one console the room", () => {
    expect(shareOut(600, 1, SIZES)).toEqual({ showing: 1, each: 600 });
  });

  it("splits a tall column between two", () => {
    const { showing, each } = shareOut(700, 2, SIZES);
    expect(showing).toBe(2);
    expect(each).toBe(346);
    // And the two of them, with the gap, fit in what there was.
    expect(each * 2 + SIZES.between).toBeLessThanOrEqual(700);
  });

  it("folds the second rather than leaving it a sliver", () => {
    /*
     * The fault. Room for one readable log and a bar, so that is what it shows
     * — not two logs, one of which is eleven pixels at the bottom edge.
     */
    const { showing, each } = shareOut(260, 2, SIZES);
    expect(showing).toBe(1);
    expect(each).toBeGreaterThanOrEqual(SIZES.least);
  });

  it("keeps one open however short the window", () => {
    // A column of nothing but bars is a page with no log on it, which is not
    // what anybody opened.
    expect(shareOut(40, 3, SIZES).showing).toBe(1);
  });

  it("never says a height nobody could read", () => {
    const { each } = shareOut(40, 3, SIZES);
    expect(each).toBeGreaterThanOrEqual(SIZES.least);
  });

  it("folds as many as it has to and no more", () => {
    // Room for two readable logs and one bar.
    const { showing } = shareOut(400, 3, SIZES);
    expect(showing).toBe(2);
  });

  it("counts the bars the folded ones take", () => {
    // The folded ones are not free: their bars come out of the room before the
    // open ones divide what is left, or the column overflows by exactly the
    // height of the bars.
    const three = shareOut(700, 3, SIZES);
    const two = shareOut(700, 2, SIZES);
    if (three.showing === two.showing) {
      expect(three.each).toBeLessThan(two.each);
    }
    expect(
      three.each * three.showing +
        (3 - three.showing) * SIZES.bar +
        2 * SIZES.between,
    ).toBeLessThanOrEqual(700 + SIZES.least);
  });

  it("says nothing about a column with nothing in it", () => {
    expect(shareOut(600, 0, SIZES)).toEqual({ showing: 0, each: 0 });
  });
});
