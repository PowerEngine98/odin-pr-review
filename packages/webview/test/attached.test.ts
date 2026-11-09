import { describe, expect, it } from "vitest";

import { placeOf, withFrame } from "../src/app/tour/attached.js";

const attached = {
  topic: 2,
  topicTitle: "One total",
  frame: 5,
  say: "Order computes its total once.",
  file: "src/orders/Order.kt",
  code: "fun total(): Money =",
  side: "head" as const,
  start: 12,
  end: 14,
};

describe("a frame attached to a message", () => {
  it("names its file and lines for the chip", () => {
    expect(placeOf(attached)).toBe("Order.kt:12-14");
    expect(placeOf({ ...attached, start: undefined, end: undefined })).toBe("Order.kt");
  });

  it("carries the moment, the claim and the code to the agent", () => {
    const body = withFrame("Is this right?", attached);
    expect(body.startsWith("Is this right?")).toBe(true);
    expect(body).toContain('topic 3 "One total", frame 5');
    expect(body).toContain("> Order computes its total once.");
    expect(body).toContain("`src/orders/Order.kt` lines 12-14");
    expect(body).toContain("fun total(): Money =");
  });
});
