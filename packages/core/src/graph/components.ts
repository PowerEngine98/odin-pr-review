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
  // And a file the change never touched cannot join two parts either.
  //
  // Untouched files are in the picture to answer "what does this change now
  // lean on", which means they are, almost by definition, the shared ones: a
  // button, a typography wrapper, an icon. Two unrelated screens both calling
  // the same `MuiIconButton` says nothing about the two screens — but read as
  // a connection it welds them together, and then welds in everything they
  // touch. That is not hypothetical: one existing helper fused a hundred and
  // twenty files into a single part, and the change's real seams disappeared
  // behind it.
  //
  // So they are passed over when the parts are worked out, and joined back on
  // afterwards to every part that reaches them — present in each, and decisive
  // in none.
  const untouched = new Set(
    graph.nodes.filter((n) => n.status === "phantom").map((n) => n.id),
  );
  const passive = (id: string) => schema.has(id) || untouched.has(id);

  const links = graph.edges.filter(
    (e) =>
      (options.includeImports === true || e.kind !== "import") &&
      !passive(e.from.nodeId) &&
      !passive(e.to.nodeId) &&
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

  // Nothing whose every member was passed over is a part in its own right. An
  // untouched file on its own is not a piece of the change; it is something the
  // change happens to lean on, and it is about to be filed under everything
  // that leans on it.
  const kept = groups.filter((group) => group.some((n) => !passive(n.id)));
  const carried = travellers(graph, kept, byId);
  // A file that now travels with a part is not also a part of its own: it would
  // be listed under "files nothing else in the change calls" while sitting in
  // the middle of a chain that plainly does use it.
  const travelling = new Set([...carried.values()].flat());

  const parts = kept.filter(
    (group) => group.length > 1 || !travelling.has(group[0]!.id),
  );
  const leant = leaning(graph, parts, untouched, byId);

  return parts
    .map((group) =>
      describe(group, links, [
        ...schema,
        ...(carried.get(group[0]!.id) ?? []),
        ...(leant.get(group[0]!.id) ?? []),
      ]),
    )
    .sort(
      (a, b) =>
        b.files - a.files ||
        b.additions + b.deletions - (a.additions + a.deletions) ||
        a.path.localeCompare(b.path),
    );
}

/**
 * The untouched files each part leans on.
 *
 * They were passed over while the parts were worked out, because a file the
 * change never touched is nearly always a shared one and reading it as a
 * connection welds unrelated work together. But a part that calls one still has
 * to draw it: the arrow leaves a card and has to arrive somewhere, and an arrow
 * to a file that is not on the canvas has nothing at its far end.
 *
 * So every part that reaches one gets its own copy, the way every part gets the
 * schema. Unlike the schema, only the parts that actually reach it: an
 * untouched file is not in every part of the change, merely in more than one.
 */
function leaning(
  graph: ChangeGraph,
  groups: FileNode[][],
  untouched: ReadonlySet<string>,
  byId: Map<string, FileNode>,
): Map<string, string[]> {
  if (untouched.size === 0) return new Map();

  const home = new Map<string, string>();
  for (const group of groups) {
    for (const node of group) home.set(node.id, group[0]!.id);
  }

  const leant = new Map<string, string[]>();
  const add = (groupId: string, nodeId: string) => {
    const here = leant.get(groupId);
    if (here) {
      if (!here.includes(nodeId)) here.push(nodeId);
    } else leant.set(groupId, [nodeId]);
  };

  for (const edge of graph.edges) {
    const from = edge.from.nodeId;
    const to = edge.to.nodeId;
    if (!byId.has(from) || !byId.has(to)) continue;

    // Whichever end the change never touched, filed with the part at the other.
    // Both ends untouched is two files outside the change knowing each other,
    // which belongs to no part and is drawn by none.
    const near = untouched.has(to) ? home.get(from) : undefined;
    if (untouched.has(to) && !untouched.has(from) && near) add(near, to);

    const far = untouched.has(from) ? home.get(to) : undefined;
    if (untouched.has(from) && !untouched.has(to) && far) add(far, from);
  }

  return leant;
}

/**
 * Files that belong to a part without being called by anything in it.
 *
 * A module of nothing but types is the plain case: three components import
 * `MediaProps` from it, and not one of them calls anything, so it has no call
 * edge at all and lands on its own. Which is both wrong and unhelpfully wrong —
 * it is the definition three files in this part are written against, filed
 * under "files nothing else in the change calls", where the arrows into it have
 * no other end on the canvas and nothing at all is drawn.
 *
 * So a file that would otherwise be alone travels with every part that imports
 * it, the way the schema travels with every part that talks to it. Only a file
 * that is alone: this is not a licence for imports to fuse the change back into
 * one picture, which is the whole reason they are left out of the grouping.
 */
function travellers(
  graph: ChangeGraph,
  groups: FileNode[][],
  byId: Map<string, FileNode>,
): Map<string, string[]> {
  const alone = new Set(
    groups.filter((group) => group.length === 1).map((group) => group[0]!.id),
  );
  if (alone.size === 0) return new Map();

  const home = new Map<string, string>();
  for (const group of groups) {
    for (const node of group) home.set(node.id, group[0]!.id);
  }

  const carried = new Map<string, string[]>();
  const add = (groupId: string, nodeId: string) => {
    const here = carried.get(groupId);
    if (here) {
      if (!here.includes(nodeId)) here.push(nodeId);
    } else carried.set(groupId, [nodeId]);
  };

  for (const edge of graph.edges) {
    if (edge.kind !== "import") continue;
    const from = edge.from.nodeId;
    const to = edge.to.nodeId;
    if (!byId.has(from) || !byId.has(to)) continue;

    // Whichever end is the lonely one, filed with the part at the other end.
    // Both ends alone means two files that only know each other, and moving
    // either into the other's part of one would say more than is true.
    //
    // An end with no part at all is not somewhere to file anything: a file the
    // change never touched is no longer in any group, and reading its absence
    // as a group of its own filed every lonely file under one imaginary part
    // and then dropped all of them from the answer.
    const host = alone.has(to) && !alone.has(from) ? home.get(from) : undefined;
    if (host) add(host, to);

    const other = alone.has(from) && !alone.has(to) ? home.get(to) : undefined;
    if (other) add(other, from);
  }

  return carried;
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
