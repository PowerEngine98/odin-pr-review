import { SCHEMA_VERSION, type ChangeGraph } from "../model/types.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Structural checks over a change graph.
 *
 * Kept hand-written rather than pulled from a schema library so that `@odin/core`
 * stays dependency-free and can be bundled into the webview without a build
 * step. The checks that matter are the referential ones: a dangling edge is the
 * failure mode that produces a confusing picture instead of an error.
 */
export function validateGraph(graph: ChangeGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (graph.schemaVersion !== SCHEMA_VERSION) {
    add("schemaVersion", `expected ${SCHEMA_VERSION}, got ${graph.schemaVersion}`);
  }
  if (!graph.meta?.baseRef) add("meta.baseRef", "missing");
  if (!graph.meta?.headRef) add("meta.headRef", "missing");

  const byId = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    const where = `nodes[${i}]`;
    if (byId.has(node.id)) {
      add(where, `duplicate node id ${node.id} (also nodes[${byId.get(node.id)}])`);
    }
    byId.set(node.id, i);

    if (!node.path) add(`${where}.path`, "missing");
    if (node.status === "renamed" && !node.prevPath) {
      add(`${where}.prevPath`, "renamed node must carry its previous path");
    }

    node.hunks.forEach((hunk, h) => {
      const dels = hunk.lines.filter((l) => l.kind !== "add").length;
      const adds = hunk.lines.filter((l) => l.kind !== "del").length;
      if (hunk.oldLines !== dels) {
        add(
          `${where}.hunks[${h}]`,
          `header claims ${hunk.oldLines} base lines, body has ${dels}`,
        );
      }
      if (hunk.newLines !== adds) {
        add(
          `${where}.hunks[${h}]`,
          `header claims ${hunk.newLines} head lines, body has ${adds}`,
        );
      }
    });
  });

  graph.edges.forEach((edge, i) => {
    const where = `edges[${i}]`;
    for (const [end, label] of [[edge.from, "from"], [edge.to, "to"]] as const) {
      if (!byId.has(end.nodeId)) {
        add(`${where}.${label}`, `points at unknown node ${end.nodeId}`);
      }
      if (!Number.isInteger(end.line) || end.line < 1) {
        add(`${where}.${label}.line`, `expected a 1-based line, got ${end.line}`);
      }
    }
  });

  return issues;
}

/** Throws on the first structural problem. Convenience for producers. */
export function assertValidGraph(graph: ChangeGraph): void {
  const issues = validateGraph(graph);
  if (issues.length === 0) return;
  const detail = issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
  throw new Error(`invalid change graph:\n${detail}`);
}
