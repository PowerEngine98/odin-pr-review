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

describe("a file's name in the sidebar", () => {
  it("takes its status's colour, added, modified, deleted or renamed, the way the badge beside it does", () => {
    expect(file).toMatch(/\.row\.status-added\s+\{ color: var\(--status-added\); \}/);
    expect(file).toMatch(/\.name \{\s*color: currentColor;/);
  });
});

describe("a test file pointed at in the sidebar", () => {
  it("deepens its green rather than dropping to the plain hover grey", () => {
    expect(file).toMatch(/\.row\.test:hover \{\s*background: color-mix\(in srgb, var\(--added\) 14%, transparent\);\s*\}\s*\.row\.here:hover \{/);
  });
});

describe("a file named in the Changes tab", () => {
  it("wears its icon and its status's colour, as it does in the sidebar", () => {
    const ledger = readFileSync(join(__dirname, "../src/app/hud/Ledger.svelte"), "utf8");
    expect(ledger).toMatch(/class="entry-file status-\{statusOf\.get\(delta\.path\) \?\? 'none'\}"/);
    expect(ledger).toMatch(/<FileIcon path=\{delta\.path\} icons=\{settings\.fileIcons \? model\.current\.fileIcons : undefined\} \/>/);
    expect(ledger).toMatch(/\.entry-file\.status-modified \{ color: var\(--status-modified\); \}/);
  });
});

describe("the stack popup", () => {
  it("joins every pull request in it to the base with one line, ending in the base's dot", () => {
    const chip = readFileSync(join(__dirname, "../src/app/chrome/StackChip.svelte"), "utf8");
    expect(chip).toMatch(/\.stack-row::before,\s*\.stack-base::before \{[^}]*left: 4px;\s*width: 2px;/);
    expect(chip).toMatch(/\.stack-row::before \{\s*top: 0;\s*bottom: 0;\s*\}/);
    expect(chip).toMatch(/\.stack-base::before \{\s*top: 0;\s*height: 12px;\s*\}/);
    expect(chip).toMatch(/\.stack-dot \{\s*box-sizing: border-box;\s*flex: 0 0 auto;\s*width: 10px;/);
  });
});
