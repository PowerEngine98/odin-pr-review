import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { partPaths } from "../src/app/parts.js";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const model = {
  nodes: [
    { id: "n:a", path: "src/Carousel.tsx" },
    { id: "n:b", path: "src/CarouselDots.tsx" },
    { id: "n:c", path: "src/elsewhere.ts" },
  ],
  parts: [
    { id: "n:a", nodes: ["n:a", "n:b"] },
    { id: "n:c", nodes: ["n:c"] },
  ],
};

describe("which files a part is showing", () => {
  it("is every file in it, by path", () => {
    expect(partPaths(model, "n:a")).toEqual([
      "src/Carousel.tsx",
      "src/CarouselDots.tsx",
    ]);
  });

  it("is the whole change when nothing is narrowed", () => {
    expect(partPaths(model, null)).toBeNull();
  });

  it("is the whole change when the part has gone", () => {
    // A rebuild can break a chain up or delete the file a part was named
    // after. Narrowing to an id that no longer exists would show an empty list.
    expect(partPaths(model, "n:gone")).toBeNull();
  });

  it("names a file that has just joined the part", () => {
    // The reason the paths are re-read on every rebuild rather than
    // remembered: a renamed file whose new import joins the chain belongs in
    // the list the moment it belongs in the drawing.
    const after = {
      nodes: [...model.nodes, { id: "n:d", path: "src/ItemNavigator.tsx" }],
      parts: [{ id: "n:a", nodes: ["n:a", "n:b", "n:d"] }],
    };
    expect(partPaths(after, "n:a")).toContain("src/ItemNavigator.tsx");
  });

  it("ignores an id the graph no longer has a file for", () => {
    const stale = { nodes: model.nodes, parts: [{ id: "n:a", nodes: ["n:a", "n:x"] }] };
    expect(partPaths(stale, "n:a")).toEqual(["src/Carousel.tsx"]);
  });
});

/**
 * The list beside the drawing, after the drawing has been rebuilt.
 *
 * The host drops whatever the list was narrowed to whenever a new graph
 * arrives — it has a fresh set of parts and no way to know one of them is the
 * part the reader still has open. So the page says it again, and until it did,
 * an agent finishing an edit left the canvas showing six files and the list
 * beside it showing all hundred and twenty-nine.
 */
describe("keeping the list on the part after a rebuild", () => {
  const state = read("../src/app/state.svelte.ts");

  it("says which part is open when a new model arrives", () => {
    // After the swap, so the parts it reads are the rebuilt ones.
    const swap = state.indexOf("model.current = next;");
    expect(swap).toBeGreaterThan(-1);
    expect(state.indexOf("samePart()", swap)).toBeGreaterThan(swap);
  });

  it("works the paths out from the new graph, not the old ones", () => {
    expect(state).toMatch(/function samePart\(\)[\s\S]{0,300}partPaths\(model\.current, ui\.part\)/);
  });

  it("says it again after the small patch too, not only the whole model", () => {
    /*
     * The one that was missed, and the one that matters most: a save that moved
     * no arrows patches a few cards' rows and sends nothing else. The host
     * takes the list back to the whole change on every rebuild whichever
     * message it sent — so on a live reading the list widened again every few
     * seconds while the drawing beside it stayed on the part.
     */
    const rows = state.indexOf('case "rows"');
    const next = state.indexOf('case "pullRequest"', rows);
    expect(rows).toBeGreaterThan(-1);
    expect(state.slice(rows, next)).toContain("samePart()");
  });

  it("answers the host when it asks which part is open", () => {
    // Switching tabs hands the list to another reading, which resets it. The
    // page that has the part open is the only thing that knows.
    expect(state).toMatch(/case "sayPart":[\s\S]{0,80}samePart\(\)/);
  });

  it("lets go of a part that the rebuild dissolved", () => {
    expect(state).toMatch(/if \(ui\.part && paths === null\) ui\.part = null/);
  });

  it("is the same rule the strip applies when a tab is pressed", () => {
    const tabs = read("../src/app/chrome/Tabs.svelte");
    expect(tabs).toMatch(/notify\("part", \{ paths: partPaths\(model\.current, id\) \}\)/);
  });
});
