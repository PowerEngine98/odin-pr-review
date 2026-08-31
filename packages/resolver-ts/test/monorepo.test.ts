import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachEdges,
  collectProbes,
  components,
  graphFromRepo,
  type ChangeGraph,
} from "@odin/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TsResolver } from "../src/resolver.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "fixtures", "make-demo-repo-monorepo.sh");

function describeEdges(graph: ChangeGraph): string[] {
  const path = new Map(graph.nodes.map((n) => [n.id, n.path]));
  return graph.edges.map(
    (e) => `${e.kind} ${path.get(e.from.nodeId)} -> ${path.get(e.to.nodeId)}`,
  );
}

/**
 * A repository whose configuration is not at its root.
 *
 * The aliases that decide what `@components/ItemNavigator` means live in
 * `frontend/tsconfig.base.json`, and a program built from the root without them
 * resolves the import to nothing. What that looked like on the page was a
 * renamed component sitting on its own while the file that renders it sat in
 * another part of the change — the arrow that joins them never existed.
 */
describe("a monorepo whose tsconfig is not at the root", () => {
  let dir: string;
  let graph: ChangeGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-monorepo-"));
    execFileSync("bash", [SCRIPT, dir], { stdio: "pipe" });

    const raw = await graphFromRepo({ cwd: dir, baseRef: "HEAD~1", headRef: "HEAD" });
    const resolver = new TsResolver({ roots: { head: dir } });
    const results = await resolver.resolve(
      collectProbes(raw, { languages: [...resolver.languages] }),
    );
    await resolver.dispose();
    graph = attachEdges(raw, results, { resolver: "ts" });
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("follows an import written through a path alias", () => {
    expect(describeEdges(graph)).toContain(
      "import frontend/web/src/Page.tsx -> " +
        "frontend/common/src/components/ItemNavigator.tsx",
    );
  });

  it("draws the component that renders it as a call", () => {
    // The one that matters for grouping: parts are built from calls, and an
    // import edge alone would leave the two files in separate parts.
    expect(describeEdges(graph)).toContain(
      "instantiation frontend/web/src/Page.tsx -> " +
        "frontend/common/src/components/ItemNavigator.tsx",
    );
  });

  it("puts the renamed file in the same part as the file that renders it", () => {
    const parts = components(graph);
    const together = parts.find((part) =>
      part.nodeIds.some(
        (id) => graph.nodes.find((n) => n.id === id)?.path.endsWith("ItemNavigator.tsx"),
      ),
    );
    const paths = (together?.nodeIds ?? []).map(
      (id) => graph.nodes.find((n) => n.id === id)?.path,
    );
    expect(paths).toContain("frontend/web/src/Page.tsx");
  });
});
