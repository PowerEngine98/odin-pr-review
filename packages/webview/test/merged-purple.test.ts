import { describe, expect, it } from "vitest";

import { DARK_THEME } from "@odin/core";

import { sidebarTokens, tokens } from "../src/tokens.js";

describe("a merged pull request", () => {
  it("is purple in the graph as well as in the sidebar, since the sidebar's rows are drawn in both", () => {
    const metrics = { width: 600, height: 400, rowGap: 0, charWidth: 7, gutter: 40, lineHeight: 16, headerHeight: 28 } as unknown as Parameters<typeof tokens>[1];
    expect(tokens(DARK_THEME, metrics)).toMatch(/--merged: #a371f7;/);
    expect(sidebarTokens(DARK_THEME)).toMatch(/--merged: #a371f7;/);
  });
});
