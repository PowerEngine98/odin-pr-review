import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachEdges,
  collectProbes,
  graphFromRepo,
  type ChangeGraph,
} from "@odin/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TsResolver } from "../src/resolver.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "fixtures", "make-demo-repo-react.sh");

function describeEdges(graph: ChangeGraph): string[] {
  const path = new Map(graph.nodes.map((n) => [n.id, n.path]));
  return graph.edges.map(
    (e) => `${path.get(e.from.nodeId)} -> ${path.get(e.to.nodeId)} ${e.to.symbolName}`,
  );
}

describe("React components as call sites", () => {
  let dir: string;
  let graph: ChangeGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-react-"));
    execFileSync("bash", [SCRIPT, dir], { stdio: "pipe" });

    const base = await graphFromRepo({ cwd: dir, baseRef: "HEAD~1", headRef: "HEAD" });
    const resolver = new TsResolver({ roots: { head: dir } });
    const results = await resolver.resolve(
      collectProbes(base, { languages: [...resolver.languages] }),
    );
    await resolver.dispose();
    graph = attachEdges(base, results, { resolver: "ts" });
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("draws an arrow from a rendered component to where it is written", () => {
    // Writing <Header /> runs Header. On a React codebase that is most of the
    // arrows; without it a page that renders six components shows none of them.
    expect(describeEdges(graph)).toContain("src/Page.tsx -> src/Header.tsx Header");
  });

  it("follows a component reached through an object", () => {
    expect(describeEdges(graph)).toContain("src/Page.tsx -> src/Icons.tsx Chevron");
  });

  it("still resolves an ordinary call inside the markup", () => {
    expect(describeEdges(graph)).toContain("src/Page.tsx -> src/helpers.ts formatTitle");
  });

  it("ignores plain html", () => {
    // <div> and <span> resolve into React's own intrinsic-element declarations,
    // which is not somewhere a reviewer can usefully be sent.
    const lines = describeEdges(graph).join("\n");
    expect(lines).not.toContain("div");
    expect(lines).not.toContain("span");
  });
});
