import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderSidebar } from "../src/sidebar.js";
import type { SidebarModel } from "../src/sidebar-model.js";

/**
 * A reading applied to the page that is already showing one.
 *
 * The host used to assign a new document to the view for every redraw, and a
 * live reading is rebuilt on every watched save — so the strip was replaced
 * several times a minute and everything the reader had arranged in it went with
 * the old document: the references unfolded under a file, how far down they had
 * scrolled, what was in the filter box.
 *
 * None of that is in the model, and that is exactly why it survives now: the
 * host sends the model and the page assigns it, so the components redraw the
 * rows that changed and nothing else is touched. What can be checked from here
 * is the contract between the two sides — the message the host sends and the
 * document it builds have to match what the page looks for, and neither half
 * can see the other.
 */
const SIDEBAR = new URL("../src/app/sidebar/", import.meta.url);
const state = readFileSync(new URL("state.svelte.ts", SIDEBAR), "utf8");

const MODEL: SidebarModel = {
  loading: false,
  picker: {
    mine: [],
    everythingElse: [],
    asked: { state: "open", author: "" },
    viewer: "",
    reached: true,
  },
  change: {
    tree: { label: "", folders: [], files: [] },
    totals: { additions: 0, deletions: 0, authors: "", authorsFull: "" },
    reading: { branch: "topic", local: true },
  },
};

describe("a reading arriving as a message", () => {
  it("is applied to the model the components are watching", () => {
    // One object, assigned. Anything that rebuilt the components from it, or
    // reached into the tree to patch rows, would be a second description of the
    // change for the two sides to disagree about.
    expect(state).toMatch(/if \(message\.type === "model" && message\.model\)/);
    expect(state).toMatch(/export function apply\(next: SidebarModel\): void \{\n\s*model\.current = next;/);
  });

  it("measures the reveal again, because the tree may have changed shape", () => {
    /*
     * The one piece of state that is about the tree rather than about the
     * reader. Its openings name folder rows, and a rebuilt tree can have
     * renamed them — the list joins a chain of directories holding nothing else
     * into one row, so a file appearing along such a chain splits it in two.
     */
    expect(state).toContain("remeasured(folders.folds, tree)");
    expect(state).toContain("movedTo(folders.folds, tree, at)");
  });

  it("still wakes up by adopting the markup it was handed", () => {
    // The document path has not gone anywhere: it is what the view is given
    // when it first resolves, and `mount` would draw a second copy of
    // everything beside the first.
    const main = readFileSync(new URL("../src/app/sidebar-main.ts", import.meta.url), "utf8");
    expect(main).toContain("hydrate(Sidebar, { target })");
  });
});

describe("the palette, which the model cannot carry", () => {
  it("is a stylesheet the document names, and the page replaces by that name", () => {
    /*
     * Two sides and one string between them. The host renders the vocabulary
     * into the head and later sends a new one; the page writes it into the same
     * element rather than appending another, so a reader who switches theme
     * twice does not end up with three sets of the same variables and the first
     * one winning. A drift in the name is silent — the page would quietly grow a
     * stylesheet per flip — so it is pinned from both ends.
     */
    expect(renderSidebar(MODEL)).toContain('<style id="odin-tokens">');
    expect(state).toContain('document.getElementById("odin-tokens")');
    expect(state).toContain("held.textContent = css");
  });
});
