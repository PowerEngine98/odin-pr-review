import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const views = readFileSync(join(__dirname, "../src/sidebar-views.ts"), "utf8");
const file = readFileSync(join(__dirname, "../src/app/sidebar/File.svelte"), "utf8");

describe("a test file in the sidebar", () => {
  it("is marked as one, by the same rule the graph uses to tell tests apart", () => {
    expect(views).toMatch(/\.\.\.\(\(node\.isTest \?\? isTestPath\(node\.path\)\) \? \{ test: true \} : \{\}\),/);
  });

  it("wears a faint wash of the added green, under the hover and the reader's place", () => {
    expect(file).toMatch(/class:test=\{file\.test\}/);
    expect(file).toMatch(/\.row\.test \{\s*background: color-mix\(in srgb, var\(--added\) 7%, transparent\);\s*\}\s*\.row:hover \{/);
  });
});
