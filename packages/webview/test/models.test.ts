import { describe, expect, it } from "vitest";

import { familyOf, grouped, shownAs } from "../src/app/hud/models.js";

describe("the model picker", () => {
  it("groups by family, aliases first", () => {
    expect(grouped(["opus", "claude-opus-5-5", "claude-haiku-5-5", "haiku", "openai/gpt-x", "openai/o-y"])).toEqual([
      { family: "Opus", models: ["opus", "claude-opus-5-5"] },
      { family: "Haiku", models: ["haiku", "claude-haiku-5-5"] },
      { family: "openai", models: ["openai/gpt-x", "openai/o-y"] },
    ]);
    expect(familyOf("something-else")).toBe("Other");
  });

  it("says which model the default and an alias land on", () => {
    expect(shownAs("", "claude-opus-5-5")).toBe("Default · claude-opus-5-5");
    expect(shownAs("sonnet", "claude-sonnet-5-5")).toBe("sonnet · claude-sonnet-5-5");
    expect(shownAs("sonnet", "claude-opus-5-5")).toBe("sonnet");
    expect(shownAs("claude-opus-5-5", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(shownAs("", undefined)).toBe("Default");
  });
});
