import { describe, expect, it } from "vitest";

import { keepsOpen, withoutMarker } from "../src/agents/settling.js";

/**
 * Whether an agent's answer ends the conversation.
 *
 * An answer normally does: the reader asked, the agent did the work and said
 * what it did. A thread left open after that is one more line on a list of a
 * hundred and eighty-five for somebody to close by hand, which nobody does, so
 * the list stops meaning anything.
 *
 * Not every answer is an ending, though, and only the agent knows which it has
 * written — so it says.
 */
describe("an agent leaving a thread open", () => {
  it("closes an ordinary answer", () => {
    expect(keepsOpen("Renamed it and updated the two call sites.")).toBe(false);
  });

  it("leaves one open when the answer says to", () => {
    expect(keepsOpen("Changed the obvious two.\n\nkeep-open")).toBe(true);
  });

  it("takes it however the agent spelled it", () => {
    for (const said of ["keep-open", "keep open", "[keep-open]", "@odin keep-open", "KEEP-OPEN"]) {
      expect(keepsOpen(`Done.\n${said}`)).toBe(true);
    }
  });

  it("does not read prose about the marker as the marker", () => {
    /*
     * The agents read this repository, so they write about this. An answer
     * explaining what `keep-open` does must not leave every thread open.
     */
    expect(
      keepsOpen("A line reading keep-open on its own leaves the thread open."),
    ).toBe(false);
    expect(keepsOpen("I would keep open the third one too.")).toBe(false);
  });

  it("finds it wherever in the answer it was put", () => {
    expect(keepsOpen("keep-open\n\nStill waiting on the generated code.")).toBe(true);
  });

  it("says nothing about an answer that is nothing", () => {
    expect(keepsOpen("")).toBe(false);
  });
});

describe("what the reader is shown of it", () => {
  it("takes the marker out of the answer", () => {
    // It is an instruction to Odin, not something said to the reader: a
    // conversation ending in a stray word reads as a mistake.
    expect(withoutMarker("Changed the obvious two.\n\nkeep-open")).toBe(
      "Changed the obvious two.",
    );
  });

  it("leaves an answer that has none exactly as it was", () => {
    const said = "Renamed it.\n\n  Indented line kept.";
    expect(withoutMarker(said)).toBe(said);
  });

  it("does not leave a hole where the line was", () => {
    expect(withoutMarker("First.\n\nkeep-open\n\nSecond.")).toBe("First.\n\nSecond.");
  });
});
