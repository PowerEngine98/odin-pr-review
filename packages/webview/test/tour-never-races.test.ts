import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const voices = readFileSync(join(__dirname, "../src/app/hud/voices.ts"), "utf8");
const utter = voices.slice(voices.indexOf("export function utter("), voices.indexOf("export function silence("));

describe("a voice that gives up on a sentence at once", () => {
  it("is not taken for having read it: the narrator waits out the time it would take, moving the word along", () => {
    expect(utter).toMatch(/const left = leftToSay\(text, began, performance\.now\(\)\);/);
    expect(utter).toMatch(/follow\(text, onWord, text\.length \/ \(left \/ 1000\)\);/);
    expect(utter).toMatch(/setTimeout\(\(\) => \{\s*stopFollowing\(\);\s*if \(mine === turn\) finished\(\);\s*\}, left\)/);
  });

  it("counts a sentence as over once, even when the voice reports both an error and an end", () => {
    expect(utter).toMatch(/if \(settled \|\| mine !== turn\) return;\s*settled = true;/);
  });

  it("goes through the same guard for every voice", () => {
    expect(utter).toMatch(/if \(!kokoro\(\)\) \{\s*fallBack\(text, onWord, done\);/);
    expect(utter).toMatch(/if \(buffer\) play\(buffer, text, onWord, done\);\s*else fallBack\(text, onWord, done\);/);
  });

  it("drops the wait when the reader seeks or pauses", () => {
    expect(voices).toMatch(/export function silence\(\): void \{[\s\S]*stopFollowing\(\);/);
  });
});
