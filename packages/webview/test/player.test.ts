import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The room either side of a player.
 *
 * The reported fault: the control sat against the card's dashed edges while
 * the title above it was inset like every other card's, so the recording read
 * as a thing stuck to the border rather than a thing on the card.
 *
 * Two halves, one in each package. This is the page's: the padding has to be
 * said in a way that survives the cascade. The engine's half — a card drawn
 * wide enough for the padding as well as the scrubber — is in the core suite,
 * where the card is actually laid out.
 */
const card = readFileSync(
  new URL("../src/app/canvas/Card.svelte", import.meta.url),
  "utf8",
);

describe("the space around a recording's player", () => {
  it("is said against the body, which is what the body's own rule loses to", () => {
    /*
     * `.card-body { padding: var(--padding) 0; }` is written further down this
     * sheet. A bare `.sound-view` ties with it on specificity and loses on
     * order, which is how the horizontal padding went missing while the
     * vertical one stayed: the declaration was there and never applied.
     */
    expect(card).toContain(".card-body.sound-view {");
    const at = card.indexOf(".card-body.sound-view {");
    const rule = card.slice(at, card.indexOf("}", at));
    expect(rule).toMatch(/padding:\s*var\(--padding/);
  });

  it("is not left to a selector the body outranks", () => {
    expect(card).not.toMatch(/\n\s*\.sound-view\s*\{/);
  });
});
