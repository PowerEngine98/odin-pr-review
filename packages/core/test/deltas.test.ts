import { describe, expect, it } from "vitest";

import { changesIn, clockOf, lineOf, linesOf } from "../src/agents/deltas.js";

/**
 * The record of what an agent wrote.
 *
 * The terminal beside a conversation shows a turn as it happens, and an edit
 * appears in it as one line naming a file. That is the right amount for
 * watching and nothing at all for auditing: a reviewer who comes back to a
 * branch an agent has been working on for an hour wants to know what was
 * written, where, and whether it is still there.
 */
describe("reading edits out of a turn", () => {
  it("takes the passage an edit replaced", () => {
    const found = changesIn({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: {
              file_path: "/repo/src/a.ts",
              old_string: "const a = 1;",
              new_string: "const a = 2;",
            },
          },
        ],
      },
    });

    expect(found).toEqual([
      {
        path: "/repo/src/a.ts",
        before: "const a = 1;",
        after: "const a = 2;",
        whole: false,
      },
    ]);
  });

  it("keeps a multi-edit as one entry per passage", () => {
    /*
     * One call, six unrelated passages. Folded into a single entry they would
     * have a before and an after that never existed together, and one line to
     * fly to for six places.
     */
    const found = changesIn({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "MultiEdit",
            input: {
              file_path: "src/a.ts",
              edits: [
                { old_string: "one", new_string: "1" },
                { old_string: "two", new_string: "2" },
              ],
            },
          },
        ],
      },
    });

    expect(found).toHaveLength(2);
    expect(found.map((one) => one.after)).toEqual(["1", "2"]);
  });

  it("records a written file as the whole of it", () => {
    const found = changesIn({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: "src/new.ts", content: "export const a = 1;\n" },
          },
        ],
      },
    });

    expect(found[0]).toMatchObject({ before: "", whole: true });
  });

  it("ignores the tools that only look", () => {
    // A ledger of everything an agent did would be the log again. This is the
    // record of what it changed, and a search changed nothing.
    const found = changesIn({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } },
          { type: "tool_use", name: "Grep", input: { pattern: "todo" } },
          { type: "text", text: "Looking at it now." },
        ],
      },
    });

    expect(found).toEqual([]);
  });

  it("drops an edit that replaced a passage with itself", () => {
    // A tool call that happened, not a change that did.
    const found = changesIn({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "a.ts", old_string: "x", new_string: "x" },
          },
        ],
      },
    });

    expect(found).toEqual([]);
  });

  it("says nothing about an event that carries no tool call", () => {
    expect(changesIn({ type: "result", result: "done" })).toEqual([]);
    expect(changesIn({})).toEqual([]);
  });
});

describe("the time an edit happened", () => {
  it("reads as a clock, in twelve hours", () => {
    const at = (h: number, m: number) => new Date(2026, 8, 8, h, m).getTime();
    expect(clockOf(at(12, 21))).toBe("12:21 PM");
    expect(clockOf(at(0, 5))).toBe("12:05 AM");
    expect(clockOf(at(9, 0))).toBe("9:00 AM");
    expect(clockOf(at(23, 59))).toBe("11:59 PM");
  });

  it("does not turn noon or midnight into a zero", () => {
    // The hour is a remainder, and the remainder of twelve is nothing.
    expect(clockOf(new Date(2026, 8, 8, 12, 0).getTime())).toBe("12:00 PM");
    expect(clockOf(new Date(2026, 8, 8, 0, 0).getTime())).toBe("12:00 AM");
  });
});

describe("drawing one edit as the change it is", () => {
  it("keeps the lines both sides share as context", () => {
    /*
     * The passages these tools replace routinely share most of their lines.
     * Drawn as all-of-the-before then all-of-the-after, a one-word change to a
     * twelve-line block is twenty-four rows of which two matter.
     */
    const lines = linesOf(
      ["const a = 1;", "const b = 2;", "const c = 3;"].join("\n"),
      ["const a = 1;", "const b = 9;", "const c = 3;"].join("\n"),
    );

    expect(lines.map((one) => one.kind)).toEqual(["same", "del", "add", "same"]);
    expect(lines.find((one) => one.kind === "add")?.text).toBe("const b = 9;");
  });

  it("numbers the rows from where the passage sits in the file", () => {
    const lines = linesOf("one\ntwo", "one\ntoo", 137);
    expect(lines[0]).toMatchObject({ kind: "same", was: 137, now: 137 });
    expect(lines[1]).toMatchObject({ kind: "del", was: 138 });
    expect(lines[2]).toMatchObject({ kind: "add", now: 138 });
  });

  it("cuts a long stretch of unchanged code down to its edges", () => {
    const many = Array.from({ length: 40 }, (_, n) => `line ${n}`);
    const after = [...many];
    after[0] = "changed";
    after[39] = "changed too";

    const lines = linesOf(many.join("\n"), after.join("\n"));

    // Both changes are there, and the thirty-odd untouched lines between them
    // are one marker rather than thirty rows.
    expect(lines.filter((one) => one.kind === "add")).toHaveLength(2);
    expect(lines.filter((one) => one.text === "⋯")).toHaveLength(1);
    expect(lines.length).toBeLessThan(many.length);
  });

  it("draws a written file as all additions", () => {
    const lines = linesOf("", "one\ntwo");
    expect(lines.map((one) => one.kind)).toEqual(["add", "add"]);
  });
});

describe("finding a passage in a file", () => {
  it("answers with the line it starts on", () => {
    expect(lineOf("a\nb\nc\n", "b")).toBe(2);
    expect(lineOf("a\nb\nc\n", "a")).toBe(1);
  });

  it("answers with nothing when the file no longer reads that way", () => {
    /*
     * Which is the whole of the outdated mark. An exact search rather than a
     * near one on purpose: something that landed on an approximate match would
     * make the mark a guess, and a mark that is sometimes wrong is worse than
     * one that is sometimes absent.
     */
    expect(lineOf("a\nb\nc\n", "d")).toBeUndefined();
    expect(lineOf("", "a")).toBeUndefined();
    expect(lineOf("a\n", "")).toBeUndefined();
  });

  it("finds a passage spanning several lines", () => {
    expect(lineOf("one\ntwo\nthree\n", "two\nthree")).toBe(2);
  });
});
