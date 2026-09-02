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
    expect(source("session.ts")).toMatch(/live \? "live" : "committed"/);
    // One answer, shared. The panel registry and the store that survives a
    // reload have to agree on what "the same reading" means, or a restored
    // frame is paired with a change it never held.
    expect(panel).toMatch(/return keyOf\(\{/);
  });

  it("names a live reading after its checkout rather than a branch", () => {
    /*
     * A live reading has no branch of its own: it is the base against the files
     * on disk, and what is on disk is whatever HEAD happens to be. Named after
     * the branch it was built from, two of them could exist for one working
     * tree — open one, switch branch, open another — and only one of those can
     * ever be true. The other went on rebuilding from a working tree that no
     * longer held its branch, on every save, saying nothing.
     *
     * Two live pictures at once is a real thing to want, and git's own answer
     * is a second worktree: a second checkout, its own path, a different `repo`
     * here, and so a different reading by this same rule.
     */
    expect(source("session.ts")).toMatch(/live \? "" : reading\.headRef/);
    // The base stays in the name: one working tree read against `main` and
    // against `develop` is two questions, and both can be open at once.
    expect(source("session.ts")).toMatch(/reading\.baseRef,\s*\n\s*live \? "" : reading\.headRef/);
  });

  it("asks the forge about a pull request by its number", () => {
    /*
     * A reading of the forge's own copy is built from a tracking ref —
     * `origin/luis/lab-147` — and `gh pr view` given one of those finds
     * nothing. Nothing came back, nothing was updated, and nothing said so:
     * approving from inside Odin left the bar saying what it said before and
     * the reviewers panel showing the approver as pending.
     *
     * The pull request is already on screen, so its number is already known,
     * and a number is unambiguous in a way no ref is. Driven separately against
     * a forge that answers for the number and refuses the ref.
     */
    expect(panel).toMatch(/readPullRequest\(String\(known\.number\)/);
    expect(panel).not.toMatch(/const branch = this\.graph\.meta\.headRef;\s*\n\s*if \(!known \|\| !branch\)/);
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

/**
 * One change, one tab.
 *
 * A change is drawn in two passes: the cards as soon as the diff is read, the
 * arrows when they have been resolved. Both go through `GraphPanel.show`, which
 * finds the tab a reading is already in by a key made of the repository and the
 * branch names — so the two passes agree about which tab they belong in only
 * for as long as those names stay the same.
 *
 * They did not. Each stage of the build worked out the head ref for itself, and
 * with nobody having said what it is, the way it works it out is to ask the
 * checkout what branch it is on. Opening a remote pull request fetches, and may
 * add a worktree or check the branch out, between the two passes — so the
 * second pass computed a different key, found no tab under it, and opened
 * another. The reader asked for one change and got two tabs, one of them
 * showing the half-built picture from the first pass.
 */
describe("opening a change once", () => {
  const extension = source("extension.ts");
  const graph = source("graph.ts");
  const panel = source("panel.ts");

  it("settles what is being read before the build starts", () => {
    const at = extension.indexOf("const head = worktree");
    expect(at).toBeGreaterThan(-1);
    // And into the request, so no stage of the build has to guess again.
    const request = extension.slice(at, extension.indexOf("};", at));
    expect(request).toContain("headRef: head");
  });

  it("settles it before the first pass draws anything", () => {
    // After the first `present` it would be too late: that pass is the one that
    // makes the tab, and the key it makes it under is the one that has to last.
    expect(extension.indexOf("const head = worktree")).toBeLessThan(
      extension.indexOf("await present("),
    );
  });

  it("leaves the build's own fallback for callers that say nothing", () => {
    /*
     * The fallback stays: `graph.ts` is used by the command line too, where
     * nobody has resolved anything. What matters is that the editor no longer
     * reaches it twice for one reading.
     */
    expect(graph).toMatch(/request\.headRef \?\? \(await currentBranch/);
  });

  it("keys a tab on the reading rather than on the moment", () => {
    // The key is still the reading; what changed is that the reading now says
    // the same thing both times it is asked.
    expect(panel).toMatch(/graph\.meta\.headRef \? \{ headRef: graph\.meta\.headRef \}/);
  });
});
