import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function until(what: () => boolean, ms = 8000): Promise<void> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("gave up waiting");
}

describe("an agent that names its own conversation", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-learn-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-learn-repo-"));
    const file = join(bin, "opencode");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "1.18.0"; exit 0; fi',
        'id=""',
        'prev=""',
        'for arg in "$@"; do',
        '  if [ "$prev" = "--session" ]; then id="$arg"; fi',
        '  prev="$arg"',
        "done",
        'if [ -n "$id" ]; then',
        '  echo "{\\"type\\":\\"text\\",\\"sessionID\\":\\"$id\\",\\"part\\":{\\"type\\":\\"text\\",\\"text\\":\\"resumed $id\\"}}"',
        "  exit 0",
        "fi",
        'echo "{\\"type\\":\\"step_start\\",\\"sessionID\\":\\"ses_one\\",\\"part\\":{}}"',
        'echo "{\\"type\\":\\"text\\",\\"sessionID\\":\\"ses_one\\",\\"part\\":{\\"type\\":\\"text\\",\\"text\\":\\"started\\"}}"',
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

  const where = { path: "a.ts", line: 1, side: "RIGHT" as const, author: "m" };

  async function session(store: ReturnType<typeof memento>) {
    const paired = new PairingSession(store as never, "reading", repo, () => {});
    await paired.look(true);
    paired.setOrder(["opencode"]);
    return paired;
  }

  it("learns the conversation from the first answer and carries it on", async () => {
    const paired = await session(memento());
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().filter((c) => c.agent === "opencode").length === 1);
    expect(paired.session("opencode")).toBe("ses_one");

    paired.ask({ ...where, body: "two" });
    await until(() => paired.local().filter((c) => c.agent === "opencode").length === 2);
    expect(paired.local().filter((c) => c.agent === "opencode").pop()?.body).toContain("resumed ses_one");
  }, 30_000);

  it("keeps the learned conversation across a reload", async () => {
    const store = memento();
    const before = await session(store);
    before.ask({ ...where, body: "one" });
    await until(() => before.local().some((c) => c.agent === "opencode"));

    const after = await session(store);
    expect(after.session("opencode")).toBe("ses_one");
  }, 30_000);
});
