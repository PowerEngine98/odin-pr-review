import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PairingSession } from "../src/pairing.js";

function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
    held,
  };
}

describe("asking an agent which commands it offers", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;
  let argv: string;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-probe-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-probe-repo-"));
    argv = join(repo, "argv");
    const file = join(bin, "claude");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "1.0.0 (Claude Code)"; exit 0; fi',
        `echo "$@" > ${argv}`,
        `echo '{"type":"system","subtype":"init","model":"m","slash_commands":["mcp","compact"],"terminal_slash_commands":["doctor"]}'`,
        "sleep 30",
        `echo answered >> ${argv}`,
      ].join("\n") + "\n",
    );
    chmodSync(file, 0o755);
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("hears the list from the tool's opening, stops it there, saves nothing, and remembers the answer", async () => {
    const store = memento();
    const paired = new PairingSession(store as never, "reading", repo, () => {});
    await paired.look(true);
    const began = Date.now();
    const commands = await paired.probeCommands("claude");
    expect(commands).toEqual(["compact", "doctor", "mcp"]);
    expect(Date.now() - began).toBeLessThan(10_000);
    const said = readFileSync(argv, "utf8");
    expect(said).toContain("--no-session-persistence");
    expect(said).not.toContain("answered");
    expect(new PairingSession(store as never, "reading", repo, () => {}).commandsOf("claude")).toEqual(["compact", "doctor", "mcp"]);
  }, 30_000);
});
