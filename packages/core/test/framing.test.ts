import { describe, expect, it } from "vitest";

import type { Picture } from "../src/graph/pictures.js";
import { frame, PICTURE_TALLEST, PICTURE_WIDEST } from "../src/layout/framing.js";
import { DEFAULT_METRICS } from "../src/layout/metrics.js";

const M = DEFAULT_METRICS;
const chrome = M.padding * 2;

const picture = (width: number, height: number): Picture => ({
  width,
  height,
  mime: "image/png",
  textual: false,
});

/** How far from square the card's picture is, which is the whole promise. */
const ratio = (what: { drawWidth: number; drawHeight: number }) =>
  what.drawWidth / what.drawHeight;

describe("the card a picture gets", () => {
  it("keeps the picture's proportions", () => {
    for (const [w, h] of [
      [1600, 900],
      [900, 1600],
      [37, 19],
      [1, 3],
      [2048, 2048],
    ]) {
      const framed = frame(picture(w!, h!), M);
      expect(ratio(framed)).toBeCloseTo(w! / h!, 1);
    }
  });

  it("draws a small picture at its own size", () => {
    // A sixteen-pixel icon blown up to fill a card is a blurred square that has
    // stopped saying what the icon looks like.
    const framed = frame(picture(16, 16), M);
    expect(framed.drawWidth).toBe(16);
    expect(framed.drawHeight).toBe(16);
  });

  it("still gives that small picture a card of the usual width", () => {
    // Narrower than every other card, a sixteen-pixel one would not have room
    // for its own filename.
    expect(frame(picture(16, 16), M).width).toBe(M.minCardWidth);
  });

  it("scales a photograph down rather than drawing a card the size of one", () => {
    const framed = frame(picture(4032, 3024), M);
    expect(framed.drawWidth).toBeLessThanOrEqual(PICTURE_WIDEST);
    expect(framed.drawHeight).toBeLessThanOrEqual(PICTURE_TALLEST);
    expect(ratio(framed)).toBeCloseTo(4032 / 3024, 1);
  });

  it("bounds a tall picture by its height, not only its width", () => {
    // A screenshot of a whole page is a column the reader has to pan the length
    // of, and everything below it is pushed out of the drawing.
    const framed = frame(picture(800, 6000), M);
    expect(framed.drawHeight).toBeLessThanOrEqual(PICTURE_TALLEST);
    expect(ratio(framed)).toBeCloseTo(800 / 6000, 2);
  });

  it("leaves room for the title and the padding", () => {
    const framed = frame(picture(400, 200), M);
    expect(framed.height).toBe(M.titleHeight + chrome + framed.drawHeight);
    expect(framed.width).toBe(400 + chrome);
  });

  it("takes a width it is given rather than choosing one", () => {
    /*
     * An SVG showing its drawing has to be exactly as wide as the same SVG
     * showing its markup. A reader toggling between the two is asking about one
     * file, and a card that changed width would move every card around it.
     */
    const framed = frame(picture(40, 20), M, 600);
    expect(framed.width).toBe(600);
    expect(framed.drawWidth).toBe(40);
  });

  it("scales down to a width it is given when the picture is wider", () => {
    const framed = frame(picture(2000, 1000), M, 400);
    expect(framed.width).toBe(400);
    expect(framed.drawWidth).toBe(400 - chrome);
    expect(ratio(framed)).toBeCloseTo(2, 1);
  });

  it("draws something for a card with no room in it at all", () => {
    // A width narrower than its own padding. Nothing sensible is being asked
    // for, and a picture of zero or negative size is worse than a tiny one.
    const framed = frame(picture(100, 100), M, 4);
    expect(framed.drawWidth).toBeGreaterThan(0);
    expect(framed.drawHeight).toBeGreaterThan(0);
  });

  it("draws something for a picture a pixel across", () => {
    const framed = frame(picture(1, 1), M);
    expect(framed.drawWidth).toBe(1);
    expect(framed.height).toBeGreaterThan(M.titleHeight);
  });
});
