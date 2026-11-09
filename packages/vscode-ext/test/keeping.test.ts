import { describe, expect, it } from "vitest";

import type { ChangeGraph, FileNode } from "@odin/core";

import { ChangeSidebar } from "../src/sidebar.js";
import { ViewedStore } from "../src/viewed.js";
import { flipTheme, makeView } from "./vscode-stub.js";

/**
 * A live reading refreshed, and what the strip beside it keeps.
 *
 * The reported fault: on a live reading — the one rebuilt on every watched save
 * — the folders the reader had collapsed in the side list came back open. What
 * was behind it is that every redraw assigned a new document to the view, so
 * the whole page was thrown away and built again several times a minute: the
 * references unfolded under a file, how far down the list the reader had
 * scrolled and whatever was in the filter box all went with it, because none of
 * those are in the model.
 *
 * So a redraw is a message now, and these are the two halves of that: the host
 * only rebuilds the document when there is no live page to send to, and when
 * there is one it sends the whole model rather than a patch — the page is drawn
 * from one object and watching it, so the rows that changed are the rows that
 * redraw.
 */
function file(path: string): FileNode {
  return {
    id: `n:${path}`,
    path,
    status: "modified",
    language: "typescript",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    symbols: [],
    hunks: [],
  } as FileNode;
}

function graphWith(...paths: string[]): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { generator: "test", baseRef: "main", headRef: "topic", worktree: true },
    nodes: paths.map(file),
    edges: [],
  } as ChangeGraph;
}

/** The editor's key-value store, as much of it as the marks want. */
function memento() {
  const held: Record<string, unknown> = {};
  return {
    keys: () => Object.keys(held),
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
  };
}

/** The list, resolved into a view, with the page in it awake unless said. */
function listening(awake = true) {
  const store = new ViewedStore(memento() as never);
  store.open("/work/app", "main", "topic");
  const sidebar = new ChangeSidebar(store);
  const view = makeView();
  sidebar.resolveWebviewView(view as never);
  // What the page says for itself once its script has parsed. Everything the
  // host does differently afterwards hangs on having heard it.
  if (awake) view.say({ type: "ready" });
  return { sidebar, view };
}

/** The models the view has been sent, in order. */
function models(view: ReturnType<typeof makeView>) {
  return view.sent.filter((one) => one.type === "model") as {
    type: string;
    model: { change?: { tree: unknown } };
  }[];
}

/** The file paths in a tree the host sent, however deeply nested. */
function paths(folder: unknown): string[] {
  const one = folder as {
    files: { path: string }[];
    folders: unknown[];
  };
  return [
    ...one.files.map((f) => f.path),
    ...one.folders.flatMap((child) => paths(child)),
  ];
}

describe("a reading refreshed under a page that is already up", () => {
  it("sends the new reading rather than a new document", () => {
    /*
     * The fault itself. A live reading is rebuilt on every save, and a document
     * assigned per save is a strip that resets itself while the reader is using
     * it — several times a minute, for as long as they are typing.
     */
    const { sidebar, view } = listening();
    const first = view.drawn.length;

    sidebar.setGraph(graphWith("src/one.ts"));
    sidebar.setGraph(graphWith("src/one.ts", "src/two.ts"));

    expect(view.drawn.length).toBe(first);
    expect(models(view)).toHaveLength(2);
  });

  it("sends the whole model, so the page has everything it draws from", () => {
    // Not a patch. The page is drawn from one object and watching it, so what
    // changed is worked out there, by the components that know which rows they
    // are — and a message that carried only the difference would be a second
    // description of the change for the two sides to disagree about.
    const { sidebar, view } = listening();
    sidebar.setGraph(graphWith("src/one.ts", "test/one.test.ts"));

    const sent = models(view).at(-1)!.model;
    expect(paths(sent.change!.tree).sort()).toEqual([
      "src/one.ts",
      "test/one.test.ts",
    ]);
  });

  it("says so for every other reason the list redraws, not only a refresh", () => {
    /*
     * Opening a part of the change, the orange dots arriving from the forge,
     * stepping over to the chooser and back. Each of those used to cost the
     * reader's place in the list as well.
     */
    const { sidebar, view } = listening();
    sidebar.setGraph(graphWith("src/one.ts", "src/two.ts"));
    const drawn = view.drawn.length;

    sidebar.setPart(["src/one.ts"]);
    sidebar.setFresh({ paths: ["src/one.ts"], means: "uncommitted" } as never);
    sidebar.showChooser();
    sidebar.showChanges();

    expect(view.drawn.length).toBe(drawn);
    expect(models(view).length).toBeGreaterThanOrEqual(5);
  });
});

describe("a view with no page listening in it", () => {
  it("is given a document, because a message would be dropped", () => {
    /*
     * A webview that is still parsing its bundle hears nothing: the message is
     * dropped, silently and for good. So until the page says `ready` the list is
     * drawn the old way, which costs nothing — there is no arrangement in a page
     * that has not appeared yet.
     */
    const { sidebar, view } = listening(false);
    const drawn = view.drawn.length;

    sidebar.setGraph(graphWith("src/one.ts"));

    expect(view.drawn.length).toBe(drawn + 1);
    expect(view.drawn.at(-1)).toContain("src/one.ts");
    expect(models(view)).toHaveLength(0);
  });

  it("goes back to sending once the new page says it is up", () => {
    const { sidebar, view } = listening(false);
    sidebar.setGraph(graphWith("src/one.ts"));
    view.say({ type: "ready" });
    const drawn = view.drawn.length;

    sidebar.setGraph(graphWith("src/one.ts", "src/two.ts"));

    expect(view.drawn.length).toBe(drawn);
    expect(models(view)).toHaveLength(1);
  });
});

describe("the colours, which no model can carry", () => {
  it("sends the new palette rather than rebuilding the page for it", () => {
    /*
     * The one part of the document that is not something a component draws: the
     * vocabulary is a stylesheet in the head, so a page kept alive across every
     * reading would otherwise hold the theme it was built in for as long as it
     * lived. A reader's folds and filter are not something to spend on a change
     * of colour either, so it arrives the same way everything else does.
     */
    const { view } = listening();
    const drawn = view.drawn.length;

    flipTheme();

    const painted = view.sent.filter((one) => one.type === "tokens") as {
      css: string;
    }[];
    expect(painted).toHaveLength(1);
    expect(painted[0]!.css).toContain("--added");
    expect(view.drawn.length).toBe(drawn);
  });
});
