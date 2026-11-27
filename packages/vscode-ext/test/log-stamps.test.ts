import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAMP, STAMP_MS, stampLine, withStamp } from "../src/stamps.js";

const at = Date.parse("2026-01-01T19:39:00.000Z");

describe("the time each part of an agent's Log was written", () => {
  it("is marked on a line of its own where a new line starts, no more than once every couple of seconds", () => {
    expect(withStamp("", "Reading Order.kt\n", at, 0)).toEqual({ text: `${stampLine(at)}\nReading Order.kt\n`, stamped: true });
    expect(withStamp("done\n", "next\n", at + STAMP_MS - 1, at).stamped).toBe(false);
    expect(withStamp("done\n", "next\n", at + STAMP_MS, at).stamped).toBe(true);
  });

  it("never cuts a line in two, and starts after the line break a chunk begins with", () => {
    expect(withStamp("half a li", "ne\n", at, 0)).toEqual({ text: "ne\n", stamped: false });
    expect(withStamp("half a line", "\n[odin:ask 3] next\n", at, 0)).toEqual({ text: `\n${stampLine(at)}\n[odin:ask 3] next\n`, stamped: true });
  });

  it("is a line the Log reads as a time, not as something said", () => {
    expect(STAMP.exec(stampLine(at))?.[1]).toBe("2026-01-01T19:39:00.000Z");
  });

  it("is shown over the part it begins, and the Changes count wears the same yellow as the sidebar's marks", () => {
    const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");
    expect(terminal).toMatch(/<span class="block-time">\{clockOf\(Date\.parse\(block\.at\)\)\}<\/span>/);
    expect(terminal).toMatch(/\.record-count \{[^}]*background: var\(--warning\);\s*color: var\(--bg\);/);
  });
});
