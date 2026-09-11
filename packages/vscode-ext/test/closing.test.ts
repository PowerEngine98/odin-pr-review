import { beforeEach, describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph, type PullRequestSummary } from "@odin/core";

import { contextOf, forgetFrames, forgetRan, frames, makeView } from "./vscode-stub.js";

/** A change with one file in it, named after the branch so two can be told apart. */
function graphWith(headRef: string, path: string): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { generator: "test", baseRef: "main", headRef },
    nodes: [
      {
        id: `n:${path}`,
        path,
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

/** A store that forgets nothing, which the pairing session and the marks want. */
function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
  };
}

/** One pull request to choose from, so the list has something to show. */
const WAITING: PullRequestSummary = {
  number: 214,
  title: "Something else entirely",
  branch: "feat/other",
  url: "https://example.invalid/214",
  author: "grace",
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z",
} as PullRequestSummary;

/**
 * The panel and the bar beside it, wired the way activation wires them.
 *
 * Both halves are the real thing: the fault is in what one says to the other
 * when a tab closes, so a test that stood in for either side would be testing
 * its own stand-in. What is stubbed is the editor underneath them.
 */
async function editor() {
  const { GraphPanel } = await import("../src/panel.js");
  const { ChangeSidebar } = await import("../src/sidebar.js");
  const { ViewedStore } = await import("../src/viewed.js");

  // Whatever the last test left on screen. The registry is one map for the
  // module, and a reading left open would be a reading this test did not open.
  for (const held of GraphPanel.readings()) held.dispose();

  GraphPanel.store = memento() as never;
  const viewed = new ViewedStore(memento() as never);
  const sidebar = new ChangeSidebar(viewed);
  const view = makeView();
  sidebar.resolveWebviewView(view as never);
  sidebar.setPullRequests([WAITING], "main", "/repo", "marcoacosta");

  GraphPanel.onActive = (graph, repo) => {
    viewed.open(repo, graph.meta.baseRef, graph.meta.headRef);
    sidebar.setGraph(graph);
  };
  GraphPanel.onNone = () => sidebar.forgetChange();

  /** Opening a change, list and all, as `present` does at the end of a build. */
  const open = (headRef: string, path: string) => {
    const graph = graphWith(headRef, path);
    GraphPanel.show(
      graph, layoutGraph(graph), "/repo",
      undefined, undefined, undefined, undefined, `repo=/repo head=${headRef}`,
    );
    sidebar.setGraph(graph);
    return frames[frames.length - 1]!;
  };

  forgetRan();
  return { GraphPanel, sidebar, view, open };
}

/**
 * What the bar shows once the drawing has been closed.
 *
 * The list of files belongs to a reading, and closing the tab was the one way
 * of ending a reading that nothing outside the panel was ever told about. The
 * bar is moved by the reader turning from one tab to another, and a tab that
 * has gone cannot report being turned away from — so a reviewer who decided
 * they were done with a change, and shut it, kept its file list: rows offering
 * to open files of a reading that existed nowhere else in the window, and a
 * button back to a drawing that was not there.
 *
 * Two changes at once is a supported thing, so the answer is not simply to
 * empty the bar: with another reading still open the list becomes that one's,
 * which is the same answer turning to its tab would have given.
 */
describe("closing the drawing a list belongs to", () => {
  beforeEach(() => {
    forgetFrames();
    forgetRan();
  });

  it("goes back to the pull requests when the last reading is closed", async () => {
    const { view, open } = await editor();
    const tab = open("feat/alpha", "src/alpha.ts");
    expect(view.webview.html).toContain("src/alpha.ts");

    tab.dispose();

    expect(view.webview.html).not.toContain("src/alpha.ts");
    // And the list the reader started from is what is there instead, rather
    // than an empty bar saying nothing about what else there is to read.
    expect(view.webview.html).toContain("Something else entirely");
  });

  it("says there is no change left, so the title bar stops offering one", async () => {
    // The way back to the file list is a button the editor draws from these,
    // and a button onto a reading that has been closed leads nowhere.
    const { open } = await editor();
    open("feat/alpha", "src/alpha.ts").dispose();

    expect(contextOf("odin.hasGraph")).toBe(false);
    expect(contextOf("odin.onChooser")).toBe(true);
  });

  it("shows the reading still open when one of several is closed", async () => {
    const { view, open } = await editor();
    open("feat/alpha", "src/alpha.ts");
    const second = open("feat/beta", "src/beta.ts");
    expect(view.webview.html).toContain("src/beta.ts");

    second.dispose();

    // The other change, not the chooser: the reader has two open for a reason
    // and closing one of them is not a decision about the other.
    expect(view.webview.html).toContain("src/alpha.ts");
    expect(view.webview.html).not.toContain("src/beta.ts");
    expect(contextOf("odin.hasGraph")).toBe(true);
    expect(contextOf("odin.onChooser")).toBe(false);
  });

  it("leaves the bar alone when the tab closed was not the one in front", async () => {
    // Closing a tab in the background takes nothing away that the reader can
    // see, and moving the list for one would pull the bar off the change they
    // are actually reading.
    const { view, open } = await editor();
    const first = open("feat/alpha", "src/alpha.ts");
    open("feat/beta", "src/beta.ts");

    first.dispose();

    expect(view.webview.html).toContain("src/beta.ts");
    expect(view.webview.html).not.toContain("src/alpha.ts");
  });

  it("reaches the pull requests when the readings are closed one by one", async () => {
    const { view, open } = await editor();
    const first = open("feat/alpha", "src/alpha.ts");
    const second = open("feat/beta", "src/beta.ts");

    second.dispose();
    first.dispose();

    expect(view.webview.html).not.toContain("src/alpha.ts");
    expect(view.webview.html).not.toContain("src/beta.ts");
    expect(view.webview.html).toContain("Something else entirely");
  });

  it("asks the reading it moved to which part of itself it is showing", async () => {
    /*
     * A drawing can be showing one part of a large change rather than all of
     * it, and only its page knows which. Taken over without asking, the bar
     * would list forty files beside a drawing showing five — and the editor's
     * own focus event cannot be left to ask, because it returns early once the
     * reading it would report is already the one in front, which this made it.
     */
    const { open } = await editor();
    const first = open("feat/alpha", "src/alpha.ts");
    const second = open("feat/beta", "src/beta.ts");

    second.dispose();

    expect(frames[0]!.sent.some((one) => one.type === "sayPart")).toBe(true);
  });
});

/**
 * The two halves, actually joined.
 *
 * Everything above drives the panel and the bar with the wiring written out
 * beside it, which proves what each says to the other and not that activation
 * ever introduces them. The panel deliberately knows nothing about a sidebar —
 * it offers a hook and the extension fills it — so the one thing left to check
 * is that something does.
 */
describe("wiring the closed reading to the bar", () => {
  it("hands the empty case to the list at activation", async () => {
    const { readFileSync } = await import("node:fs");
    const extension = readFileSync(
      new URL("../src/extension.ts", import.meta.url), "utf8",
    );
    expect(extension).toMatch(/GraphPanel\.onNone = \(\) => sidebar\.forgetChange\(\)/);
  });
});

/**
 * A reading the reader shut, on the next window reload.
 *
 * Restoring tabs is the whole point of the remembered list, and a change closed
 * on purpose is the one thing in it that should not come back: it was a
 * decision, and replaying it hands the reader a rebuild of something they had
 * finished with. Every other reading in the list still returns.
 */
describe("what a closed reading leaves behind for the next reload", () => {
  it("drops the one that was closed and keeps the rest", async () => {
    const { SessionStore, keyOf } = await import("../src/session.js");
    const store = new SessionStore(memento() as never);
    const at = new Date().toISOString();

    store.remember({ repo: "/repo", baseRef: "main", headRef: "feat/alpha" });
    store.remember({ repo: "/repo", baseRef: "main", headRef: "feat/beta" });
    expect(store.readings()).toHaveLength(2);

    store.forget(keyOf({ repo: "/repo", baseRef: "main", headRef: "feat/beta" }));

    const left = store.readings();
    expect(left.map((one) => one.headRef)).toEqual(["feat/alpha"]);
    expect(Date.parse(left[0]!.at)).toBeGreaterThanOrEqual(Date.parse(at) - 1000);
  });
});
