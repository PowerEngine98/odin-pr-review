import { addPhantomNodes, sortGraph } from "../graph/build.js";
import { edgeId, nodeId } from "../model/ids.js";
import type {
  ChangeGraph,
  Edge,
  EdgeChange,
  Endpoint,
  FileNode,
  LineKind,
} from "../model/types.js";
import { basePath } from "./probes.js";
import type { ProbeResult } from "./types.js";

export interface AttachOptions {
  /** Fallback for results that do not name their own producer. */
  resolver: Edge["resolver"];
  /**
   * Keep references whose target lives in the same file as the call site.
   * Off by default: they render as a loop on a single card and say little
   * about how a change ripples through the codebase.
   */
  includeSelfReferences?: boolean;
  /**
   * Pull untouched target files into the graph as dimmed phantom vertices.
   * On by default; this is what makes "what does my change now depend on"
   * visible rather than implied.
   */
  includePhantoms?: boolean;
}

const CHANGE_BY_LINE: Record<LineKind, EdgeChange> = {
  add: "added",
  del: "removed",
  ctx: "unchanged",
};

/**
 * Folds resolver output into the graph as edges.
 *
 * An edge's colour comes from the line its call site sits on, not from
 * anything about the target: a reference written on an added line is an added
 * reference, and one written on a deleted line is a removed reference. That
 * single rule reproduces every arrow in the design sketch, including the ones
 * leaving a wholly deleted file.
 */
export function attachEdges(
  graph: ChangeGraph,
  results: ProbeResult[],
  options: AttachOptions,
): ChangeGraph {
  const index = indexNodes(graph.nodes);
  const edges = new Map<string, Edge>();
  const phantoms: { nodeId: string; path: string }[] = [];

  for (const { probe, targets } of results) {
    const fromNode = index.get(probe.path);
    if (!fromNode) continue;

    for (const target of targets) {
      const toNode = index.get(target.path);
      const toId = toNode?.id ?? nodeId(target.path);

      if (!toNode) phantoms.push({ nodeId: toId, path: target.path });
      if (!options.includeSelfReferences && toId === fromNode.id) continue;

      const from: Endpoint = {
        nodeId: fromNode.id,
        side: probe.side,
        line: probe.line,
      };
      if (target.fromColumn !== undefined) from.column = target.fromColumn;
      if (target.fromSymbolName) from.symbolName = target.fromSymbolName;

      const to: Endpoint = {
        nodeId: toId,
        side: target.side,
        line: target.line,
        symbolName: target.symbolName,
      };
      if (target.column !== undefined) to.column = target.column;

      const id = edgeId(from, to, target.kind);
      if (edges.has(id)) continue;

      const edge: Edge = {
        id,
        from,
        to,
        change: CHANGE_BY_LINE[probe.changeKind],
        kind: target.kind,
        confidence: target.confidence,
        // Several resolvers may contribute to one graph, and their accuracy
        // differs, so an edge records the one that actually produced it.
        resolver: target.resolver ?? options.resolver,
      };
      if (target.label) edge.label = target.label;
      edges.set(id, edge);
    }
  }

  const withEdges = sortGraph({ ...graph, edges: [...edges.values()] });
  return options.includePhantoms === false
    ? withEdges
    : addPhantomNodes(withEdges, phantoms);
}

/**
 * Maps every path a node answers to onto that node. A renamed file is reachable
 * under both its old and new path, so a reference resolved in the base checkout
 * lands on the same vertex as one resolved in head.
 */
function indexNodes(nodes: FileNode[]): Map<string, FileNode> {
  const index = new Map<string, FileNode>();
  for (const node of nodes) {
    index.set(node.path, node);
    const previous = basePath(node);
    if (!index.has(previous)) index.set(previous, node);
  }
  return index;
}
