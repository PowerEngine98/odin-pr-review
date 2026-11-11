import { beforeEach, describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph, type PullRequestSummary } from "@odin/core";

import { forgetFrames, forgetRan, frames, makeView } from "./vscode-stub.js";

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
    sidebar.setPart(GraphPanel.activePart());
  };
  GraphPanel.onPart = (paths) => sidebar.setPart(paths);
  GraphPanel.onNone = () => sidebar.forgetChange();

  /** Opening a change, list and all, as `present` does at the end of a build. */
  const open = (headRef: string, path: string) => {
    const graph = graphWith(headRef, path);
    GraphPanel.show(
      graph, layoutGraph(graph), "/repo",
      undefined, undefined, undefined, undefined, `repo=/repo head=${headRef}`,
    );
    sidebar.setGraph(graph);
    return { tab: frames[frames.length - 1]!, graph };
  };

  forgetRan();
  return { GraphPanel, sidebar, view, open };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("the side list beside two readings", () => {
  beforeEach(() => {
    forgetFrames();
    forgetRan();
  });

  it("is narrowed only by the reading in front", async () => {
    const { view, open } = await editor();
    const behind = open("feat/alpha", "src/alpha.ts");
    const front = open("feat/beta", "src/beta.ts");
    expect(view.webview.html).toContain("src/beta.ts");

    behind.tab.say({ type: "part", payload: { paths: ["src/alpha.ts"] } });
    await settled();
    expect(view.webview.html).toContain("src/beta.ts");

    front.tab.say({ type: "part", payload: { paths: ["src/nothing.ts"] } });
    await settled();
    expect(view.webview.html).not.toContain("src/beta.ts");

    front.tab.say({ type: "part", payload: { paths: null } });
    await settled();
    expect(view.webview.html).toContain("src/beta.ts");
  });

  it("knows the part each reading has open, for when the reader turns back to it", async () => {
    const { GraphPanel, open } = await editor();
    const behind = open("feat/alpha", "src/alpha.ts");
    open("feat/beta", "src/beta.ts");
    behind.tab.say({ type: "part", payload: { paths: ["src/alpha.ts"] } });
    await settled();
    expect(GraphPanel.activePart()).toBeUndefined();
  });

  it("is not taken over by a reading rebuilt behind the one in front", async () => {
    const { GraphPanel, open } = await editor();
    const behind = open("feat/alpha", "src/alpha.ts");
    const front = open("feat/beta", "src/beta.ts");
    expect(GraphPanel.inFront(behind.graph, "/repo", "repo=/repo head=feat/alpha")).toBe(false);
    expect(GraphPanel.inFront(front.graph, "/repo", "repo=/repo head=feat/beta")).toBe(true);
  });
});
