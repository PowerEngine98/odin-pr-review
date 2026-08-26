import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const STUB = fileURLToPath(new URL("../media/approve.mjs", import.meta.url));

/**
 * The tool Claude asks before doing anything it has not been permitted.
 *
 * It runs as a child of a tool we do not control, speaking a protocol we do not
 * own, and every failure in it looks the same from outside: an agent that
 * quietly cannot act. So it is driven here exactly as Claude drives it — spawn
 * it, speak MCP down its standard input, and read what comes back.
 */
function talk(socketPath: string) {
  const child = spawn(process.execPath, [STUB, socketPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines: string[] = [];
  let held = "";
  child.stdout.on("data", (chunk) => {
    held += String(chunk);
    for (;;) {
      const at = held.indexOf("\n");
      if (at < 0) break;
      lines.push(held.slice(0, at));
      held = held.slice(at + 1);
    }
  });

  return {
    send: (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`),
    async next(): Promise<Record<string, unknown>> {
      const stop = Date.now() + 8000;
      while (Date.now() < stop) {
        const line = lines.shift();
        if (line) return JSON.parse(line);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("the stub said nothing");
    },
    stop: () => child.kill(),
  };
}

describe("the permission tool Claude spawns", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "odin-mcp-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** An editor at the other end, answering however the test says. */
  function listening(answer: (request: unknown) => unknown) {
    const path = join(dir, `sock-${Math.random().toString(36).slice(2)}`);
    const asked: unknown[] = [];
    const server = createServer((socket) => {
      let held = "";
      socket.on("data", (chunk) => {
        held += String(chunk);
        const at = held.indexOf("\n");
        if (at < 0) return;
        const request = JSON.parse(held.slice(0, at));
        asked.push(request);
        socket.write(`${JSON.stringify(answer(request))}\n`);
      });
    });
    return new Promise<{ path: string; asked: unknown[]; close: () => void }>((resolve) => {
      server.listen(path, () =>
        resolve({ path, asked, close: () => server.close() }),
      );
    });
  }

  it("answers the handshake with the version it was offered", async () => {
    // A server that insists on its own version is a server that fails the day
    // the tool upgrades.
    const editor = await listening(() => ({ behavior: "allow" }));
    const mcp = talk(editor.path);
    mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });

    const said = await mcp.next();
    expect((said.result as Record<string, unknown>).protocolVersion).toBe("2025-06-18");
    mcp.stop();
    editor.close();
  }, 20_000);

  it("offers exactly one tool", async () => {
    const editor = await listening(() => ({ behavior: "allow" }));
    const mcp = talk(editor.path);
    mcp.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    const said = await mcp.next();
    const tools = (said.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(["approve"]);
    mcp.stop();
    editor.close();
  }, 20_000);

  it("carries the request to the editor and the answer back", async () => {
    const editor = await listening(() => ({ behavior: "allow", updatedInput: {} }));
    const mcp = talk(editor.path);
    mcp.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "approve",
        arguments: { tool_name: "Bash", input: { command: "git mv a b" }, tool_use_id: "u1" },
      },
    });

    const said = await mcp.next();
    expect(said.id).toBe(7);
    const text = (said.result as { content: { text: string }[] }).content[0]!.text;
    expect(JSON.parse(text)).toEqual({ behavior: "allow", updatedInput: {} });
    // And the editor was told what it was deciding about.
    expect(editor.asked).toEqual([{ tool: "Bash", input: { command: "git mv a b" }, id: "u1" }]);
    mcp.stop();
    editor.close();
  }, 20_000);

  it("denies when the editor is not there at all", async () => {
    /*
     * Odin not being there is not consent. A stub that allowed on failure would
     * turn every crash, every closed window and every stale socket into a free
     * pass — and the reader would never see any of them.
     */
    const mcp = talk(join(dir, "nothing-is-listening-here"));
    mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "Bash", input: {} } },
    });

    const said = await mcp.next();
    const text = (said.result as { content: { text: string }[] }).content[0]!.text;
    expect(JSON.parse(text).behavior).toBe("deny");
    mcp.stop();
  }, 20_000);

  it("denies when the editor goes away mid-question", async () => {
    const editor = await listening(() => ({ behavior: "allow" }));
    const mcp = talk(editor.path);
    editor.close();
    mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "Bash", input: {} } },
    });

    const said = await mcp.next();
    expect(JSON.parse((said.result as { content: { text: string }[] }).content[0]!.text).behavior)
      .toBe("deny");
    mcp.stop();
  }, 20_000);

  it("says nothing back to a notification", async () => {
    // Replying to one is a protocol error, and the caller is entitled to close
    // the connection over it.
    const editor = await listening(() => ({ behavior: "allow" }));
    const mcp = talk(editor.path);
    mcp.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    const said = await mcp.next();
    expect(said.id).toBe(2);
    mcp.stop();
    editor.close();
  }, 20_000);
});
