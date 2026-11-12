import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const voices = readFileSync(join(__dirname, "../src/app/hud/voices.ts"), "utf8");
const controls = readFileSync(join(__dirname, "../src/app/tour/Controls.svelte"), "utf8");

describe("Kokoro's audio on a page nobody has clicked yet", () => {
  it("is started inside the reader's first click or key, made then if it did not exist yet", () => {
    expect(voices).toMatch(/const wake = \(\) => \{\s*if \(!kokoro\(\)\) return;\s*void audioContext\(\)\.resume\(\);/);
    expect(voices).toMatch(/window\.addEventListener\("pointerdown", wake, \{ capture: true \}\)/);
    expect(voices).toMatch(/\nif \(typeof window !== "undefined" && typeof window\.addEventListener === "function"\) wakeOnTouch\(\);\n$/);
    expect(voices.match(/new AudioContext\(\)/g)).toHaveLength(1);
  });

  it("says so when it could not play, and clears that once it runs", () => {
    expect(voices).toMatch(/voiceStatus\.blocked = true;\s*fallBack\(text, onWord, done\);/);
    expect(voices).toMatch(/made\.onstatechange = \(\) => \{\s*if \(made\.state === "running"\) voiceStatus\.blocked = false;/);
  });

  it("says when the first sentence is slow to render", () => {
    expect(voices).toMatch(/const slow = setTimeout\(\(\) => \{\s*voiceStatus\.warming = true;\s*\}, 300\);/);
    expect(voices).toMatch(/clearTimeout\(slow\);\s*voiceStatus\.warming = false;/);
  });
});

describe("the tour's controls", () => {
  it("show Kokoro warming up, and offer the click it is waiting for", () => {
    expect(controls).toMatch(/\{#if voiceStatus\.blocked\}[\s\S]*onclick=\{wakeAudio\}[\s\S]*Kokoro is ready — click to switch from the browser voice/);
    expect(controls).toMatch(/\{:else if voiceStatus\.warming\}[\s\S]*Kokoro is warming up…/);
  });
});
