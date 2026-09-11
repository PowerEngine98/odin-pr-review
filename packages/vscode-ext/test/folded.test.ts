import { describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph } from "@odin/core";

import { FoldedStore } from "../src/folded.js";
import { conversationKey, keyOf } from "../src/session.js";
import { forgetFrames, frames } from "./vscode-stub.js";

/** The editor's key-value store, as much of it as this uses. */
function memento() {
  const held: Record<string, unknown> = {};
  return {
    keys: () => Object.keys(held),
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
    held,
  };
}

/** A change with one file in it, which is enough to draw. */
function graphWith(meta: Record<string, unknown>): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { generator: "test", ...meta } as ChangeGraph["meta"],
    nodes: [
      {
        id: "n:one",
        path: "src/hooks/use-total.ts",
        status: "modified",
        language: "typescript",
        binary: false,
        stats: { additions: 1, deletions: 0 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [{ kind: "add", text: "const a = 1;", newLine: 1 }],
          },
        ],
      },
    ],
    edges: [],
  } as ChangeGraph;
}

/**
 * The view model out of a document, which is the only place it may arrive.
 *
 * Read the way the panel itself reads it back: the model is written into the
 * page as one assignment, so finding it there is the same as the page finding
 * it there.
 */
function modelIn(html: string): { folded?: string[] } | undefined {
  const opens = html.indexOf("window.__ODIN__=");
  if (opens < 0) return undefined;
  const from = opens + "window.__ODIN__=".length;
  const to = html.indexOf(";</script>", from);
  if (to < 0) return undefined;
  return JSON.parse(html.slice(from, to)) as { folded?: string[] };
}

/**
 * Two branches read live in one working tree keep their own folded folders.
 *
 * A live reading's tab is named after its checkout and deliberately not after a
 * branch: a working tree holds one HEAD, so there is one live picture of it.
 * That is the right answer to "which tab is this" and the wrong one to "what is
 * this a note about". Filed under the tab's name, the folds made against one
 * branch came back the moment another branch was read live in the same checkout
 * — a reader opening a change they had folded nothing on and finding half its
 * directories collapsed into folders that, on this branch, hold different files
 * or no files at all.
 */
describe("folds made on one branch read live in a checkout", () => {
  const reading = (headRef: string) => ({
    repo: "/repo",
    baseRef: "development",
    headRef,
    worktree: true,
  });

  it("are not inherited by the next branch read in the same working tree", () => {
    const one = reading("one");
    const two = reading("two");
    // The fault, stated as the fact it rests on: one tab name for two branches.
    expect(keyOf(one)).toBe(keyOf(two));

    const store = memento();
    const folds = new FoldedStore(store as never);

    folds.open(one.repo, one.baseRef, one.headRef, one.worktree);
    folds.set("src/hooks", true);
    folds.set("src/api", true);
    expect(folds.all()).toEqual(["src/api", "src/hooks"]);

    folds.open(two.repo, two.baseRef, two.headRef, two.worktree);
    expect(folds.all()).toEqual([]);

    // And the first branch's folds are still the first branch's, rather than
    // having been taken over by whichever was read last.
    folds.open(one.repo, one.baseRef, one.headRef, one.worktree);
    expect(folds.all()).toEqual(["src/api", "src/hooks"]);
  });

  it("still tells a live reading from a committed one", () => {
    // The same branch read two ways is two readings, and they do not hold the
    // same files: uncommitted work is in one picture and not in the other.
    const store = memento();
    const folds = new FoldedStore(store as never);

    folds.open("/repo", "development", "one", true);
    folds.set("src/hooks", true);

    folds.open("/repo", "development", "one");
    expect(folds.all()).toEqual([]);
  });
});

/**
 * A fold survives the page being rebuilt, without ever being seen to happen.
 *
 * The marks saying which files have been read travel as a message sent just
 * after the document is assigned, and that is tolerable for a tick in a corner.
 * A fold is not a tick: a bar leaves the stack at the top of the window and
 * every name below it moves up a header. Delivered that way, every folder the
 * reader had collapsed would be drawn open and then collapse while they
 * watched, on every single load.
 *
 * So this insists on both halves — that the host writes a fold down, and that
 * the next document it builds already carries it.
 */
describe("a folder folded on the canvas", () => {
  /**
   * One reading, drawn and then drawn again.
   *
   * Showing it a second time does not make a second tab: a reading already on
   * screen is rebuilt in place, which is the whole of the tab rule — and it is
   * also the moment being tested, because a rebuild is what the reader gets
   * after a save, a refresh or a window reload.
   */
  async function draw(where: string, folds: FoldedStore): Promise<void> {
    const { GraphPanel } = await import("../src/panel.js");
    GraphPanel.store = memento() as never;

    const graph = graphWith({ baseRef: "main", headRef: "topic" });
    GraphPanel.show(
      graph, layoutGraph(graph), "/repo",
      undefined, undefined, undefined, undefined, where, folds,
    );
  }

  it("reaches the store, and comes back in the document rather than after it", async () => {
    const store = memento();
    const folds = new FoldedStore(store as never);
    folds.open("/repo", "main", "topic");

    forgetFrames();
    await draw("repo=/repo base=main head=topic", folds);
    const frame = frames[0]!;

    // Nothing is folded yet, so the first document says nothing about folds:
    // absent and empty mean the same thing, because folders start open.
    expect(modelIn(frame.webview.html)?.folded).toBeUndefined();

    frame.say({ type: "folded", payload: { path: "src/hooks", folded: true } });

    // Written down, under what this change is rather than under which tab it is.
    const about = conversationKey({ repo: "/repo", baseRef: "main", headRef: "topic" });
    expect(store.held[`odin.folded:${about}`]).toEqual(["src/hooks"]);

    await draw("repo=/repo base=main head=topic", folds);
    // One tab still, holding a second document.
    expect(frames).toHaveLength(1);
    expect(frame.writes).toBe(2);

    // And the fold is in that document. Anything the page had to be told after
    // the fact would be the flash this exists to prevent.
    expect(modelIn(frame.webview.html)?.folded).toEqual(["src/hooks"]);
    expect(frame.sent.map((one) => one.type)).not.toContain("setFolded");
  });

  it("is forgotten again when the reader opens the folder out", async () => {
    const store = memento();
    const folds = new FoldedStore(store as never);
    folds.open("/repo", "main", "topic");

    forgetFrames();
    await draw("repo=/repo base=main head=topic opened", folds);
    const frame = frames[0]!;

    frame.say({ type: "folded", payload: { path: "src/hooks", folded: true } });
    frame.say({ type: "folded", payload: { path: "src/hooks", folded: false } });
    expect(folds.all()).toEqual([]);

    await draw("repo=/repo base=main head=topic opened", folds);
    expect(modelIn(frame.webview.html)?.folded).toBeUndefined();
  });
});

/**
 * One reading has two spellings, and its folds must not split between them.
 *
 * What the reader asks for and what the graph comes back with are not the same
 * string: a base given as `HEAD~1` is resolved to `main` by the time anything is
 * drawn, and a panel restored from a window reload is registered under the
 * spelling its own page wrote down while a rebuild arrives under the other. A
 * store keyed from the refs the reader typed would therefore hold two sets of
 * folds for one change, and the reader only ever sees one of them — so an
 * afternoon's folding simply appears to have been dropped.
 *
 * The host keys from `graph.meta`, the resolved pair, everywhere it points this
 * store at a reading. That is what this pins down.
 */
describe("a reading asked for one way and resolved another", () => {
  it("finds its folds again when it is reopened by the refs the reader typed", async () => {
    const store = memento();
    const folds = new FoldedStore(store as never);

    // The reader asked for `HEAD~1`; the build resolved it, and the graph came
    // back saying `main`. The store is pointed at what the graph said.
    const graph = graphWith({ baseRef: "main", headRef: "topic" });
    folds.open("/repo", graph.meta.baseRef, graph.meta.headRef, graph.meta.worktree);
    folds.set("src/hooks", true);

    // A window reload later the same reading is asked for the same way, and
    // resolves the same way. What the reader typed never comes into it.
    const rebuilt = graphWith({ baseRef: "main", headRef: "topic" });
    folds.open("/repo", rebuilt.meta.baseRef, rebuilt.meta.headRef, rebuilt.meta.worktree);
    expect(folds.all()).toEqual(["src/hooks"]);

    // And the document that reading builds carries them, even though the tab it
    // is registered under is named after the refs the reader asked for.
    forgetFrames();
    const { GraphPanel } = await import("../src/panel.js");
    GraphPanel.store = memento() as never;
    GraphPanel.show(
      rebuilt, layoutGraph(rebuilt), "/repo",
      undefined, undefined, undefined, undefined,
      "repo=/repo base=HEAD~1 head=topic",
      folds,
    );
    expect(modelIn(frames[0]!.webview.html)?.folded).toEqual(["src/hooks"]);

    // Keyed from the asked-for base instead, this is what the reader would have
    // been given: every folder open, and nothing saying why.
    folds.open("/repo", "HEAD~1", "topic");
    expect(folds.all()).toEqual([]);
  });
});
