import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  layoutGraph,
  withoutTests,
  type ChangeGraph,
  type Edge,
  type FileNode,
} from "@odin/core";

import { renderHtml } from "../src/html.js";
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

/**
 * The tab strip, against the picture it is a strip of.
 *
 * "On their own" holds the files that reach nothing and that nothing reaches,
 * and a reader who opens it and finds cards joined by arrows has been told two
 * different things about the same change. That is what happened, and the cause
 * was that the split was worked out from two halves of two graphs: the cards
 * came from the arrangement that holds every file, and the arrows from the
 * graph handed to the renderer, which is the one with the tests taken out.
 * Taking the tests out takes every arrow with an end in a test file with them,
 * so a pair of test files that plainly use each other looked unconnected to the
 * split and connected to the canvas. On the change it was found in, thirty-six
 * files sat under that tab and twenty-five of them had an arrow to another card
 * in it.
 */
function touched(id: string, path: string, line: string): FileNode {
  return {
    id,
    path,
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    symbols: [],
    hunks: [
      {
        header: "",
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{ kind: "add", text: line, newLine: 1 }],
      },
    ],
  };
}

function reference(from: string, to: string, kind: Edge["kind"]): Edge {
  return {
    id: `e:${from}->${to}:${kind}`,
    from: { nodeId: from, side: "head", line: 1 },
    to: { nodeId: to, side: "head", line: 1, symbolName: "SessionEdgeTestEvent" },
    change: "added",
    kind,
    confidence: "resolved",
    resolver: "kotlin",
  };
}

interface PageModel {
  nodes: { id: string; path: string; status?: string; kind?: string }[];
  edges: { from: string; to: string }[];
  parts: { id: string; nodes: string[]; label: string }[];
}

/** The model the page is handed, from a host that renders both arrangements. */
function drawn(graph: ChangeGraph): PageModel {
  const shown = withoutTests(graph);
  const page = renderHtml(shown, layoutGraph(shown), {
    withTests: layoutGraph(graph),
  });
  const at = page.indexOf("window.__ODIN__=");
  return JSON.parse(page.slice(at + 16, page.indexOf(";</script>", at)));
}

/** A test that builds the fixtures beside it, which is a chain of two files. */
function tests(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "development", headRef: "topic", generator: "test" },
    nodes: [
      touched("n:spec", "test/rtc/RTCSessionEdgeTests.kt", "SessionEdgeTestEvent(\"published\")"),
      touched("n:fixture", "test/fixtures/SessionEdgeEvents.kt", "data class SessionEdgeTestEvent"),
    ],
    edges: [reference("n:spec", "n:fixture", "instantiation")],
  };
}

describe("what the tabs claim and what the canvas draws", () => {
  it("leaves nothing under 'on their own' that it draws an arrow to", () => {
    const model = drawn(tests());
    const loose = model.parts.find((part) => part.id === "loose");
    const alone = new Set(loose?.nodes ?? []);
    // A card the change never touched is drawn inside every part that leans on
    // it, so an arrow to one says nothing about whether a file is alone. An
    // arrow to another file of the change says exactly that.
    const change = new Set(
      model.nodes
        .filter((node) => node.status !== "phantom" && node.kind !== "database")
        .map((node) => node.id),
    );
    const joined = model.edges.filter(
      (edge) =>
        edge.from !== edge.to &&
        alone.has(edge.from) &&
        alone.has(edge.to) &&
        (change.has(edge.from) || change.has(edge.to)),
    );
    expect(joined).toEqual([]);
  });

  it("keeps a chain of test files together, because it draws it that way", () => {
    const model = drawn(tests());
    const chain = model.parts.find((part) => part.id !== "loose");
    expect(chain?.nodes.slice().sort()).toEqual(["n:fixture", "n:spec"]);
    // And named after the end of the chain a reader would open first.
    expect(chain?.id).toBe("n:spec");
  });

  it("names a chain that starts at a test file", () => {
    // The same mistake one field further on: the name was looked up in the
    // graph the renderer was handed, which is the one without the tests, so a
    // part named after a test file reached the strip as a tab with no name.
    const chain = drawn(tests()).parts.find((part) => part.id !== "loose");
    expect(chain?.label).toBe("test/rtc/RTCSessionEdgeTests.kt");
  });

  it("counts the arrows the arrangement carries, not the ones left in the graph", () => {
    // The same change with the tests still in it must split the same way,
    // because it is the same change. Before this it split two ways: the graph
    // handed over had lost the arrows and the arrangement had not.
    const graph = tests();
    const both = renderHtml(graph, layoutGraph(graph));
    const at = both.indexOf("window.__ODIN__=");
    const whole: PageModel = JSON.parse(
      both.slice(at + 16, both.indexOf(";</script>", at)),
    );
    expect(whole.parts.map((part) => part.nodes)).toEqual(
      drawn(graph).parts.map((part) => part.nodes),
    );
  });
});

/**
 * The reader's own answer about imports, which the split never used to hear.
 *
 * Whether an import is drawn as an arrow is a setting, and it is a setting the
 * resolvers read: with it off there is no such edge in the change at all. With
 * it on the arrow is on the canvas, and a tab saying the file at one end of it
 * reaches nothing is the same contradiction as before wearing a different kind
 * of arrow. So the page is told what the reader asked for, and the split counts
 * what the reader can see.
 */
function imported(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { baseRef: "development", headRef: "topic", generator: "test" },
    nodes: [
      touched("n:screen", "src/Feed.kt", "import com.labura.media.Props"),
      touched("n:props", "src/Props.kt", "data class Props"),
    ],
    edges: [reference("n:screen", "n:props", "import")],
  };
}

describe("the reader's setting for import arrows", () => {
  it("joins two files the page draws an import between", () => {
    const graph = imported();
    const page = renderHtml(graph, layoutGraph(graph));
    const at = page.indexOf("window.__ODIN__=");
    const model: PageModel = JSON.parse(
      page.slice(at + 16, page.indexOf(";</script>", at)),
    );
    expect(model.parts.find((part) => part.id === "loose")?.nodes).toEqual([]);
    expect(model.parts[0]!.nodes).toEqual(["n:screen", "n:props"]);
  });

  it("leaves them apart when the reader asked for no imports", () => {
    // Nothing to contradict: a reading built without imports has no such arrow
    // to draw, and two files that only name each other are two reviews.
    const graph = imported();
    const page = renderHtml(graph, layoutGraph(graph), { includeImports: false });
    const at = page.indexOf("window.__ODIN__=");
    const model: PageModel = JSON.parse(
      page.slice(at + 16, page.indexOf(";</script>", at)),
    );
    expect(model.parts.find((part) => part.id === "loose")?.nodes).toEqual([
      "n:screen",
      "n:props",
    ]);
  });
});
