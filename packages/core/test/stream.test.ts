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
    ).toBe("→ Read(one.ts)");

    expect(
      readClaude(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git mv a b" } }] },
        }),
      )?.show,
    ).toBe("→ Bash(git mv a b)");
  });

  it("cuts only a command with no bound at all, and cuts it at the end", () => {
    // A heredoc with a file inside it, or a blob pasted as an argument. The
    // beginning is what a reader recognises it by, so the beginning is what is
    // kept.
    const long = `echo ${"x".repeat(2000)}`;
    const said = readClaude(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: long } }] },
      }),
    );
    expect(said!.show!.startsWith("→ Bash(echo xxx")).toBe(true);
    expect(said!.show).toContain("…");
    expect(said!.show!.length).toBeLessThan(500);
  });

  it("does not mark a break between paragraphs of thinking", () => {
    /*
     * The fault as the panel showed it: entries reading `…` and nothing else,
     * several in a row, between the tool calls that were the only lines left
     * saying anything. Reasoning arrives with its paragraph breaks in it, and
     * marking every line without asking whether there was a line turned each
     * break into a log entry carrying no information whatsoever.
     */
    const said = readClaude(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "which table owns it\n\nand who writes to it" }],
        },
      }),
    );
    expect(said?.show).toBe("… which table owns it\n… and who writes to it");
  });

  it("says nothing at all for a thinking block that is only whitespace", () => {
    // An interleaved turn emits them, and one of those used to become a lone
    // `…` in the log — a line that says the agent thought something without
    // saying anything it thought.
    expect(
      readClaude(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "thinking", thinking: "  \n\n  " }] },
        }),
      ),
    ).toBeUndefined();
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

describe("a tool call worth reading at a glance", () => {
  const call = (name: string, input: Record<string, unknown>) =>
    readClaude(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name, input }] },
      }),
    )?.show;

  it("names the file rather than the walk to it", () => {
    /*
     * The fault, as a log of a turn in a worktree actually reads: forty lines
     * of `/Users/somebody/workspace/thinginc/thinglabs/thing/.claude/…`, the
     * same prefix every time, with the filename — the only part anybody is
     * reading for — truncated off the end.
     */
    const said = call("Read", {
      file_path:
        "/Users/somebody/workspace/thinginc/thinglabs/thing/.claude/worktrees/agent-a45/frontend/common/src/pages/app/laborPost/LaborMediaIntro.tsx",
    });
    expect(said).toBe("→ Read(LaborMediaIntro.tsx)");
  });

  it("names the file however short the path was", () => {
    // The filename is what differs from line to line, and difference is the
    // whole of what a log is scanned for.
    expect(call("Read", { file_path: "src/one.ts" })).toBe("→ Read(one.ts)");
  });

  it("shows the command rather than the walk to it", () => {
    // These tools are handed a working directory rather than inheriting one, so
    // almost every command begins by walking to it.
    const said = call("Bash", {
      command:
        "cd /Users/somebody/workspace/thinginc/thinglabs/thing/.claude/worktrees/agent-a45 && ./gradlew compileKotlin",
    });
    expect(said).toBe("→ Bash(./gradlew compileKotlin)");
  });

  it("keeps a command that did not begin with a walk", () => {
    expect(call("Bash", { command: "git status --porcelain" })).toBe(
      "→ Bash(git status --porcelain)",
    );
  });

  it("shows an ordinary command whole, however long the walk in front of it", () => {
    /*
     * The fault exactly as it was reported. Three consecutive commands in the
     * pairing panel all read `Bash(cd age…)` and a reader could not tell what
     * any of the three had done: the eighty characters the line was allowed
     * went entirely on the walk, the cut landed three letters into the name of
     * a worktree folder, and the path-shortening that runs when the line is
     * drawn then kept only that folder — so the three characters that survived
     * were three characters of the boilerplate that was supposed to be removed.
     *
     * Nothing of the command may be missing here. Not the front of it, which
     * is what the reader recognises, and not the end of it, which is where the
     * flags that make two otherwise identical runs different are written.
     */
    const ran =
      "yarn workspace @thing/backend run build --incremental --reporter=verbose --log-level=warn";
    const said = call("Bash", {
      command:
        "cd /Users/somebody/workspace/thinginc/thinglabs/thing/.claude/worktrees/agent-a45f2b3 && " +
        ran,
    });
    expect(said).toBe(`→ Bash(${ran})`);
  });

  it("takes off a walk into a path that has spaces in it", () => {
    /*
     * A checkout under a folder with a space in its name, which is ordinary on
     * a Mac and which the shell writes three different ways. Any of the three
     * that fails to match leaves the line with its boilerplate on, which is the
     * state the reader complained about.
     */
    const walked = "./gradlew compileKotlin";
    expect(call("Bash", { command: `cd "/Users/some body/My Projects/thing" && ${walked}` })).toBe(
      `→ Bash(${walked})`,
    );
    expect(call("Bash", { command: `cd '/Users/some body/My Projects/thing' && ${walked}` })).toBe(
      `→ Bash(${walked})`,
    );
    expect(call("Bash", { command: `cd /Users/some\\ body/My\\ Projects/thing && ${walked}` })).toBe(
      `→ Bash(${walked})`,
    );
  });

  it("takes off a walk written with a semicolon rather than an and", () => {
    // The difference between the two is what happens when the walk fails, not
    // what was run — and what was run is the whole of what this line is for.
    expect(call("Bash", { command: "cd /Users/somebody/workspace/thing; git status" })).toBe(
      "→ Bash(git status)",
    );
  });

  it("takes off both walks when the command walks twice", () => {
    // Down to the checkout and then into a package. Taking off only the first
    // left a line that still opened with a `cd`, which is the fault itself.
    expect(
      call("Bash", {
        command: "cd /Users/somebody/workspace/thing && cd packages/core && yarn build",
      }),
    ).toBe("→ Bash(yarn build)");
  });

  it("keeps a command that is nothing but a walk", () => {
    // It is still what the agent ran, and `Bash()` says less than a line that
    // admits the command was a walk and no more.
    expect(call("Bash", { command: "cd /Users/somebody/workspace/thing" })).toBe(
      "→ Bash(cd /Users/somebody/workspace/thing)",
    );
  });

  it("still cuts a command that is long on its own account", () => {
    const said = call("Bash", { command: `echo ${"x".repeat(2000)}` }) ?? "";
    expect(said.length).toBeLessThan(500);
    expect(said.endsWith("…)")).toBe(true);
    // Cut at the end, with the beginning — the part that says what it was —
    // still there.
    expect(said.startsWith("→ Bash(echo xxx")).toBe(true);
  });
});
