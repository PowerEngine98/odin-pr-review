import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * A patch of rows that moved the cards it patched.
 *
 * The page draws a card at the width its arrangement gives it, not the width
 * written on the card, so rows that made a card wider were drawn in the box the
 * card had before: a line grown to a hundred and eleven characters on a live
 * reading was cut off with an ellipsis at about seventy-seven, although the
 * engine had measured the card at the new width and the card itself said so.
 * The host now sends the arrangements with the rows whenever they have moved,
 * and this is the half of that which lives in the page — without it the host
 * can send them all it likes and nothing is drawn any differently.
 */
describe("taking the new boxes with the new rows", () => {
  const state = read("../src/app/state.svelte.ts");
  const rows = state.slice(state.indexOf('case "rows"'), state.indexOf('case "pullRequest"'));

  it("replaces the arrangements the cards are drawn from", () => {
    expect(rows).toMatch(/model\.current\.arrangements = message\.arrangements/);
  });

  it("holds the reader's place before the cards move, not only when rows arrive", () => {
    // A card that widens pushes every column to its right across, and the
    // camera has to be told before that happens or the view slides with it.
    const hold = rows.indexOf("rebuilding.before?.()");
    const moves = rows.indexOf("model.current.arrangements = message.arrangements");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(moves);
    expect(rows.slice(0, hold + 30)).toMatch(/message\.arrangements\) rebuilding\.before/);
  });
});
