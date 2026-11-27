import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KNOWN_AGENTS } from "@odin/core";

import { CliSessions, reportedSession } from "../src/cli.js";
import type { Pty } from "../src/pty.js";
import { projectFolder, type Heard } from "../src/transcript.js";

function until(what: () => boolean, ms = 8000): Promise<void> {
  const stop = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const look = () => {
      if (what()) resolve();
      else if (Date.now() > stop) reject(new Error("gave up waiting"));
      else setTimeout(look, 25);
    };
    look();
  });
}

const claude = KNOWN_AGENTS.find((one) => one.id === "claude")!;
let home = "";
let before: string | undefined;

beforeEach(() => {
  before = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "odin-home-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = before;
});

describe("the conversation a CLI is having, when it changes inside the CLI", () => {
  it("is reported by Claude itself through a SessionStart hook Odin hands it", () => {
    const args = claude.interactive?.reports?.("/tmp/odin-cli-1.json") ?? [];
    expect(args[0]).toBe("--settings");
    expect(JSON.parse(args[1]!)).toEqual({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "cat > '/tmp/odin-cli-1.json'" }] }] },
    });
    expect(reportedSession('{"session_id":"abc-123","source":"resume"}')).toBe("abc-123");
    expect(reportedSession('{"session_id":"x; rm -rf /"}')).toBeUndefined();
    expect(reportedSession("not json")).toBeUndefined();
  });

  it("is followed from then on, so the Log hears the resumed conversation finish, and is kept as the reading's", async () => {
    const repo = "/code/shop";
    const folder = projectFolder(repo);
    mkdirSync(folder, { recursive: true });
    const heard: Heard[] = [];
    const adopted: string[] = [];
    let args: string[] = [];
    const pty: Pty = { write: () => undefined, resize: () => undefined, kill: () => undefined, onData: () => undefined, onExit: () => undefined };
    const cli = new CliSessions({
      repo: () => repo,
      kind: (agent) => (agent === "claude" ? { ...claude, path: "/bin/claude" } : undefined),
      conversation: () => "first",
      env: () => ({}),
      open: (_file, given) => {
        args = given;
        return pty;
      },
      post: () => undefined,
      heard: (_agent, said) => heard.push(...said),
      adopt: (_agent, session) => adopted.push(session),
    });
    cli.open("claude", 80, 24, "page");
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]!) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } };
    const report = /cat > '(.+)'$/.exec(settings.hooks.SessionStart[0]!.hooks[0]!.command)![1]!;

    writeFileSync(report, JSON.stringify({ session_id: "first", source: "resume" }));
    writeFileSync(join(folder, "resumed.jsonl"), "");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(adopted).toEqual([]);

    writeFileSync(report, JSON.stringify({ session_id: "resumed", source: "resume" }));
    await until(() => adopted.length > 0);
    expect(adopted).toEqual(["resumed"]);
    appendFileSync(
      join(folder, "resumed.jsonl"),
      `${JSON.stringify({ type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "All done." }] } })}\n`,
    );
    await until(() => heard.some((one) => one.role === "done" || one.text === "All done."));
    cli.close("claude");
  }, 20_000);
});
