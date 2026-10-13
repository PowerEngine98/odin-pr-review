import { describe, expect, it } from "vitest";

import { readOpencode } from "../src/agents/stream.js";

/**
 * Reading opencode, which is asked for its event stream rather than its screen.
 *
 * Its ordinary output is drawn for a terminal — colour codes around every tool
 * name, a different rendering per tool, a banner — which is a wall of escapes
 * to a reader and a different wall each version. `--format json` puts one JSON
 * object per line instead, and this parses those.
 *
 * The objects below are what the tool actually emitted, taken from a session
 * and kept in their shape.
 */
const event = (type: string, part: Record<string, unknown>): string =>
  JSON.stringify({ type, part });

describe("reading opencode's event stream", () => {
  it("shows what the agent says, and takes it as the answer", () => {
    const said = readOpencode(event("text", { type: "text", text: "Done." }));
    expect(said?.show).toBe("Done.");
    expect(said?.answer).toBe("Done.");
  });

  it("takes off a chat marker the model leaked into its text", () => {
    /*
     * Measured: the model sometimes leaks the chat template's own closing tag
     * into a text part, so an answer arrived as a tagged `Done.` instead of a
     * bare one. A marker is not a thing the agent said, so it comes off — and
     * the rest of it stays.
     *
     * Written as escapes rather than the tag itself, because the tag is what
     * this is a test about and a reader should not have to guess which angle
     * brackets are the fixture and which are the prose.
     */
    const tag = "\u003c/think\u003e";
    const said = readOpencode(event("text", { type: "text", text: `${tag}Done.` }));
    expect(said?.show).toBe("Done.");
    expect(said?.answer).toBe("Done.");
  });

  it("marks reasoning the way the other agents' is marked", () => {
    // Marked, because it is the agent working rather than the agent answering,
    // and a reader skimming a log should be able to tell the two apart.
    const said = readOpencode(event("reasoning", { text: "  which table owns it  " }));
    expect(said?.show).toBe("… which table owns it");
  });

  it("keeps every line of a thought, not only the first", () => {
    const said = readOpencode(event("reasoning", { text: "one\n\ntwo" }));
    expect(said?.show).toBe("… one\n… two");
  });

  it("names a tool the way the other agents' are named", () => {
    const said = readOpencode(
      event("tool_use", {
        type: "tool",
        tool: "read",
        state: { status: "completed", input: { filePath: "src/components/TagChip.tsx" } },
      }),
    );
    expect(said?.show).toBe("→ Read(TagChip.tsx)");
  });

  it("shows the command rather than the walk to it", () => {
    const said = readOpencode(
      event("tool_use", {
        type: "tool",
        tool: "bash",
        state: {
          input: { command: "cd /Users/somebody/workspace/thinginc/thing && ./gradlew compileKotlin" },
        },
      }),
    );
    expect(said?.show).toBe("→ Bash(./gradlew compileKotlin)");
  });

  it("says a search by what it searched for", () => {
    const said = readOpencode(
      event("tool_use", {
        type: "tool",
        tool: "grep",
        state: { input: { pattern: "tag.card" } },
      }),
    );
    expect(said?.show).toBe("→ Grep(tag.card)");
  });

  it("lifts an edit out of the stream for the ledger", () => {
    const said = readOpencode(
      event("tool_use", {
        type: "tool",
        tool: "edit",
        state: { input: { filePath: "src/one.ts", oldString: "a", newString: "b" } },
      }),
    );
    expect(said?.did).toEqual([
      { path: "src/one.ts", before: "a", after: "b", whole: false },
    ]);
  });

  it("keeps a whole-file write as one", () => {
    const said = readOpencode(
      event("tool_use", {
        type: "tool",
        tool: "write",
        state: { input: { filePath: "src/two.ts", content: "let x = 1;\n" } },
      }),
    );
    expect(said?.did).toEqual([
      { path: "src/two.ts", before: "", after: "let x = 1;\n", whole: true },
    ]);
  });

  it("does not turn a no-op edit into a change", () => {
    // A tool call that happened, not a change that did.
    const said = readOpencode(
      event("tool_use", {
        type: "tool",
        tool: "edit",
        state: { input: { filePath: "src/one.ts", oldString: "a", newString: "a" } },
      }),
    );
    expect(said?.did ?? []).toEqual([]);
  });

  it("says nothing about the machinery", () => {
    // A step beginning and ending is the tool's own bookkeeping, and the reader
    // is watching to see what the agent is doing rather than how it is filed.
    for (const type of ["step_start", "step_finish"]) {
      expect(readOpencode(event(type, { type }))).toBeUndefined();
    }
  });

  it("skips a text part with nothing in it", () => {
    // A turn's machinery can emit an empty part; a log entry carrying nothing
    // is not a log entry.
    expect(readOpencode(event("text", { type: "text", text: "   " }))).toBeUndefined();
  });

  it("never puts the protocol itself into the log", () => {
    // A log with a line of raw JSON in it is worse than a log with a gap.
    expect(readOpencode('{"type":"something-new","part":{}}')).toBeUndefined();
    expect(readOpencode('{"broken json')).toBeUndefined();
  });

  it("keeps a banner printed before the stream starts", () => {
    expect(readOpencode("Using model big-pickle")?.show).toBe("Using model big-pickle");
  });
});
