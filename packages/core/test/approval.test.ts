import { describe, expect, it } from "vitest";

import { describeRequest, doingOf, permitted } from "../src/agents/approval.js";

/**
 * What an agent may do without being asked again.
 *
 * The rung the reader put it on is a standing answer. Re-asking a question that
 * has already been answered is how a permission prompt turns into something
 * people click through without reading, and a prompt nobody reads is worse than
 * no prompt at all — it looks like oversight and is not.
 */
describe("what a tool call is doing", () => {
  it("knows the ones that only look", () => {
    for (const tool of ["Read", "read_file", "Glob", "Grep", "LS", "WebSearch"]) {
      expect(doingOf(tool)).toBe("reads");
    }
  });

  it("knows the ones that change files", () => {
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(doingOf(tool)).toBe("writes");
    }
  });

  it("treats anything it does not recognise as the worst case", () => {
    /*
     * The names are not a stable vocabulary — they differ per agent and change
     * between versions. Guessing generously is the expensive mistake here; the
     * cost of being wrong the other way is one prompt.
     */
    expect(doingOf("Bash")).toBe("runs");
    expect(doingOf("SomethingNobodyHasHeardOf")).toBe("runs");
  });

  it("sees past the wrapping a tool from a server carries", () => {
    expect(doingOf("mcp__github__read_file")).toBe("reads");
  });
});

describe("whether the rung already covers it", () => {
  it("asks about everything on the rung that means asking", () => {
    for (const doing of ["reads", "writes", "runs"] as const) {
      expect(permitted("ask", doing)).toBe(false);
    }
  });

  it("lets a reader-only agent read and nothing else", () => {
    expect(permitted("read", "reads")).toBe(true);
    expect(permitted("read", "writes")).toBe(false);
    expect(permitted("read", "runs")).toBe(false);
  });

  it("lets an editing agent edit but still asks before it runs anything", () => {
    // Writing files in the checkout is the work. Running commands is the
    // separate decision, and the one still worth interrupting for.
    expect(permitted("edits", "writes")).toBe(true);
    expect(permitted("edits", "reads")).toBe(true);
    expect(permitted("edits", "runs")).toBe(false);
  });

  it("has nothing to ask on the top rung", () => {
    // An agent there is run with the checks off and never reaches this.
    for (const doing of ["reads", "writes", "runs"] as const) {
      expect(permitted("full", doing)).toBe(true);
    }
  });
});

describe("what the reader is actually asked", () => {
  it("names the command rather than the tool", () => {
    // "Bash wants to run" is a sentence about Odin. What the reader needs to
    // decide is what the command does.
    expect(describeRequest("Bash", { command: "git mv a.sql b.sql" }))
      .toBe("run `git mv a.sql b.sql`");
  });

  it("names the file being written", () => {
    expect(describeRequest("Write", { file_path: "src/one.ts" }))
      .toBe("write `src/one.ts`");
  });

  it("shortens a command too long to read in a thread", () => {
    const long = "echo " + "x".repeat(300);
    const said = describeRequest("Bash", { command: long });
    expect(said.length).toBeLessThan(140);
    expect(said).toContain("…");
  });

  it("falls back to the tool's own name when it can say nothing better", () => {
    expect(describeRequest("SomeTool", {})).toBe("use SomeTool");
  });
});
