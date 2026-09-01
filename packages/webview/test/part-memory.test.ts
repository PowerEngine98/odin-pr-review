import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const state = readFileSync(
  new URL("../src/app/state.svelte.ts", import.meta.url),
  "utf8",
);
const tabs = readFileSync(
  new URL("../src/app/chrome/Tabs.svelte", import.meta.url),
  "utf8",
);
const main = readFileSync(
  new URL("../src/app/main.ts", import.meta.url),
  "utf8",
);

/**
 * The tab the reader had open, after a reload.
 *
 * A reader who narrows a change of two hundred files to the five they are
 * reviewing, and then reloads the window, was dropped back in front of all two
 * hundred — the place they chose gone, and the whole change built again to show
 * them what they had stepped out of. A part is a smaller drawing, so restoring
 * it is both where they were and less to build.
 *
 * This reads the source, as the tests for the other runes modules do: `$state`
 * cannot be imported here. What it can check is that each half of the bargain
 * is written down — the choosing writes, the waking reads, and neither is a
 * guess about a part that may not exist any more.
 */
describe("remembering which part was open", () => {
  it("writes the choice down where a reload can find it", () => {
    // Written where a tab is pressed, which is the only place a reader changes
    // it: everything else that moves the part is the page correcting itself.
    expect(tabs).toMatch(/function openPart[\s\S]*?keep\(\{ part: id \}\)/);
  });

  it("reads it back as the page wakes up", () => {
    expect(main).toMatch(/restorePart\(\)/);
    // After the channel is open, or the file list beside the drawing is never
    // told that the drawing has narrowed.
    expect(main.indexOf("listen()")).toBeLessThan(main.indexOf("restorePart()"));
  });

  it("only opens a part the change still has", () => {
    /*
     * A rebuilt change can have lost the chain a tab stood for — its files
     * deleted, its imports rearranged. Opening a tab that is not there is a
     * drawing of nothing with no way back to the whole.
     */
    expect(state).toMatch(/parts\.some\(\(part\) => part\.id === wanted\)/);
    expect(state).toMatch(/if \(!parts\.some[\s\S]{0,40}return;/);
  });

  it("narrows the file list with it", () => {
    // The list beside the canvas is the host's and does not know a part was
    // reopened unless it is told — the same message pressing the tab sends.
    expect(state).toMatch(
      /export function restorePart[\s\S]*?notify\("part", \{ paths: partPaths\(model\.current, wanted\) \}\)/,
    );
  });

  it("says nothing when the reader last chose the whole change", () => {
    // "Everything" is a choice, and restoring it is doing nothing — the page
    // already opens there.
    expect(state).toMatch(/if \(wanted === undefined \|\| wanted === null\) return;/);
  });
});
