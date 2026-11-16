import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "../src/extension.ts"), "utf8");
const refresh = source.slice(source.indexOf("async function refreshPullRequests("), source.indexOf("const lanes = new Lanes();"));
const fill = source.slice(source.indexOf("function fillIn("), source.indexOf("const PRIORITY_MS"));
const pick = source.slice(source.indexOf("function picked<T>("), source.indexOf("const switching = new Set<number>();"));

describe("searching the pull requests of a busy repository from the side bar", () => {
  it("shows the fast answer first, then fills in decisions, faces and local branches behind it", () => {
    expect(refresh).toMatch(/listPullRequests\(\{ \.\.\.query, light: true \}\)/);
    expect(refresh).toMatch(/redraw\(\);\s*fillIn\(mine, repo, query, pulls, faces\);/);
    expect(fill).toMatch(/lanes\.clear\(\);/);
    expect(fill.match(/lanes\.later\(/g)).toHaveLength(1);
    expect(fill).toMatch(/await Promise\.all\(\[\s*localBranches\(/);
    expect(fill).toMatch(/listPullRequests\(query\)/);
    expect(fill).toMatch(/inlineAvatar\(url\)/);
    expect(fill).toMatch(/localBranches\(/);
  });

  it("drops an answer the reader has already typed past", () => {
    expect(refresh).toMatch(/const mine = \+\+asking;/);
    expect(refresh).toMatch(/if \(mine !== asking\) return;/);
    expect(fill).toMatch(/if \(mine !== asking\) return;/);
  });
});

describe("a pull request the reader clicks", () => {
  it("is read at once, its own review decision first, holding the background back for a bounded time", () => {
    expect(pick).toMatch(/const done = run\(\);/);
    expect(pick).toMatch(/void lanes\.now\(\(\) =>\s*Promise\.race\(\[/);
    expect(pick).toMatch(/setTimeout\(resolve, PRIORITY_MS\)/);
    expect(pick).toMatch(/readPullRequest\(String\(number\), \{ cwd: repo \}\)/);
    expect(pick).toMatch(/if \(row && pull\?\.reviewDecision && shown === list\)/);
    expect(source).toMatch(/sidebar\.pick = \(number, run\) => picked\(number, run\);/);
    const side = readFileSync(join(__dirname, "../src/sidebar.ts"), "utf8");
    expect(side).toMatch(/void this\.pick\(number, \(\) => Promise\.resolve\(vscode\.commands\.executeCommand\(command, number\)\)\);/);
  });

  it("knows whether its branch is local even before the background has said so", () => {
    expect(source).toMatch(/const local = await localOf\(repo, pull\.branch\);/);
    expect(source).toMatch(/if \(shown\?\.repo !== repo\) localState = new Map\(\);/);
  });
});
