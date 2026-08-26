import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PairingSession } from "../src/pairing.js";

const STUB = fileURLToPath(new URL("../media/approve.mjs", import.meta.url));

function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(k: string, f?: T) => (k in held ? (held[k] as T) : f),
    update: (k: string, v: unknown) => {
      held[k] = v;
      return Promise.resolve();
    },
  };
}

async function until(what: () => boolean, ms = 10_000): Promise<void> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("gave up waiting");
}

/**
 * An agent asking before it acts, end to end.
 *
 * The fake reads the server description Odin wrote, spawns the same stub Claude
 * would spawn, and asks through it. Everything between — the socket, the
 * protocol, the rung, the remark in the thread, the reader's answer — is the
 * real thing.
 */
describe("an agent asking whether it may", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-ap-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-ap-repo-"));

    /*
     * Claude, as far as this matters: it takes `--mcp-config`, and when told to
     * it asks through the server named in that file before doing the thing.
     */
    const file = join(bin, "claude");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi',
        // Its own arguments to the log, which is where a real tool's noise
        // goes — and the only place the invocation is visible from outside.
        // Odin no longer writes it there: what was in question was whether the
        // rung reached the tool at all, and that is settled.
        'echo "ARGS: $@" >&2',
        "config=''",
        'while [ $# -gt 0 ]; do',
        '  if [ "$1" = "--mcp-config" ]; then config="$2"; fi',
        // The prompt arrives as one argument, so this looks inside it rather
        // than for a bare word among the flags.
        '  case "$1" in *ASK*) want="yes";; esac',
        "  shift",
        "done",
        'if [ -n "$config" ] && [ -n "$want" ]; then',
        `  node ${JSON.stringify(join(bin, "asker.mjs"))} "$config"`,
        "else",
        '  echo "no asking needed"',
        "fi",
      ].join("\n") + "\n",
    );
    chmodSync(file, 0o755);

    // The half of Claude that talks MCP: spawns the stub Odin named, and asks.
    writeFileSync(
      join(bin, "asker.mjs"),
      `
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const server = config.mcpServers.odin;
const child = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "inherit"] });
let held = "";
child.stdout.on("data", (chunk) => {
  held += String(chunk);
  for (;;) {
    const at = held.indexOf("\\n");
    if (at < 0) break;
    const said = JSON.parse(held.slice(0, at));
    held = held.slice(at + 1);
    if (said.id === 1) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "approve", arguments: { tool_name: "Bash",
          input: { command: "git mv a.sql b.sql" }, tool_use_id: "u1" } } }) + "\\n");
    } else if (said.id === 2) {
      const decision = JSON.parse(said.result.content[0].text);
      console.log("DECISION " + decision.behavior);
      child.kill();
      process.exit(0);
    }
  }
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\\n");
`,
    );

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
    PairingSession.stub = STUB;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const where = { path: "a.ts", line: 1, side: "RIGHT" as const, author: "m" };

  async function session(rung: "read" | "ask" | "edits" | "full") {
    const paired = new PairingSession(memento() as never, "k", repo, () => {});
    await paired.look(true);
    paired.setOrder(["claude"]);
    paired.setAgency({ claude: rung });
    return paired;
  }

  it("points the tool at somewhere it can ask", async () => {
    const paired = await session("edits");
    paired.ask({ ...where, body: "ASK please" });
    await until(() => paired.transcript("claude").includes("ARGS:"));

    const invocation = paired.transcript("claude");
    expect(invocation).toContain("--mcp-config");
    expect(invocation).toContain("--permission-prompt-tool");
    expect(invocation).toContain("mcp__odin__approve");
    paired.dispose();
  }, 30_000);

  it("writes a description the tool can actually spawn", async () => {
    const paired = await session("edits");
    paired.ask({ ...where, body: "ASK please" });
    await until(() => paired.transcript("claude").includes("--mcp-config"));

    const at = paired.transcript("claude").match(/--mcp-config (\S+)/)?.[1] ?? "";
    const config = JSON.parse(readFileSync(at, "utf8"));
    expect(config.mcpServers.odin.command).toBe(process.execPath);
    expect(config.mcpServers.odin.args[0]).toBe(STUB);
    paired.dispose();
  }, 30_000);

  it("asks the reader when the rung does not cover it", async () => {
    /*
     * `edits` covers writing files. Running a command is the separate decision,
     * and the one still worth interrupting for.
     */
    const paired = await session("edits");
    paired.ask({ ...where, body: "ASK please" });

    await until(() => paired.pending().length === 1, 25_000);
    expect(paired.pending()[0]!.what).toBe("run `git mv a.sql b.sql`");
    // And it is a message in the thread, not merely a dialogue somewhere.
    expect(paired.local().some((c) => c.approval?.state === "waiting")).toBe(true);

    paired.answer(paired.pending()[0]!.id, true);
    await until(() => paired.transcript("claude").includes("DECISION allow"), 25_000);
    expect(paired.local().some((c) => c.approval?.state === "allowed")).toBe(true);
    paired.dispose();
  }, 40_000);

  it("carries a refusal back to the tool", async () => {
    const paired = await session("edits");
    paired.ask({ ...where, body: "ASK please" });
    await until(() => paired.pending().length === 1, 25_000);

    paired.answer(paired.pending()[0]!.id, false);
    await until(() => paired.transcript("claude").includes("DECISION deny"), 25_000);
    expect(paired.local().some((c) => c.approval?.state === "denied")).toBe(true);
    paired.dispose();
  }, 40_000);

  it("does not interrupt for something the rung already allows", async () => {
    /*
     * The rung is a standing answer, and re-asking one already given is how a
     * permission prompt becomes something people click through without reading.
     */
    const paired = await session("full");
    paired.ask({ ...where, body: "ASK please" });
    await until(() => paired.local().some((c) => c.agent === "claude"), 25_000);

    expect(paired.pending()).toEqual([]);
    // On the top rung it is not even given anywhere to ask.
    expect(paired.transcript("claude")).not.toContain("--permission-prompt-tool");
    paired.dispose();
  }, 40_000);

  it("refuses what is still parked when the turn ends", async () => {
    // The tool has gone. Leaving the promise unsettled leaks it, and leaving
    // the remark saying "waiting" leaves a button that answers nothing.
    const paired = await session("edits");
    paired.ask({ ...where, body: "ASK please" });
    await until(() => paired.pending().length === 1, 25_000);

    paired.dispose();
    expect(paired.pending()).toEqual([]);
    expect(paired.local().some((c) => c.approval?.state === "denied")).toBe(true);
  }, 40_000);
});
