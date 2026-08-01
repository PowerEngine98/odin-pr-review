import { sortGraph } from "./build.js";
import type { ChangeGraph, FileNode } from "../model/types.js";

/**
 * Directory conventions that mark a path as tests, across languages.
 *
 * Matched on whole path segments so that `src/testing/Widget.kt` is not caught
 * by `test`, and neither is a file that merely has "spec" in its name.
 */
const TEST_DIRECTORIES = new Set([
  "test", "tests", "spec", "specs", "__tests__", "__mocks__",
  "androidTest", "integrationTest", "e2e", "testFixtures",
]);

/** Filename conventions, keyed loosely by the ecosystems that use them. */
const TEST_FILENAME = [
  // Kotlin, Java, Scala, C#
  /(?:Test|Tests|Spec|Specs|IT|ITCase|TestCase)\.(?:kt|kts|java|scala|cs)$/,
  // JavaScript and TypeScript
  /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/,
  // Python
  /(?:^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  // Go
  /_test\.go$/,
  // Ruby
  /_spec\.rb$/,
  /_test\.rb$/,
  // Rust
  /(?:^|\/)tests\/[^/]+\.rs$/,
  // PHP
  /Test\.php$/,
];

/**
 * Whether a path looks like test code.
 *
 * Conventions rather than certainty: nothing in a diff says which files are
 * tests, and asking a build system would tie the tool to one. These are the
 * patterns that hold across the ecosystems the resolver already covers, and a
 * miss is visible and recoverable — the file simply shows up with the rest.
 */
export function isTestPath(path: string): boolean {
  const segments = path.split("/");
  if (segments.slice(0, -1).some((s) => TEST_DIRECTORIES.has(s))) return true;
  return TEST_FILENAME.some((pattern) => pattern.test(path));
}

/** Tags every node, so consumers can filter without repeating the rules. */
export function annotateTests(graph: ChangeGraph): ChangeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      isTest: isTestPath(node.path),
    })),
  };
}

/**
 * Drops test files, along with anything only they reached.
 *
 * A test file tends to touch a great deal of the code it exercises, so leaving
 * them in makes one large test the busiest thing in the picture and buries the
 * change under it. They are excluded by default and can be switched back on,
 * rather than removed outright: sometimes the tests *are* the change.
 */
export function withoutTests(graph: ChangeGraph): ChangeGraph {
  const isTest = (node: FileNode) => node.isTest ?? isTestPath(node.path);
  const kept = new Set(
    graph.nodes.filter((n) => !isTest(n)).map((n) => n.id),
  );

  const edges = graph.edges.filter(
    (e) => kept.has(e.from.nodeId) && kept.has(e.to.nodeId),
  );

  // A file pulled in only because a test referenced it has nothing left to say.
  const referenced = new Set(edges.flatMap((e) => [e.from.nodeId, e.to.nodeId]));
  const nodes = graph.nodes.filter(
    (n) => kept.has(n.id) && (n.status !== "phantom" || referenced.has(n.id)),
  );

  const surviving = new Set(nodes.map((n) => n.id));
  return sortGraph({
    ...graph,
    nodes,
    edges: edges.filter(
      (e) => surviving.has(e.from.nodeId) && surviving.has(e.to.nodeId),
    ),
  });
}
