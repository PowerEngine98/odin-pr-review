import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
