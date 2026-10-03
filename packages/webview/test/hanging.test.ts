import { describe, expect, it } from "vitest";

import { hang, HANG_EDGE, HANG_GAP, type Edges } from "../src/app/panels/hanging.js";

const WIN = { width: 1200, height: 800, chromeBottom: 60 };

function edges(left: number, top: number, width: number, height: number): Edges {
  return { left, top, right: left + width, bottom: top + height };
}

/** A card on screen with a row picked a third of the way down it. */
function onScreen() {
  return {
    pane: edges(300, 100, 600, 500),
    card: edges(300, 100, 600, 500),
    row: edges(300, 240, 600, 18),
    width: 520,
    height: 200,
  };
}

describe("where the box that writes a remark hangs", () => {
  it("sits at the pane's left edge, under the row, when both are in view", () => {
    const at = hang(onScreen(), WIN);
    expect(at.left).toBe(300);
    expect(at.top).toBe(258 + HANG_GAP);
  });

  it("begins at the pane the remark is about on a split card", () => {
    // The right-hand side is the head. A box hung off the card's own left edge
    // would begin under the other pane, pointing at the code it is not about.
    const what = { ...onScreen(), pane: edges(600, 100, 300, 500) };
    expect(hang(what, WIN).left).toBe(600);
  });

  it("comes in off the window's edge when the card has gone off the left", () => {
    /*
     * The complaint this was written for: panning left took the card's edge
     * past the window, and the box went with it — half the text area and the
     * whole of its close button off the side of the screen.
     */
    const what = { ...onScreen(), pane: edges(-420, 100, 600, 500) };
    expect(hang(what, WIN).left).toBe(HANG_EDGE);
  });

  it("goes off the screen with a card that has left it entirely", () => {
    /*
     * The honest end of the trade, and the same one the card's title makes: a
     * box over code nobody can see is pointing at nothing, and a box held at
     * the window's edge while its card is elsewhere is the crawl this is
     * written to avoid.
     */
    const gone = edges(-2000, 100, 600, 500);
    const what = { ...onScreen(), pane: gone, card: gone };
    expect(hang(what, WIN).left).toBe(-2000);
  });

  it("holds on while any part of the card is still in view", () => {
    // One column of code left on screen is still code the reader is reading.
    const sliver = edges(-900, 100, 950, 500);
    const what = { ...onScreen(), pane: sliver, card: sliver };
    expect(hang(what, WIN).left).toBe(HANG_EDGE);
  });

  it("comes back off the right edge when the card is wider than the window", () => {
    const what = { ...onScreen(), pane: edges(900, 100, 1400, 500) };
    expect(hang(what, WIN).left).toBe(WIN.width - 520 - HANG_EDGE);
  });

  it("stops below the bar when the row has gone up behind it", () => {
    /*
     * The same thing the card's own title does, which is what makes the two
     * read as one behaviour rather than two: the name pins under the bar, and
     * the box about a line in that file pins under it too.
     */
    const what = {
      ...onScreen(),
      card: edges(300, -400, 600, 500),
      row: edges(300, -260, 600, 18),
    };
    expect(hang(what, WIN).top).toBe(WIN.chromeBottom + HANG_GAP);
  });

  it("rises off the bottom edge rather than hanging past it", () => {
    const what = {
      ...onScreen(),
      card: edges(300, 100, 600, 660),
      row: edges(300, 700, 600, 18),
    };
    expect(hang(what, WIN).top).toBe(WIN.height - 200 - HANG_EDGE);
  });

  it("still sits just below a card whose last line was the one picked", () => {
    // Nothing pulls it back up while there is room: the box belongs under the
    // row, and over its own last line is the one place it must not be.
    const what = {
      ...onScreen(),
      card: edges(300, 100, 600, 300),
      row: edges(300, 382, 600, 18),
    };
    expect(hang(what, WIN).top).toBe(400 + HANG_GAP);
  });

  it("goes up with a card that has scrolled past the top of the window", () => {
    const what = {
      ...onScreen(),
      card: edges(300, -900, 600, 500),
      row: edges(300, -500, 600, 18),
    };
    expect(hang(what, WIN).top).toBe(-482 + HANG_GAP);
  });

  it("keeps the box under the bar when the card has only gone off the side", () => {
    // The two directions are asked separately. A card panned off to the right
    // used to take the box's vertical placement with it for no reason at all.
    const aside = edges(1400, -400, 600, 500);
    const what = { ...onScreen(), pane: aside, card: aside, row: edges(1400, -260, 600, 18) };
    expect(hang(what, WIN).top).toBe(WIN.chromeBottom + HANG_GAP);
  });

  it("puts it against the near edge when there is no room for it at all", () => {
    // A window narrower and shorter than the box inverts both bands. Read
    // naively that places the box off the top-left of the screen, which is the
    // one answer worse than not fitting.
    const tight = { width: 300, height: 150, chromeBottom: 60 };
    const near = edges(0, 100, 600, 500);
    const at = hang({ ...onScreen(), pane: near, card: near }, tight);
    expect(at.left).toBe(HANG_EDGE);
    expect(at.top).toBe(tight.chromeBottom + HANG_GAP);
  });

  it("is loose about the bottom before the box has been measured", () => {
    // Height is zero on the frame the box first renders. A clamp taken against
    // that is a clamp against a box of no height, which is a loose bound rather
    // than a wrong one — and the next frame has the real number.
    const at = hang({ ...onScreen(), height: 0 }, WIN);
    expect(at.top).toBe(258 + HANG_GAP);
  });
});
