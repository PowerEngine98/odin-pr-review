import { describe, expect, it } from "vitest";

import type { Tour } from "@odin/core/tour/tour.js";

import { outline, reflectPrompt } from "../src/app/tour/reflect.js";

const tour: Tour = {
  version: 1,
  title: "Orders total once",
  topics: [
    {
      id: "total",
      title: "One total",
      summary: "The order total is computed in one place.",
      frames: [
        { kind: "title", say: "One total" },
        { kind: "focus", file: "src/Order.kt", code: "fun total()", say: "Order computes its total." },
        {
          kind: "arrow",
          from: { file: "src/Cart.kt", code: "order.total()" },
          to: { file: "src/Order.kt" },
          also: [{ from: { file: "src/Invoice.kt", code: "order.total()" }, to: { file: "src/Order.kt" } }],
          say: "Cart and invoice both ask it.",
        },
        { kind: "pause", seconds: 2 },
      ],
    },
  ],
};

describe("reflecting on a tour", () => {
  it("lists what each frame says and where, without the title frame or silent ones", () => {
    expect(outline(tour)).toBe(
      [
        "1. One total — The order total is computed in one place.",
        "   1. [Order.kt] Order computes its total.",
        "   2. [Cart.kt → Order.kt, Invoice.kt → Order.kt] Cart and invoice both ask it.",
      ].join("\n"),
    );
  });

  it("asks for a plan and forbids editing until approved", () => {
    const prompt = reflectPrompt(tour);
    expect(prompt).toContain("tour_read");
    expect(prompt).toContain("not a fact");
    expect(prompt).toContain("Wait for my explicit go-ahead");
    expect(prompt).toContain(outline(tour));
  });
});
