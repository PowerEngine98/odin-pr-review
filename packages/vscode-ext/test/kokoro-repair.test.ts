import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Kokoro } from "../src/kokoro.js";

function installed(python: "working" | "dangling"): string {
  const root = mkdtempSync(join(tmpdir(), "kokoro-"));
  const bin = join(root, "venv", "bin");
  mkdirSync(bin, { recursive: true });
  const target = join(root, "python3.12");
  if (python === "working") writeFileSync(target, "");
  symlinkSync(python === "working" ? target : join(root, "moved", "python3.12"), join(bin, "python"));
  writeFileSync(join(root, "ready.json"), JSON.stringify({ version: Kokoro.version }));
  return root;
}

describe("a Kokoro install whose interpreter went away", () => {
  it.skipIf(process.platform === "win32")("is not ready, and is cleared to be set up again", async () => {
    const root = installed("dangling");
    const kokoro = new Kokoro(root, "server.py", () => ({ voice: "af_heart", speed: 1 }));
    expect(await kokoro.ready()).toBe(false);
    expect(await kokoro.repair()).toBe(true);
    expect(existsSync(join(root, "venv"))).toBe(false);
    expect(existsSync(join(root, "ready.json"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("leaves a working install alone", async () => {
    const root = installed("working");
    const kokoro = new Kokoro(root, "server.py", () => ({ voice: "af_heart", speed: 1 }));
    expect(await kokoro.ready()).toBe(true);
    expect(await kokoro.repair()).toBe(false);
    expect(existsSync(join(root, "venv"))).toBe(true);
  });
});
