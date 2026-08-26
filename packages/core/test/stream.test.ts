import { describe, expect, it } from "vitest";

import { readClaude } from "../src/agents/stream.js";

/**
 * A turn as it happens, rather than all at once when it ends.
 *
 * In its quiet mode a tool prints nothing until it has finished — so a terminal
 * watching four minutes of work shows an empty box for four minutes and then
 * eight paragraphs. The one thing the reader wants during those minutes is the
 * one thing that mode cannot say.
 *
 * The shapes here were measured against the tool, not taken from documentation.
 */
describe("reading a narrated turn", () => {
  it("shows what the agent says as it says it", () => {
    const said = readClaude(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Splitting the projection." }] },
      }),
    );
    expect(said?.show).toBe("Splitting the projection.");
  });

  it("marks thinking as thinking", () => {
    // The agent working rather than the agent answering, and a reader skimming
    // a log should be able to tell at a glance.
    const said = readClaude(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "  which table owns it  " }] },
      }),
    );
    expect(said?.show).toBe("… which table owns it");
  });

  it("names what a tool call is actually doing", () => {
    // `Bash`, `Read` and `Edit` are things an agent does constantly. What makes
    // the line worth reading is which file, or which command.
    expect(
      readClaude(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/one.ts" } }] },
        }),
      )?.show,
    ).toBe("→ Read(src/one.ts)");

    expect(
      readClaude(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git mv a b" } }] },
        }),
      )?.show,
    ).toBe("→ Bash(git mv a b)");
  });

  it("shortens a command too long for a line", () => {
    const long = "echo " + "x".repeat(200);
    const said = readClaude(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: long } }] },
      }),
    );
    expect(said!.show!.length).toBeLessThan(100);
    expect(said!.show).toContain("…");
  });

  it("picks the answer out of the stream", () => {
    const said = readClaude(JSON.stringify({ type: "result", subtype: "success", result: "Done." }));
    expect(said?.answer).toBe("Done.");
    expect(said?.show).toBeUndefined();
  });

  it("says nothing about the machinery", () => {
    /*
     * Hooks that ran at startup, the session banner, rate limit accounting,
     * and the results coming back from tools. The reader is watching to see
     * what the agent is doing, and none of that is it.
     */
    for (const event of [
      { type: "system", subtype: "init", cwd: "/x" },
      { type: "system", subtype: "hook_started", hook_name: "SessionStart" },
      { type: "rate_limit_event", rate_limit_info: {} },
      { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
    ]) {
      expect(readClaude(JSON.stringify(event))).toBeUndefined();
    }
  });

  it("never puts raw protocol into the log", () => {
    // A log with a line of JSON in it is worse than a log with a gap.
    expect(readClaude('{"type":"something-new","payload":{"a":1}}')).toBeUndefined();
    expect(readClaude('{"broken json')).toBeUndefined();
  });

  it("keeps a banner a tool prints before the stream starts", () => {
    expect(readClaude("Using model claude-opus-5")?.show).toBe("Using model claude-opus-5");
  });
});
