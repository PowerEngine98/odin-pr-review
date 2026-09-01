import { describe, expect, it } from "vitest";

import { readOpencode } from "../src/agents/stream.js";

/**
 * Reading opencode, which writes for a terminal rather than for a reader.
 *
 * It has no streaming mode to ask for, so what arrives is what it would have
 * drawn on a screen: colour codes around every tool name, and tool calls run
 * together with the prose around them, because the escape sequences — not the
 * newlines — were what separated them. Shown raw, a turn reads as a wall of
 * `[0m` and `[90m` with a sentence somewhere inside it.
 *
 * The lines below are what the tool actually printed, taken from a session and
 * kept exactly, escapes and all.
 */
const E = "";

describe("reading what opencode prints", () => {
  it("takes the colours off", () => {
    const said = readOpencode(`${E}[0mI'll check the codebase.${E}[0m`);
    expect(said?.show).toBe("I'll check the codebase.");
    expect(said?.show).not.toContain("[0m");
    expect(said?.show).not.toContain(E);
  });

  it("marks a tool call the way the other agents' are marked", () => {
    // So that one log reads the same however it was produced: a reader
    // skimming for "what did it actually do" is looking for the arrows.
    const said = readOpencode(
      `${E}[0m${E}[0mGrep "tag.card"${E}[90m 0 matches${E}[0m`,
    );
    expect(said?.show).toContain('→ Grep(tag.card)');
  });

  it("separates a tool call from the sentence it was printed inside", () => {
    /*
     * The fault this exists for. Two tool calls and two sentences arrived as
     * one line, held apart by nothing but colour, and the log ran them into a
     * paragraph that read as gibberish.
     */
    const line =
      `${E}[0mLet me search more broadly.${E}[0m ${E}[0mGlob "*/TagCard."` +
      `${E}[90m 0 matches${E}[0m ${E}[0mRead /src/components/TagChip.tsx${E}[0m`;
    const shown = readOpencode(line)?.show?.split("\n") ?? [];

    expect(shown[0]).toBe("Let me search more broadly.");
    expect(shown.some((one) => one.startsWith("→ Glob("))).toBe(true);
    expect(shown.some((one) => one.startsWith("→ Read("))).toBe(true);
  });

  it("keeps a sentence whole when the colour was only emphasis", () => {
    // A paragraph broken at every emphasis is its own kind of unreadable.
    const said = readOpencode(
      `${E}[0mI found ${E}[1mTagCarousell.tsx${E}[0m in the same folder.`,
    );
    expect(said?.show).toBe("I found TagCarousell.tsx in the same folder.");
  });

  it("does not call a sentence a tool because it starts with a capital", () => {
    // `List`, `Read` and `Edit` are also ordinary words, and a log that claimed
    // a tool ran because a sentence began with one would be lying about what
    // happened.
    const said = readOpencode(`${E}[0mLooking at the file paths, I can see…`);
    expect(said?.show).toBe("Looking at the file paths, I can see…");
    expect(said?.show).not.toContain("→");
  });

  it("says nothing for a line that was only colour", () => {
    // A blank line's worth of escape codes is not a line of log.
    expect(readOpencode(`${E}[0m${E}[90m${E}[0m`)).toBeUndefined();
  });

  it("keeps an error, which is usually why a turn produced nothing", () => {
    const said = readOpencode(
      `${E}[91m${E}[1mError: ${E}[0mFile not found: /src/components/TagCard.tsx`,
    );
    expect(said?.show).toContain("Error:");
    expect(said?.show).toContain("/src/components/TagCard.tsx");
  });

  it("keeps what a search found on the search's own line", () => {
    /*
     * `0 matches` on a line of its own says nothing: the reader has to look up
     * to find out what found nothing, and it is the half of a search that
     * matters.
     */
    const said = readOpencode(
      `${E}[0m${E}[0mGrep "component.tag"${E}[90m 100 matches${E}[0m`,
    );
    expect(said?.show).toBe("→ Grep(component.tag) · 100 matches");
  });

  it("drops the tool's own bullet, which the arrow already says", () => {
    const said = readOpencode(`${E}[0m→ ${E}[0mRead /src/components/TagChip.tsx`);
    expect(said?.show).toBe("→ Read(/src/components/TagChip.tsx)");
  });

  it("shortens an argument that would take the whole line", () => {
    const long = `/very/long/path/${"section/".repeat(20)}file.tsx`;
    const said = readOpencode(`${E}[0mRead ${long}${E}[0m`);
    expect(said?.show?.length).toBeLessThan(120);
    expect(said?.show).toContain("…");
  });
});
