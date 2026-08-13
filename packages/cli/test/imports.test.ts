import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { graphFromRepo, type ChangeGraph } from "@odin/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseArgs, type GraphOptions } from "../src/args.js";
import { resolveEdges } from "../src/pipeline.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "fixtures", "make-demo-repo-ts.sh");

/** Shorthand for asserting on an edge: "who points at what, and how". */
function describeEdges(graph: ChangeGraph): string[] {
  const path = new Map(graph.nodes.map((n) => [n.id, n.path]));
  return graph.edges.map(
    (e) => `${e.kind} ${path.get(e.from.nodeId)} -> ${path.get(e.to.nodeId)}`,
  );
}

/**
 * The command line asked for arrows and got a graph with none.
 *
 * `--imports` set a rendering flag and nothing else, so the resolver never ran
 * and the output was an empty `edges` array — which reads exactly like a change
 * whose files reference nothing, and so said nothing about the flag having been
 * ignored. The editor never had the fault because it resolves unconditionally,
 * which is why this went unnoticed for as long as it did.
 *
 * Both halves are checked here: that the flag asks for the work, and that the
 * work then produces something. Either alone would have passed while the tool
 * was broken.
 */
describe("asking for import arrows on the command line", () => {
  let dir: string;
  let opts: GraphOptions;
  let graph: ChangeGraph;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-cli-imports-"));
    execFileSync("bash", [SCRIPT, dir], { cwd: REPO_ROOT, stdio: "pipe" });

    const parsed = parseArgs([
      "graph", "--format", "json", "--imports",
      "-C", dir, "-b", "main", "-H", "feature/graph",
    ]);
    if (parsed.kind !== "graph") throw new Error("expected a graph command");
    opts = parsed;

    // The wiring `main` uses, so the fixture is exercised the way the command
    // exercises a real repository rather than through a shortcut of its own.
    const raw = await graphFromRepo({
      cwd: opts.cwd,
      ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
      headRef: opts.headRef,
      context: opts.context,
      stamp: opts.stamp,
      pullRequest: opts.pullRequest,
    });
    graph = opts.resolve
      ? await resolveEdges(raw, {
          cwd: opts.cwd,
          headRef: opts.headRef,
          includeImports: opts.imports,
          includeContext: opts.withContext,
          alwaysResolveImports: opts.format === "html",
        })
      : raw;
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("turns the request for arrows into a request for resolution", () => {
    expect(parseArgs(["graph", "--imports"])).toMatchObject({ resolve: true });
    expect(parseArgs(["graph", "--with-context"])).toMatchObject({ resolve: true });
  });

  it("leaves a patch file alone, having no repository to resolve against", () => {
    expect(parseArgs(["graph", "-p", "change.patch", "--imports"])).toMatchObject({
      resolve: false,
      imports: true,
    });
  });

  it("resolves references rather than reporting a change with no relationships", () => {
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("draws the import arrows leaving the added file", () => {
    // Every line of an added file is a changed line, so its imports are probed
    // without `--with-context` and their targets are unambiguous.
    const arrows = describeEdges(graph);
    expect(arrows).toContain("import src/addedFile.ts -> src/logger.ts");
    expect(arrows).toContain("import src/addedFile.ts -> src/myService.ts");
    expect(arrows).toContain("import src/addedFile.ts -> src/repository.ts");
  });

  it("still resolves the call sites imports were asked for alongside", () => {
    expect(describeEdges(graph)).toContain("call src/consumer.ts -> src/myService.ts");
  });
});
