import { describe, expect, it } from "vitest";

import { fitWhole } from "../src/app/canvas/fit.js";

const limits = { min: 0.05, max: 4 };

describe("a tour diagram framed in the free part of the screen", () => {
  it("fills the free space, centred in it, not the whole window", () => {
    const free = { left: 300, top: 60, right: 1500, bottom: 700 };
    const to = fitWhole({ x: 1000, y: 400, width: 920, height: 580 }, free, 40, limits);
    expect(to.scale).toBeCloseTo(Math.min(1120 / 920, 560 / 580));
    const left = to.x + 1000 * to.scale;
    const top = to.y + 400 * to.scale;
    expect(left + (920 * to.scale) / 2).toBeCloseTo(900);
    expect(top + (580 * to.scale) / 2).toBeCloseTo(380);
    expect(left).toBeGreaterThanOrEqual(free.left + 40 - 0.001);
    expect(top).toBeGreaterThanOrEqual(free.top + 40 - 0.001);
    expect(top + 580 * to.scale).toBeLessThanOrEqual(free.bottom - 40 + 0.001);
  });

  it("stays within the zoom limits", () => {
    const free = { left: 0, top: 0, right: 1000, bottom: 800 };
    expect(fitWhole({ x: 0, y: 0, width: 10, height: 10 }, free, 40, limits).scale).toBe(4);
    expect(fitWhole({ x: 0, y: 0, width: 1e7, height: 1e7 }, free, 40, limits).scale).toBe(0.05);
  });
});
