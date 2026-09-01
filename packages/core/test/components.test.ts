import { describe, expect, it } from "vitest";

import { components } from "../src/graph/components.js";

import type { ChangeGraph, Edge, FileNode } from "../src/model/types.js";

function file(path: string, additions = 1): FileNode {
  return {
    id: `n:${path}`,
    path,
    status: "modified",
    language: "typescript",
    binary: false,
    stats: { additions, deletions: 0 },
    hunks: [],
    symbols: [],
  };
}

function edge(from: string, to: string, kind: Edge["kind"] = "call"): Edge {
  return {
    id: `e:${from}->${to}:${kind}`,
    from: { nodeId: `n:${from}`, path: from, side: "head", line: 1 },
    to: { nodeId: `n:${to}`, path: to, side: "head", line: 1 },
    change: "added",
    kind,
    confidence: "resolved",
    resolver: "ts",
  };
}

function graph(nodes: FileNode[], edges: Edge[]): ChangeGraph {
  return {
    nodes,
    edges,
    meta: { baseRef: "main", headRef: "topic", generator: "test" },
  };
}

describe("splitting a change into what can be read on its own", () => {
  it("keeps files that reach each other together", () => {
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("c.ts")],
        [edge("a.ts", "b.ts"), edge("b.ts", "c.ts")],
      ),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]!.files).toBe(3);
  });

  it("separates files that do not", () => {
    // The point of the whole thing: a pull request carrying two unrelated
    // changes is two reviews, and reading it as one picture means holding both
    // at once.
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("x.ts"), file("y.ts")],
        [edge("a.ts", "b.ts"), edge("x.ts", "y.ts")],
      ),
    );
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.label).sort()).toEqual(["a.ts", "x.ts"]);
  });

  it("names a part after where its call chain starts", () => {
    const parts = components(
      graph(
        [file("entry.ts"), file("middle.ts"), file("leaf.ts")],
        [edge("entry.ts", "middle.ts"), edge("middle.ts", "leaf.ts")],
      ),
    );
    expect(parts[0]!.label).toBe("entry.ts");
  });

  it("prefers the busiest entry when several files call in", () => {
    const parts = components(
      graph(
        [file("one.ts"), file("two.ts"), file("shared.ts"), file("also.ts")],
        [
          edge("one.ts", "shared.ts"),
          edge("two.ts", "shared.ts"),
          edge("two.ts", "also.ts"),
        ],
      ),
    );
    expect(parts[0]!.label).toBe("two.ts");
  });

  it("falls back to the first file when the calls go in a circle", () => {
    // Nothing in a cycle is the start of it, so any name is as arbitrary as any
    // other. Taking the first by path at least means the same name every run.
    const parts = components(
      graph(
        [file("beta.ts"), file("alpha.ts")],
        [edge("alpha.ts", "beta.ts"), edge("beta.ts", "alpha.ts")],
      ),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]!.label).toBe("alpha.ts");
  });

  it("leaves a file nothing references as a part of its own", () => {
    const parts = components(graph([file("lonely.ts")], []));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.nodeIds).toEqual(["n:lonely.ts"]);
  });

  it("does not let an import merge two changes", () => {
    // A shared type module is imported by everything, which would make the
    // whole change one part and the split worthless.
    const parts = components(
      graph(
        [file("a.ts"), file("types.ts"), file("x.ts")],
        [edge("a.ts", "types.ts", "import"), edge("x.ts", "types.ts", "import")],
      ),
    );
    expect(parts).toHaveLength(3);
  });

  it("counts imports when asked to", () => {
    const parts = components(
      graph(
        [file("a.ts"), file("types.ts")],
        [edge("a.ts", "types.ts", "import")],
      ),
      { includeImports: true },
    );
    expect(parts).toHaveLength(1);
  });

  it("puts the largest part first", () => {
    const parts = components(
      graph(
        [file("solo.ts"), file("a.ts"), file("b.ts")],
        [edge("a.ts", "b.ts")],
      ),
    );
    expect(parts[0]!.files).toBe(2);
    expect(parts[1]!.label).toBe("solo.ts");
  });

  it("splits the same way every run", () => {
    const input = graph(
      [file("a.ts"), file("b.ts"), file("x.ts")],
      [edge("a.ts", "b.ts")],
    );
    expect(JSON.stringify(components(input))).toBe(
      JSON.stringify(components(input)),
    );
  });
});

/**
 * A file nothing calls, which two files in a part are written against.
 *
 * The plain case is a module of nothing but types: three components import
 * `MediaProps` from it and not one of them calls anything in it, so it has no
 * call edge at all. Grouped by calls alone it lands under "files nothing else
 * in the change calls" — where the arrows into it have no other end on the
 * canvas, so the reader is shown a card with nothing attached to it and no way
 * to find out what uses it.
 */
describe("a file that is only ever imported", () => {
  it("travels with the part that imports it", () => {
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("types.ts")],
        [edge("a.ts", "b.ts"), edge("b.ts", "types.ts", "import")],
      ),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]!.nodeIds).toContain("n:types.ts");
  });

  it("is not also listed as a part of its own", () => {
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("types.ts")],
        [edge("a.ts", "b.ts"), edge("b.ts", "types.ts", "import")],
      ),
    );
    expect(parts.some((part) => part.files === 1)).toBe(false);
  });

  it("goes with every part that imports it", () => {
    // It belongs to each chain written against it, the same way the schema
    // belongs to every part that talks to it.
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("x.ts"), file("y.ts"), file("types.ts")],
        [
          edge("a.ts", "b.ts"),
          edge("x.ts", "y.ts"),
          edge("b.ts", "types.ts", "import"),
          edge("y.ts", "types.ts", "import"),
        ],
      ),
    );
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part.nodeIds).toContain("n:types.ts");
  });

  it("does not count towards the size of the part it travels with", () => {
    // The count answers "how much is there to read here", and the same file
    // counted once in every part it appears in adds up to more than the change.
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("types.ts")],
        [edge("a.ts", "b.ts"), edge("b.ts", "types.ts", "import")],
      ),
    );
    expect(parts[0]!.files).toBe(2);
  });

  it("leaves two files that only import each other where they are", () => {
    // Neither is the part and neither is the traveller. Moving either into the
    // other would be inventing a chain out of one import.
    const parts = components(
      graph([file("one.ts"), file("two.ts")], [edge("one.ts", "two.ts", "import")]),
    );
    expect(parts).toHaveLength(2);
  });

  it("still refuses to let imports fuse the change into one picture", () => {
    // The rule is for files that would otherwise be alone. Two real chains that
    // happen to import each other are still two chains.
    const parts = components(
      graph(
        [file("a.ts"), file("b.ts"), file("x.ts"), file("y.ts")],
        [edge("a.ts", "b.ts"), edge("x.ts", "y.ts"), edge("b.ts", "x.ts", "import")],
      ),
    );
    expect(parts).toHaveLength(2);
  });
});

/**
 * A file the change never touched, and what it may not do.
 *
 * Untouched files are on the canvas to answer "what does this change now lean
 * on", which means they are the shared ones almost by definition: a button, a
 * typography wrapper, an icon map. Read as connections they weld unrelated work
 * together and then weld in everything that work touches — on a real pull
 * request one existing helper made a hundred and twenty files into a single
 * part, and the change's actual seams were nowhere to be seen.
 */
function untouched(path: string): FileNode {
  return { ...file(path, 0), status: "phantom" };
}

describe("a file the change never touched", () => {
  it("does not join two parts that both call it", () => {
    // The fault, at its smallest. Two screens, one shared button; before this
    // they came back as one part of five files.
    const parts = components(
      graph(
        [
          file("feed.tsx"),
          file("feed-row.tsx"),
          file("profile.tsx"),
          file("profile-row.tsx"),
          untouched("Button.tsx"),
        ],
        [
          edge("feed.tsx", "feed-row.tsx"),
          edge("profile.tsx", "profile-row.tsx"),
          edge("feed-row.tsx", "Button.tsx"),
          edge("profile-row.tsx", "Button.tsx"),
        ],
      ),
    );

    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.files)).toEqual([2, 2]);
  });

  it("is drawn with every part that reaches it", () => {
    // Passed over when the parts are worked out, joined back on afterwards: the
    // arrow to it leaves a card and has to arrive somewhere.
    const parts = components(
      graph(
        [file("feed.tsx"), file("profile.tsx"), untouched("Button.tsx")],
        [edge("feed.tsx", "Button.tsx"), edge("profile.tsx", "Button.tsx")],
      ),
    );

    for (const part of parts) expect(part.nodeIds).toContain("n:Button.tsx");
  });

  it("is not counted as a file of the part it is drawn in", () => {
    // `78/120` is how much there is left to read. Nobody reviews a file the
    // change did not touch, so it is drawn and not counted.
    const parts = components(
      graph(
        [file("feed.tsx"), file("feed-row.tsx"), untouched("Button.tsx")],
        [edge("feed.tsx", "feed-row.tsx"), edge("feed-row.tsx", "Button.tsx")],
      ),
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]!.files).toBe(2);
    expect(parts[0]!.nodeIds).toHaveLength(3);
  });

  it("is never a part of its own", () => {
    // It is not a piece of the change; it is something the change leans on.
    const parts = components(
      graph([file("feed.tsx"), untouched("Button.tsx")], [edge("feed.tsx", "Button.tsx")]),
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]!.path).toBe("feed.tsx");
  });

  it("does not join two parts by import either", () => {
    // The same file, named rather than called, with imports counting as links.
    const parts = components(
      graph(
        [file("feed.tsx"), file("profile.tsx"), untouched("theme.ts")],
        [edge("feed.tsx", "theme.ts", "import"), edge("profile.tsx", "theme.ts", "import")],
        ),
      { includeImports: true },
    );

    expect(parts).toHaveLength(2);
  });

  it("says nothing about two untouched files that only know each other", () => {
    // Both ends outside the change: it belongs to no part, and no part draws it.
    const parts = components(
      graph(
        [file("feed.tsx"), untouched("Button.tsx"), untouched("icons.ts")],
        [edge("feed.tsx", "Button.tsx"), edge("Button.tsx", "icons.ts")],
      ),
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]!.nodeIds).toContain("n:Button.tsx");
    expect(parts[0]!.nodeIds).not.toContain("n:icons.ts");
  });
});
