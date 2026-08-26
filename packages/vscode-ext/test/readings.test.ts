import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

/**
 * More than one change on screen at once.
 *
 * There used to be one panel and one only, which was not a simplification so
 * much as a consequence: opening a change meant checking it out, two readings
 * needed two working trees, and a working tree cannot be in two states at once.
 * Reading no longer moves anything, so nothing holds the limit up — and the
 * things that assumed it are the ones that break quietly rather than loudly.
 */
describe("keeping several readings apart", () => {
  const panel = source("panel.ts");
  const extension = source("extension.ts");

  it("keeps a panel per reading rather than one for the window", () => {
    expect(panel).toMatch(/static readonly open = new Map<string, GraphPanel>/);
    // The old singleton, gone rather than left beside the map for something to
    // fall back to.
    expect(panel).not.toMatch(/static current: GraphPanel \| undefined/);
  });

  it("tells two readings of one branch apart by how they are read", () => {
    // The same branch read live and read as committed are different pictures:
    // one follows the reader's typing and the other does not.
    expect(source("session.ts")).toMatch(/worktree === true \? "live" : "committed"/);
    // One answer, shared. The panel registry and the store that survives a
    // reload have to agree on what "the same reading" means, or a restored
    // frame is paired with a change it never held.
    expect(panel).toMatch(/return keyOf\(\{/);
  });

  it("gives each reading its own watcher", () => {
    // A single slot meant opening a second change tore down the first one's
    // watching on the way past — a graph that has quietly stopped following
    // edits, with nothing having gone wrong.
    expect(extension).toMatch(/const live = new Map<string, LiveGraph>/);
    expect(extension).toMatch(/live\.get\(key\)\?\.dispose\(\)/);
  });

  it("holds more than one extracted base at a time", () => {
    // Two readings off different bases would otherwise evict each other on
    // every rebuild, turning a cache into a guarantee of a full extraction per
    // keystroke.
    expect(source("graph.ts")).toMatch(/const bases = new Map<string, Checkout>/);
  });

  it("asks the panel which reading is in front, rather than remembering", () => {
    // "The last review opened" is the wrong tab the moment there is a second.
    expect(panel).toMatch(/static current\(\)/);
    expect(extension).toMatch(/GraphPanel\.current\(\) \?\? last/);
  });

  it("moves the file list when the reader turns to another reading", () => {
    expect(panel).toMatch(/static onActive/);
    expect(extension).toMatch(/GraphPanel\.onActive = \(graph, repo\) =>/);
  });

  it("stops watching a reading that has been closed", () => {
    expect(extension).toMatch(/GraphPanel\.onClosed = \(key\) =>/);
  });

  it("has the conversation in hand before the page is built", () => {
    /*
     * The document is built during construction, which after a window reload is
     * before anything has touched the pairing session. Reading a session that
     * happens to exist rendered the forge's comments and none of the reader's
     * own — they were on disk, loaded into memory a moment later when the page
     * asked which agents were installed, and then never sent anywhere.
     *
     * What the reader saw was every local conversation gone. Pinned by shape
     * rather than driven: what is being fixed is an ordering between two things
     * that both work, and there is no observable moment between them.
     */
    expect(panel).toMatch(/const local = this\.pairing\(\)\.local\(\)/);
    expect(panel).not.toMatch(/const local = this\.paired\?\.local\(\)/);
  });

  it("says what a tool can do once it knows which tools there are", () => {
    // The rungs, the labels, and which agents carry a conversation all depend
    // on discovery having happened. None of it was sent afterwards, so a
    // restored terminal offered a single "Ask" button.
    expect(panel).toMatch(/void this\.panel\.webview\.postMessage\(\{ type: "agents"[\s\S]{0,600}?this\.sendComments\(\)/);
  });
});
