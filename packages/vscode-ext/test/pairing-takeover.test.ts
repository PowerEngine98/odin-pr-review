import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PairingSession } from "../src/pairing.js";

function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
  };
}

type Inside = { asking: string; decide(asked: unknown): Promise<unknown> };

describe("a conversation whose panel is replaced mid-turn", () => {
  it("keeps the agent's question where the new panel can see and answer it", async () => {
    const repo = mkdtempSync(join(tmpdir(), "odin-takeover-"));
    const store = memento();
    const key = `takeover:${repo}`;
    const make = () => new PairingSession(store as never, key, repo, () => {});
    const first = {};
    const second = {};
    let drawnBySecond = 0;

    const before = PairingSession.adopt(key, first, make, () => {});
    before.setAgency({ claude: "read" });
    (before as unknown as Inside).asking = "claude";
    const decision = (before as unknown as Inside).decide({
      tool: "ExitPlanMode",
      input: { plan: "Print hello.", planFilePath: "/plans/p.md" },
    });

    const after = PairingSession.adopt(key, second, make, () => drawnBySecond++);
    expect(after).toBe(before);
    const waiting = after.local().find((one) => one.approval?.state === "waiting");
    expect(waiting?.agent).toBe("claude");
    expect(waiting?.approval?.tool).toBe("ExitPlanMode");

    PairingSession.release(key, first);
    after.answer(waiting!.approval!.id, true);
    expect(await decision).toMatchObject({ behavior: "allow" });
    expect(drawnBySecond).toBeGreaterThan(0);
    PairingSession.release(key, second);
  });

  it("ends the conversation only when the last panel showing it goes, refusing what is still waiting", async () => {
    const repo = mkdtempSync(join(tmpdir(), "odin-takeover-"));
    const key = `release:${repo}`;
    const make = () => new PairingSession(memento() as never, key, repo, () => {});
    const one = {};
    const two = {};
    const session = PairingSession.adopt(key, one, make, () => {});
    PairingSession.adopt(key, two, make, () => {});
    session.setAgency({ claude: "ask" });
    (session as unknown as Inside).asking = "claude";
    const decision = (session as unknown as Inside).decide({ tool: "Bash", input: { command: "ls" } });

    PairingSession.release(key, one);
    let settled = false;
    void decision.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    PairingSession.release(key, two);
    expect(await decision).toMatchObject({ behavior: "deny" });
    expect(PairingSession.adopt(key, {}, make, () => {})).not.toBe(session);
  });
});
