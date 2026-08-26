#!/usr/bin/env node
/**
 * The tool Claude asks before it does anything it has not been permitted.
 *
 * Claude's `--permission-prompt-tool` names a tool on an MCP server, and it
 * spawns that server itself as a child process — so this cannot be the
 * extension, which is already running and has the reader's screen. It is a stub
 * whose whole job is to be spawnable: it speaks MCP on its standard streams,
 * and forwards every decision down a socket to the editor, which is where
 * somebody can actually be asked.
 *
 * Deliberately a separate file with no imports. It runs as a child of a tool we
 * do not control, in whatever environment that tool has, and the failure mode
 * for a missing dependency here is an agent that cannot ask for permission and
 * therefore silently cannot act.
 */

import { createConnection } from "node:net";
import { createInterface } from "node:readline";

const SOCKET = process.argv[2];

/** JSON-RPC on newline-delimited JSON, which is what MCP over stdio is. */
function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } })}\n`,
  );
}

/**
 * Asks the editor, and waits as long as it takes.
 *
 * A permission request has no useful timeout of its own: the reader is either
 * at the keyboard or they are not, and answering for them because they went to
 * lunch is the one outcome nobody wants from a thing whose entire purpose is to
 * ask. The editor decides what to do about waiting; this only carries.
 *
 * A socket that cannot be reached is a denial rather than an allowance. Odin
 * not being there is not consent.
 */
function ask(request) {
  return new Promise((resolve) => {
    let answered = false;
    const settle = (decision) => {
      if (answered) return;
      answered = true;
      resolve(decision);
    };

    const socket = createConnection(SOCKET);
    socket.on("error", () =>
      settle({ behavior: "deny", message: "Odin is not listening; nothing was done." }),
    );
    socket.on("close", () =>
      settle({ behavior: "deny", message: "Odin went away before answering." }),
    );

    let held = "";
    socket.on("data", (chunk) => {
      held += String(chunk);
      const at = held.indexOf("\n");
      if (at < 0) return;
      try {
        settle(JSON.parse(held.slice(0, at)));
      } catch {
        settle({ behavior: "deny", message: "Odin answered something unreadable." });
      }
      socket.end();
    });

    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
  });
}

const TOOL = {
  name: "approve",
  description:
    "Ask the reviewer whether this action may go ahead. Called automatically; do not call it directly.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  // A notification has no id and wants no answer. Replying to one is a protocol
  // error, and the tool that receives it is entitled to close the connection.
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    reply(message.id, {
      // Echoed rather than chosen: the caller names the version it speaks, and
      // a server that insists on its own is a server that fails on upgrade.
      protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "odin", version: "0.1.0" },
    });
    return;
  }

  if (message.method === "tools/list") {
    reply(message.id, { tools: [TOOL] });
    return;
  }

  if (message.method === "tools/call") {
    const asked = message.params?.arguments ?? {};
    void ask({
      tool: asked.tool_name ?? message.params?.name ?? "",
      input: asked.input ?? {},
      id: asked.tool_use_id ?? "",
    }).then((decision) => {
      /*
       * The decision travels as text inside a tool result, which is how this
       * protocol carries anything. Claude parses it back out; the shape is its
       * contract, not ours, and getting it wrong reads as the tool erroring
       * rather than as a denial.
       */
      reply(message.id, {
        content: [{ type: "text", text: JSON.stringify(decision) }],
      });
    });
    return;
  }

  fail(message.id, `odin: no method ${message.method}`);
});
