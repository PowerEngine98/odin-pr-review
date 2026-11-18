import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const content = readFileSync(join(__dirname, "../src/content.ts"), "utf8");
const css = readFileSync(join(__dirname, "../static/content.css"), "utf8");

describe("a way to the graph from a pull request's files", () => {
  it("is a 'See as a graph' button beside GitHub's commit picker", () => {
    expect(content).toMatch(/document\.getElementById\("changes-selector-button"\)/);
    expect(content).toMatch(/link\.append\(icon\(\), document\.createTextNode\("See as a graph"\)\);/);
    expect(content).toMatch(/holder\.after\(link\);/);
    expect(content).toMatch(/if \(!holder \|\| holder\.parentElement\?\.querySelector\(`\[\$\{ACTION\}\]`\)\) return;/);
  });

  it("is drawn in GitHub's blue, the size of its small action buttons", () => {
    expect(css).toMatch(/\.odin-see-graph \{[\s\S]*?height: 28px;[\s\S]*?border-radius: 6px;[\s\S]*?background: var\(--bgColor-accent-emphasis, #1f6feb\);[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 500;/);
  });

  it("is a Graph choice under Layout in the diff settings, cloned from an unchecked choice", () => {
    expect(content).toMatch(/ul\[role="group"\]\[aria-label="Layout"\]/);
    expect(content).toMatch(/\[role="menuitemradio"\]\[aria-checked="false"\]/);
    expect(content).toMatch(/node\.textContent = "Graph";/);
    expect(content).toMatch(/layout\.append\(item\);/);
  });

  it("opens the graph in place, the same way the Graph tab does", () => {
    expect(content).toMatch(/function opensGraph\(link: HTMLAnchorElement\): void \{[\s\S]*?history\.pushState\(history\.state, "", link\.href\);[\s\S]*?open\(\);/);
    expect(content).toMatch(/function goToGraph\(href: string\): void \{[\s\S]*?history\.pushState\(history\.state, "", href\);[\s\S]*?open\(\);/);
    expect(content).toMatch(/addSeeAsGraph\(place\);\s*addGraphLayout\(place\);/);
  });
});
