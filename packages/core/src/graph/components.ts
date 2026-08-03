import type { ChangeGraph, Edge, FileNode } from "../model/types.js";

/** One part of a change that can be read without reading the rest of it. */
export interface Component {
  /** Stable across runs: the id of the file the part is named after. */
  id: string;
  /** The file the part is named after — where its call chain starts. */
  label: string;
  path: string;
  nodeIds: string[];
  /** Files in it, and how much of the change they carry. */
  files: number;
  additions: number;
  deletions: number;
}

export interface ComponentOptions {
  /**
   * Count import edges as connections.
   *
   * Off by default. An import says one file names another, which in a codebase
   * with a shared type module or a barrel file connects nearly everything to
   * nearly everything — true, and useless as a way of splitting the change up.
   * A call chain is the thing a reviewer follows.
   */
  includeImports?: boolean;
}

/**
 * The change, split into the parts that do not reach each other.
 *
 * A large pull request is usually several changes that happen to have been
 * pushed together: a migration here, a component rewrite there, and a handful
 * of files nothing else touches. Reading it as one picture means holding all of
 * it at once; reading it as parts means each can be finished and set down.
 *
 * Parts come back largest first, since that is the one worth opening.
 */
export function components(
  graph: ChangeGraph,
  options: ComponentOptions = {},
): Component[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // The schema is in every part and belongs to none: nearly everything in a
  // backend touches the database, so letting those links group the change would
  // fuse the whole of it into one part and take away the very split that makes
  // a large review readable.
  const schema = new Set(
    graph.nodes.filter((n) => n.kind === "database").map((n) => n.id),
  );
  const links = graph.edges.filter(
    (e) =>
      (options.includeImports === true || e.kind !== "import") &&
      !schema.has(e.from.nodeId) &&
      !schema.has(e.to.nodeId) &&
      byId.has(e.from.nodeId) &&
      byId.has(e.to.nodeId),
  );

  // Undirected for grouping — a file is part of the same story whether it calls
  // or is called — and directed afterwards, to find where the story starts.
  const neighbours = new Map<string, Set<string>>();
  const join = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const edge of links) {
    join(edge.from.nodeId, edge.to.nodeId);
    join(edge.to.nodeId, edge.from.nodeId);
  }

  const seen = new Set<string>();
  const groups: FileNode[][] = [];

  // Walked in the graph's own order so the same change always splits the same
  // way, and always names its parts the same.
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;

    const group: FileNode[] = [];
    const queue = [node.id];
    seen.add(node.id);

    while (queue.length > 0) {
      const id = queue.shift()!;
      const found = byId.get(id);
      if (found) group.push(found);
      for (const next of neighbours.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    groups.push(group);
  }

  return groups
    .filter((group) => group.some((n) => n.kind !== "database"))
    .map((group) => describe(group, links, [...schema]))
    .sort(
      (a, b) =>
        b.files - a.files ||
        b.additions + b.deletions - (a.additions + a.deletions) ||
        a.path.localeCompare(b.path),
    );
}

/**
 * Names a part after the file its call chain starts at.
 *
 * The start is the file nothing else in the part calls. Where several qualify —
 * two entry points into the same cluster — the one with the most going out of
 * it is the one a reader should open first. Where none do, the part is a cycle,
 * and any name would be as arbitrary as any other, so it takes the first file
 * by path and stays predictable.
 */
function describe(
  group: FileNode[],
  links: Edge[],
  schemaIds: string[] = [],
): Component {
  const ids = new Set(group.map((n) => n.id));
  const inside = links.filter(
    (e) => ids.has(e.from.nodeId) && ids.has(e.to.nodeId),
  );

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of inside) {
    if (edge.from.nodeId === edge.to.nodeId) continue;
    incoming.set(edge.to.nodeId, (incoming.get(edge.to.nodeId) ?? 0) + 1);
    outgoing.set(edge.from.nodeId, (outgoing.get(edge.from.nodeId) ?? 0) + 1);
  }

  const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
  const roots = sorted.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  const head =
    [...roots].sort(
      (a, b) => (outgoing.get(b.id) ?? 0) - (outgoing.get(a.id) ?? 0),
    )[0] ?? sorted[0]!;

  return {
    id: head.id,
    label: head.path.split("/").pop() ?? head.path,
    path: head.path,
    // The schema travels with every part, since every part may talk to it.
    nodeIds: [...sorted.map((n) => n.id), ...schemaIds],
    files: group.length,
    additions: group.reduce((n, f) => n + f.stats.additions, 0),
    deletions: group.reduce((n, f) => n + f.stats.deletions, 0),
  };
}
