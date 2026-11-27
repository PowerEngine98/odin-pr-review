import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { movedToPull } from "../src/live-follow.js";

describe("a live reading whose checkout moves to another branch", () => {
  it("reads the pull request of the branch it moved to, against that pull request's own base", () => {
    expect(movedToPull(491, { number: 496, baseRefName: "orders-rejections" })).toEqual({ number: 496, base: "orders-rejections" });
  });

  it("stays as it is while the pull request is the same one, or when the new branch has none", () => {
    expect(movedToPull(491, { number: 491, baseRefName: "main" })).toBeUndefined();
    expect(movedToPull(491, undefined)).toBeUndefined();
  });

  it("is reopened in place of the reading it was, once", () => {
    const extension = readFileSync(join(__dirname, "../src/extension.ts"), "utf8");
    expect(extension).toMatch(/const moved = movedToPull\(armedFor, fresh\.graph\.meta\.pullRequest\);\s*if \(moved\) \{\s*if \(moving\) return;\s*moving = true;/);
    expect(extension).toMatch(/await review\(moved\.base, undefined, true, repo, moved\.number, \[key\]\);/);
  });
});
