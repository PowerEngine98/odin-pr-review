import { beforeEach, describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph } from "@odin/core";

import { forgetFrames, frames } from "./vscode-stub.js";

/**
 * One change, one tab.
 *
 * A change is drawn in two passes: the cards as soon as the diff is read, the
 * arrows once they have been resolved. Both go through `GraphPanel.show`, and
 * which tab a pass landed in was worked out from the graph it carried — but a
 * graph says what its refs turned out to be, and that is not what was asked for
 * while a build is still fetching and checking out.
 *
 * Opening a remote pull request does exactly that between the two passes, so
 * the second pass named the reading differently, found no tab under that name,
 * and asked the editor for another. One change, two tabs, the spare one holding
 * the half-built picture the first pass drew.
 *
 * How many tabs that is cannot be read off the source: it is a count of what
 * the editor was asked to make. So the stub records the asking, and this counts
 * it — which is the part of an end-to-end harness this fault actually needed.
 */
/** A change with one file in it, which is enough to draw. */
function graphWith(meta: Record<string, unknown>): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { generator: "test", ...meta } as ChangeGraph["meta"],
    nodes: [
      {
        id: "n:one",
        path: "src/a.ts",
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

/** The graph and the arrangement it lays out to, which `show` wants together. */
function drawn(meta: Record<string, unknown>): [ChangeGraph, ReturnType<typeof layoutGraph>] {
  const graph = graphWith(meta);
  return [graph, layoutGraph(graph)];
}

describe("opening one change", () => {
  beforeEach(() => forgetFrames());

  it("asks the editor for one frame across both passes", async () => {
    const { GraphPanel } = await import("../src/panel.js");

    /*
     * The name the caller holds. It is made from what the reader asked for, so
     * it is the same on both passes however the refs resolve underneath — which
     * is the whole of the fix.
     */
    const where = "repo=/repo base=development head=origin/topic";

    // What the first pass carries: the base has not been resolved yet, because
    // the branch it would be read from has not been fetched.
    const first = graphWith({ headRef: "origin/topic" });
    // And the second, after the fetch and the checkout.
    const second = graphWith({ baseRef: "development", headRef: "origin/topic" });

    GraphPanel.show(
      first, layoutGraph(first), "/repo",
      undefined, undefined, undefined, undefined, where,
    );
    expect(frames).toHaveLength(1);

    GraphPanel.show(
      second, layoutGraph(second), "/repo",
      undefined, undefined, undefined, undefined, where,
    );
    expect(frames).toHaveLength(1);
  });

  it("opens a second frame when the refs move and nobody says otherwise", async () => {
    /*
     * The fault itself, with the name left out. Kept as a test rather than
     * deleted: it is what every caller got by default, and it says plainly what
     * the caller is now protecting against.
     */
    const { GraphPanel } = await import("../src/panel.js");

    GraphPanel.show(
      ...drawn({ headRef: "origin/topic" }), "/repo",
    );
    GraphPanel.show(
      ...drawn({ baseRef: "development", headRef: "origin/topic" }), "/repo",
    );

    expect(frames.length).toBeGreaterThan(1);
  });

  it("still tells two genuinely different readings apart", async () => {
    // The name is not a way of forcing everything into one tab: two readings
    // the reader asked for separately are still two.
    const { GraphPanel } = await import("../src/panel.js");

    GraphPanel.show(
      ...drawn({ baseRef: "development", headRef: "origin/topic" }), "/repo",
      undefined, undefined, undefined, undefined, "repo=/repo head=origin/topic",
    );
    GraphPanel.show(
      ...drawn({ baseRef: "development", headRef: "origin/other" }), "/repo",
      undefined, undefined, undefined, undefined, "repo=/repo head=origin/other",
    );

    expect(frames).toHaveLength(2);
  });
});
