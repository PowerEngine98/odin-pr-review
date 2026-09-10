import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fileDrafts, load, type Draft } from "../src/app/panels/drafts.js";

/**
 * Remarks that have not been sent yet, and the lines moving under them.
 *
 * The store renumbers the remarks it holds: each carries the passage it was
 * written against, and where that passage is now is a search of the file. These
 * are the ones it does not hold — a draft waiting on a verdict, and the box the
 * reader is typing into — and they were left on the numbers they were opened
 * at.
 *
 * In a live reading that is a real failure rather than an untidiness. An agent
 * takes an earlier remark and inserts nine lines; every line below moves; the
 * region the reader picked now covers different code, and nothing on screen
 * says so. Press send and the remark is filed against lines nobody looked at.
 */
function store() {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

describe("what a draft remembers", () => {
  it("keeps the code it was written against", () => {
    // The line number is a position; the text is an identity, and an identity
    // survives everything above it moving.
    const kept = store();
    const draft: Draft = {
      path: "src/one.ts",
      line: 4,
      startLine: 3,
      side: "RIGHT",
      body: "this loop is wrong",
      lines: ["  for (const item of items) {", "    sum += item.price;"],
    };
    fileDrafts("review", [draft], kept);

    expect(load("review", kept).drafts[0]?.lines).toEqual(draft.lines);
  });

  it("survives being written down and read back", () => {
    // Which is the whole of it: a draft outlives the window it was written in,
    // and an anchor that did not would be no anchor at all.
    const kept = store();
    fileDrafts(
      "review",
      [
        {
          path: "src/one.ts",
          line: 4,
          side: "RIGHT",
          body: "x",
          lines: ["  let sum = 0;"],
        },
      ],
      kept,
    );
    expect(load("review", kept).drafts[0]).toMatchObject({
      line: 4,
      lines: ["  let sum = 0;"],
    });
  });

  it("carries nothing for a remark about the file as a whole", () => {
    // There is no line to move, so there is nothing to anchor.
    const kept = store();
    fileDrafts("review", [{ path: "src/one.ts", side: "RIGHT", body: "x" }], kept);
    expect(load("review", kept).drafts[0]?.lines).toBeUndefined();
  });
});

describe("asking where the unsent remarks have got to", () => {
  /*
   * The page cannot answer this: only the host has the file. So what is checked
   * here is that the page asks, that it asks about both kinds, and that it does
   * the one thing it must do with the answer — leave a remark whose code has
   * gone exactly where it is.
   */
  const state = readFileSync(
    new URL("../src/app/state.svelte.ts", import.meta.url),
    "utf8",
  );

  it("asks again whenever the rows move", () => {
    // Which is the moment it stops being true, and the only moment the page is
    // told anything about the file having changed.
    expect(state).toContain("replaceAnchors();");
  });

  it("asks about the box being typed into, not only the filed drafts", () => {
    // The open composer is the one that matters most, because it is the one the
    // reader is looking at while an agent moves the ground under it.
    expect(state).toContain("id: COMPOSING,");
    expect(state).toContain("for (const draft of load(model.current.review).drafts)");
  });

  it("leaves a remark whose code has gone where it is", () => {
    /*
     * There is nowhere honest to move it to. Filing it against whatever now
     * sits on that line is the exact failure the anchoring exists to prevent,
     * and doing it silently would be worse than not moving anything at all.
     */
    expect(state).toContain("if (span.gone || span.line === undefined) return;");
  });
});
