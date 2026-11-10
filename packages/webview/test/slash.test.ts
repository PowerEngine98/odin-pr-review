import { describe, expect, it } from "vitest";

import { isCommand, suggestions, typingCommand } from "../src/app/hud/slash.js";

describe("a slash command typed into an agent's console", () => {
  it("is being typed while the box holds a slash and one word", () => {
    expect(typingCommand("/")).toBe("");
    expect(typingCommand("/res")).toBe("res");
    expect(typingCommand("/resume now")).toBeUndefined();
    expect(typingCommand("why /resume")).toBeUndefined();
  });

  it("is suggested from the tool's own list, names that begin with it first", () => {
    const all = ["clear", "compact", "config", "context", "mcp", "code-review", "design:code-check"];
    expect(suggestions(all, "co")).toEqual(["compact", "config", "context", "code-review", "design:code-check"]);
    expect(suggestions(all, "")).toEqual(all);
    expect(suggestions(all, "zzz")).toEqual([]);
  });

  it("is a command whether or not the tool listed it, so nothing is special-cased", () => {
    expect(isCommand("/resume")).toBe(true);
    expect(isCommand("  /mcp  ")).toBe(true);
    expect(isCommand("/")).toBe(false);
    expect(isCommand("look at /usr/bin")).toBe(false);
  });
});
