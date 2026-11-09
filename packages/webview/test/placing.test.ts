import { describe, expect, it } from "vitest";

import { placeBeside, type Rect } from "../src/app/tour/placing.js";

const card: Rect = { x: 0, y: 0, width: 400, height: 600 };
const size = { width: 300, height: 200 };

function clear(spot: Rect, taken: Rect[], gap: number): boolean {
  return taken.every(
    (one) =>
      spot.x >= one.x + one.width + gap ||
      one.x >= spot.x + spot.width + gap ||
      spot.y >= one.y + one.height + gap ||
      one.y >= spot.y + spot.height + gap,
  );
}

describe("room for a tour's diagram", () => {
  it("stands to the right of the card it is about when that is free", () => {
    const spot = placeBeside(card, size, [card], 40);
    expect(spot.x).toBe(440);
    expect(clear(spot, [card], 40)).toBe(true);
  });

  it("goes round the card when its sides are taken, and never onto another card", () => {
    const right: Rect = { x: 430, y: -200, width: 500, height: 1200 };
    const left: Rect = { x: -600, y: -200, width: 590, height: 1200 };
    const taken = [card, right, left];
    const spot = placeBeside(card, size, taken, 40);
    expect(clear(spot, taken, 40)).toBe(true);
  });

  it("finds room past everything when the neighbourhood is full", () => {
    const taken: Rect[] = [];
    for (let x = -3000; x <= 3000; x += 450) {
      for (let y = -3000; y <= 3000; y += 650) taken.push({ x, y, width: 420, height: 620 });
    }
    const spot = placeBeside(card, size, taken, 40);
    expect(clear(spot, taken, 40)).toBe(true);
  });
});
