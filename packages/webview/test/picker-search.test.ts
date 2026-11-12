import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const picker = readFileSync(join(__dirname, "../src/app/sidebar/Picker.svelte"), "utf8");

describe("the pull request box in a repository with thousands of them", () => {
  it("filters what has arrived at once, then asks the forge after a pause", () => {
    expect(picker).toMatch(/oninput=\{\(event\) => find\(/);
    expect(picker).toMatch(/searching = setTimeout\(\(\) => \{\s*if \(\(picker\.asked\.search \?\? ""\) !== needle\) ask\(\{ search: needle \}\);\s*\}, 600\);/);
  });

  it("shows the forge's answer to the words as it is, rather than filtering it again", () => {
    expect(picker).toMatch(/\(picker\.asked\.search \?\? ""\) === needle \|\|/);
  });
});
