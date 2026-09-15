import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { cardUnderCentre } from "../src/app/hud/here.js";

const card = (id: string, y: number, height = 100) => ({
  id,
  x: 0,
  y,
  width: 200,
  height,
});

/**
 * Where the reader is, which the map and the file list both mark.
 *
 * This was a handful of lines inside the page component for as long as one
 * thing read it. It is a module of its own now because two things do, and two
 * derivations of "which card is the reader on" drift — in front of a reader who
 * can see the map in the corner and the list down the side at the same time, and
 * who has no way to tell which of them is lying.
 */
describe("the card under the middle of the view", () => {
  it("answers the card the middle falls in, not the first one on screen", () => {
    /*
     * The failure this prevents is the cheapest possible reading of "where am
     * I": the first card in the list, or the first one that happens to be
     * drawn. On a change laid out in a column that is almost always the card
     * above the one being read, so the mark sits one file behind the reader for
     * the whole review.
     */
    const seen = { left: 0, top: 200, width: 200, height: 200 };
    // The middle is (100, 300), which is in the second card.
    const on = cardUnderCentre(seen, 0, [card("a", 0), card("b", 250)]);
    expect(on?.id).toBe("b");
  });

  it("takes the bar across the top off before it looks for the middle", () => {
    /*
     * The chrome is laid over the first eighty-odd pixels of the viewport, so
     * the geometric centre of the window sits above the centre of what the
     * reader can actually see — by half the bar's height. The card marked "you
     * are here" was consistently the one over their eye line rather than the one
     * they were reading, and on a column of short cards that is a different file
     * rather than a different part of the same one.
     */
    const seen = { left: 0, top: 0, width: 200, height: 200 };
    const cards = [card("above", 0, 100), card("below", 100, 100)];

    // Untouched, the middle is at y=100 and lands on the first card.
    expect(cardUnderCentre(seen, 0, cards)?.id).toBe("above");
    // With eighty pixels of bar over the top, the middle of what can be seen is
    // at 80 + 60 = 140, which is the card the reader is actually looking at.
    expect(cardUnderCentre(seen, 80, cards)?.id).toBe("below");
  });

  it("answers nothing when the middle falls in the gap between cards", () => {
    /*
     * Guessing at the nearest card instead makes the mark jump between two files
     * as the reader crosses the open canvas between them — an answer that moves
     * while the thing it describes has not, which is how a reader learns to stop
     * believing a mark.
     */
    const seen = { left: 0, top: 0, width: 200, height: 200 };
    const cards = [card("a", 0, 50), card("b", 150, 50)];
    expect(cardUnderCentre(seen, 0, cards)).toBeUndefined();
  });

  it("answers nothing before a window has been measured", () => {
    /*
     * The server has no viewport and the first frame of a page has not measured
     * one, and both report nought by nought. A middle worked out from that is
     * the origin of the drawing, which quietly marks whichever card happens to
     * sit in the top left corner — a mark nobody asked for, on a page nobody is
     * steering yet.
     */
    const nothing = { left: 0, top: 0, width: 0, height: 0 };
    expect(cardUnderCentre(nothing, 0, [card("a", 0)])).toBeUndefined();
  });

  it("holds the bar inside the window it is standing on", () => {
    /*
     * A bar taller than the viewport is not a state the page can rest in, but a
     * measurement taken while the chrome is reflowing can say so for a frame —
     * and a middle worked out from it lands below the bottom of the window, on
     * whatever card happens to be down there.
     */
    const seen = { left: 0, top: 0, width: 200, height: 200 };
    const cards = [card("a", 0, 200), card("b", 200, 200)];
    // Clamped to the window, the middle is its own bottom edge, which is still
    // the card the window is over.
    expect(cardUnderCentre(seen, 9000, cards)?.id).toBe("a");
    // And a negative measurement is not allowed to lift it out of the top.
    expect(cardUnderCentre(seen, -9000, cards)?.id).toBe("a");
  });
});

/**
 * That the one answer is the one both marks are drawn from.
 *
 * A source check is a weak test in general and the right one here: what is being
 * pinned is that the page does not grow a second piece of this arithmetic beside
 * the first, and a thing that is absent cannot be driven.
 */
describe("one answer, drawn in two places", () => {
  const app = readFileSync(
    new URL("../src/app/App.svelte", import.meta.url),
    "utf8",
  );

  it("works out where the reader is once and sends the same answer both ways", () => {
    // The map takes it as a prop and the file list is told over the bridge, and
    // both read `centred`, which is the module's answer and nothing else.
    expect(app).toContain("cardUnderCentre(onScreen,");
    expect(app).toContain("here={centred}");
    expect(app).toMatch(/node\.id === centred/);
    expect(app).toContain('notify("here", { path: herePath })');
  });
});
