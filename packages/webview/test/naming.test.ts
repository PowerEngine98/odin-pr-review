import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SEEN_FADE } from "../src/app/marks/marks.js";

/**
 * The names cards wear when the reader pulls back.
 *
 * Far enough out and a card is a coloured block with nothing readable in it, so
 * it says its filename instead — that is how a drawing of a hundred files stays
 * searchable. Which also means the names are for finding what is left: a file
 * already marked read is not what anybody is looking for, and at that distance
 * a hundred labels overlap each other and the ones that still matter.
 *
 * So a read file goes quiet, and the drawing empties as the review goes on.
 *
 * This reads the source, because the rule lives in a `$derived` inside a
 * component and there is no card to render without a canvas. What it cannot
 * prove was measured in a browser instead: pulled back over 48 cards, 48 names;
 * 24 files marked read by the host, 24 names, the same 48 cards, no errors.
 */
const card = readFileSync(
  new URL("../src/app/canvas/Card.svelte", import.meta.url),
  "utf8",
);

describe("a card's name at a distance", () => {
  it("is not worn by a file the reader has finished with", () => {
    expect(card).toContain("const named = $derived(simplified && !viewed)");
  });

  it("knows whether the file was read before it decides", () => {
    /*
     * Order matters here in a way it does not elsewhere in the file. Both are
     * `const`, and a `$derived` that reaches a name declared further down the
     * script throws on the first read — which in Svelte takes the whole card
     * down silently, leaving a blank where the drawing was.
     */
    expect(card.indexOf("const viewed = $derived")).toBeGreaterThan(-1);
    expect(card.indexOf("const viewed = $derived")).toBeLessThan(
      card.indexOf("const named = $derived"),
    );
  });

  it("still names every card that has not been read", () => {
    // The rule this does not undo: an earlier version hid names wider than
    // their own card, and a drawing where two thirds of the blocks are
    // anonymous cannot be searched at all.
    const at = card.indexOf("const named = $derived");
    const line = card.slice(at, card.indexOf("\n", at));
    expect(line).not.toMatch(/width|wider|fits|room/);
  });
});

/**
 * And the conversations on a file already read.
 *
 * The same statement as the name going quiet, made about the other thing on the
 * drawing that says "look here". Measured in a browser: two marks at 26px and
 * full opacity; the host marks the file read; the same two marks at 18px and
 * 0.45, with nothing on window.onerror.
 */
const mark = readFileSync(
  new URL("../src/app/marks/Mark.svelte", import.meta.url),
  "utf8",
);
const layer = readFileSync(
  new URL("../src/app/marks/Marks.svelte", import.meta.url),
  "utf8",
);

describe("a mark on a file at a distance", () => {
  it("is measured at the smaller size rather than shrunk afterwards", () => {
    // The mark is placed against the card's edge with room for its own tail. A
    // mark shrunk by a transform after placement sits with a gap where the tail
    // used to reach.
    expect(layer).toContain("const own = seenSize(size, seen)");
    expect(layer).toMatch(/placeMark\(box, heightOf\(card, root\), own, room\)/);
  });

  it("comes back to full strength when somebody reaches for it", () => {
    // A mark that stayed faint under the pointer reads as one that cannot be
    // pressed.
    expect(mark).toMatch(/\.mark\.seen:hover[\s\S]{0,80}opacity: 1/);
  });

  it("does not stand back while its own conversation is open", () => {
    expect(mark).toContain("class:seen={seen && !open}");
  });
});

describe("how faint a mark on a read file is", () => {
  it("is driven by one number rather than two that must agree", () => {
    // It was written into the stylesheet as a literal beside the constant that
    // named it, which is two answers to one question and a change that only
    // half lands.
    expect(mark).toContain("--seen-fade:{SEEN_FADE}");
    expect(mark).toContain("opacity: var(--seen-fade");
  });

  it("is a trace rather than a dimmed portrait", () => {
    // Half strength was the first attempt, and on a dark canvas a round
    // portrait in full colour reads as something to look at whatever its
    // opacity says. Nothing is lost at this: it comes back under the pointer.
    expect(SEEN_FADE).toBeLessThan(0.3);
    expect(SEEN_FADE).toBeGreaterThan(0.1);
  });
});
