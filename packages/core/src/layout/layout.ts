import { sortGraph } from "../graph/build.js";
import type { ChangeGraph, Edge, FileNode, Side } from "../model/types.js";
import {
  anchorRowForLine,
  cardTitle,
  displayRows,
  titleLength,
  type DisplayRow,
  type Snippet,
} from "./display.js";
import { DEFAULT_METRICS, type LayoutMetrics } from "./metrics.js";

export interface PlacedNode {
  id: string;
  path: string;
  node: FileNode;
  rows: DisplayRow[];
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  order: number;
  /** Rows shown before truncation; `rows.length` when nothing is hidden. */
  visibleRows: number;
  /** Rows the card is not showing, reachable through its "show more" bar. */
  hiddenRows: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacedEdge {
  id: string;
  edge: Edge;
  from: Point;
  to: Point;
  /** Which border the arrow leaves and enters, for routing. */
  fromSide: "left" | "right";
  toSide: "left" | "right";
  /** Row index the endpoint landed on, or undefined if it fell back to the card. */
  fromRow?: number;
  toRow?: number;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  metrics: LayoutMetrics;
}

export interface LayoutOptions {
  metrics?: Partial<LayoutMetrics>;
  /** Extra source context per node id, keyed as returned by `enrichSnippets`. */
  snippets?: Map<string, Snippet[]>;
}

/**
 * Places every card and every arrow.
 *
 * Pure and free of randomness by design: the same graph must always produce the
 * same picture, because the tool's value comes from a reviewer recognising the
 * shape of a change before reading any of it. Every tie is broken by a stable
 * key, and every iterative pass runs a fixed number of times.
 */
export function layoutGraph(
  input: ChangeGraph,
  options: LayoutOptions = {},
): GraphLayout {
  // Canonicalise first, so a caller that assembled the graph by hand gets the
  // same picture as one that read it back from JSON.
  const graph = sortGraph(input);
  const metrics = { ...DEFAULT_METRICS, ...options.metrics };
  const placed = measureNodes(graph, metrics, options.snippets);
  const byId = new Map(placed.map((n) => [n.id, n]));

  const edges = graph.edges.filter(
    (e) => byId.has(e.from.nodeId) && byId.has(e.to.nodeId),
  );

  assignRanks(placed, byId, edges);
  orderWithinRanks(placed, byId, edges);
  assignCoordinates(placed, byId, edges, metrics);

  const routed = routeEdges(edges, byId, metrics);
  const bounds = measureBounds(placed, metrics);

  return { nodes: placed, edges: routed, ...bounds, metrics };
}

// ---------------------------------------------------------------- measurement

function measureNodes(
  graph: ChangeGraph,
  metrics: LayoutMetrics,
  snippets?: Map<string, Snippet[]>,
): PlacedNode[] {
  const anchors = collectAnchors(graph);

  return graph.nodes.map((node) => {
    const rows = displayRows(node, snippets?.get(node.id) ?? [], {
      anchors: anchors.get(node.id) ?? [],
    });
    const widest = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
    const contentWidth =
      widest * metrics.charWidth +
      metrics.gutterWidth +
      metrics.rightGutterWidth +
      metrics.padding * 2;
    const titleWidth =
      titleLength(cardTitle(node)) * metrics.charWidth + metrics.padding * 4;

    const width = clamp(
      Math.max(contentWidth, titleWidth),
      metrics.minCardWidth,
      metrics.maxCardWidth,
    );
    // The cap keeps one 500-line addition from setting the height of the whole
    // drawing, but it must never hide a line something points at: an arrow into
    // the part a card has not unrolled says which file and not where, which is
    // the precision this tool exists for. The card grows to reach the last one.
    const reach = lastAnchoredRow(rows, anchors.get(node.id) ?? []);
    const visibleRows = Math.min(
      rows.length,
      Math.max(metrics.maxCardRows, reach + 1),
    );
    const hiddenRows = rows.length - visibleRows;
    // The truncation bar occupies a row of its own, so it is part of the height.
    const drawnRows = visibleRows + (hiddenRows > 0 ? 1 : 0);
    const height =
      rows.length === 0
        ? metrics.emptyCardHeight
        : metrics.titleHeight + metrics.padding * 2 + drawnRows * metrics.lineHeight;

    return {
      id: node.id,
      path: node.path,
      node,
      rows,
      x: 0,
      y: 0,
      width: Math.round(width),
      height: Math.round(height),
      rank: 0,
      order: 0,
      visibleRows,
      hiddenRows,
    };
  });
}

/**
 * Every position an arrow touches, grouped by the card it lands in.
 *
 * Collapsing needs this before rows exist: a line that an arrow points at must
 * survive, or the arrow would have nowhere to land and would fall back to the
 * card edge — losing exactly the precision the graph is for.
 */
/** How far down a card an arrow reaches, as a row index, or -1 for none. */
function lastAnchoredRow(
  rows: DisplayRow[],
  anchors: { side: Side; line: number }[],
): number {
  if (anchors.length === 0) return -1;

  const wanted = new Set(anchors.map((a) => `${a.side}:${a.line}`));
  let last = -1;
  rows.forEach((row, index) => {
    if (row.kind === "gap") return;
    if (
      (row.oldLine !== undefined && wanted.has(`base:${row.oldLine}`)) ||
      (row.newLine !== undefined && wanted.has(`head:${row.newLine}`))
    ) {
      last = index;
    }
  });
  return last;
}

function collectAnchors(graph: ChangeGraph): Map<string, { side: Side; line: number }[]> {
  const anchors = new Map<string, { side: Side; line: number }[]>();

  const add = (nodeId: string, side: Side, line: number) => {
    const list = anchors.get(nodeId) ?? [];
    list.push({ side, line });
    anchors.set(nodeId, list);
  };

  for (const edge of graph.edges) {
    add(edge.from.nodeId, edge.from.side, edge.from.line);
    add(edge.to.nodeId, edge.to.side, edge.to.line);
  }

  return anchors;
}

/**
 * How many characters of source a card of this width can show.
 *
 * Cards are clamped to a maximum width, so a long enough line will always
 * overflow one. Both renderers ask this so they cut at the same place, and so
 * neither ever draws text past its own border.
 */
export function textCapacity(width: number, metrics: LayoutMetrics): number {
  const available =
    width - metrics.padding * 2 - metrics.gutterWidth - metrics.rightGutterWidth;
  return Math.max(0, Math.floor(available / metrics.charWidth));
}

/** Truncates a line to fit, marking that something was cut. */
export function fitText(text: string, capacity: number): string {
  if (capacity <= 1 || text.length <= capacity) return text;
  return `${text.slice(0, capacity - 1)}…`;
}

/** Vertical offset of a row's centre from the top of its card. */
export function rowOffset(row: number, metrics: LayoutMetrics): number {
  return (
    metrics.titleHeight + metrics.padding + row * metrics.lineHeight +
    metrics.lineHeight / 2
  );
}

// -------------------------------------------------------------------- ranking

/**
 * Longest-path layering over the reference graph.
 *
 * Cycles are broken by dropping the back edges found in a depth-first walk that
 * visits nodes in canonical order, so which edge gets dropped is a property of
 * the graph rather than of the traversal that happened to run.
 */
function assignRanks(
  nodes: PlacedNode[],
  byId: Map<string, PlacedNode>,
  edges: Edge[],
): void {
  const successors = new Map<string, string[]>();
  for (const node of nodes) successors.set(node.id, []);
  for (const edge of edges) {
    if (edge.from.nodeId === edge.to.nodeId) continue;
    successors.get(edge.from.nodeId)!.push(edge.to.nodeId);
  }
  for (const list of successors.values()) list.sort();

  const state = new Map<string, "open" | "done">();
  const backEdges = new Set<string>();

  const visit = (id: string): void => {
    state.set(id, "open");
    for (const next of successors.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === "open") backEdges.add(`${id}->${next}`);
      else if (seen === undefined) visit(next);
    }
    state.set(id, "done");
  };
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);

  const forward = edges.filter(
    (e) =>
      e.from.nodeId !== e.to.nodeId &&
      !backEdges.has(`${e.from.nodeId}->${e.to.nodeId}`),
  );

  const connected = new Set<string>();
  for (const edge of forward) {
    connected.add(edge.from.nodeId);
    connected.add(edge.to.nodeId);
  }

  // Longest path: relax until stable. Bounded by the node count on a DAG.
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const edge of forward) {
      const from = byId.get(edge.from.nodeId)!;
      const to = byId.get(edge.to.nodeId)!;
      if (to.rank < from.rank + 1) {
        to.rank = from.rank + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Files with no references of their own form a trailing column rather than
  // crowding the sources; they are changes the reviewer reads on their own.
  const lastRank = nodes.reduce((max, n) => Math.max(max, n.rank), 0);
  for (const node of nodes) {
    if (!connected.has(node.id)) node.rank = lastRank + 1;
  }
}

// ------------------------------------------------------------------- ordering

/**
 * Barycentre ordering: a node sits near the average position of its neighbours.
 * Four sweeps in each direction, which is well past the point of diminishing
 * returns for the graph sizes a pull request produces.
 */
function orderWithinRanks(
  nodes: PlacedNode[],
  byId: Map<string, PlacedNode>,
  edges: Edge[],
): void {
  const ranks = groupByRank(nodes);
  for (const group of ranks) {
    group.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    group.forEach((node, i) => { node.order = i; });
  }

  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const node of nodes) {
    predecessors.set(node.id, []);
    successors.set(node.id, []);
  }
  for (const edge of edges) {
    if (edge.from.nodeId === edge.to.nodeId) continue;
    successors.get(edge.from.nodeId)!.push(edge.to.nodeId);
    predecessors.get(edge.to.nodeId)!.push(edge.from.nodeId);
  }

  const sweep = (group: PlacedNode[], neighbours: Map<string, string[]>) => {
    const key = new Map<string, number>();
    for (const node of group) {
      const linked = (neighbours.get(node.id) ?? [])
        .map((id) => byId.get(id))
        .filter((n): n is PlacedNode => n !== undefined);
      key.set(
        node.id,
        linked.length === 0
          ? node.order
          : linked.reduce((sum, n) => sum + n.order, 0) / linked.length,
      );
    }
    group.sort(
      (a, b) =>
        key.get(a.id)! - key.get(b.id)! ||
        a.order - b.order ||
        (a.path < b.path ? -1 : 1),
    );
    group.forEach((node, i) => { node.order = i; });
  };

  for (let pass = 0; pass < 4; pass++) {
    for (let r = 1; r < ranks.length; r++) sweep(ranks[r]!, predecessors);
    for (let r = ranks.length - 2; r >= 0; r--) sweep(ranks[r]!, successors);
  }
}

// ---------------------------------------------------------------- coordinates

function assignCoordinates(
  nodes: PlacedNode[],
  byId: Map<string, PlacedNode>,
  edges: Edge[],
  metrics: LayoutMetrics,
): void {
  const ranks = groupByRank(nodes);

  let x = metrics.margin;
  for (const group of ranks) {
    const columnWidth = group.reduce((max, n) => Math.max(max, n.width), 0);
    for (const node of group) {
      // Centre narrower cards in their column so the arrow gutters stay even.
      node.x = Math.round(x + (columnWidth - node.width) / 2);
    }
    x += columnWidth + metrics.columnGap;
  }

  const incoming = new Map<string, Edge[]>();
  for (const node of nodes) incoming.set(node.id, []);
  for (const edge of edges) incoming.get(edge.to.nodeId)?.push(edge);

  for (let r = 0; r < ranks.length; r++) {
    const group = [...ranks[r]!].sort((a, b) => a.order - b.order);

    // Aim each card at the height that would make its arrows horizontal, then
    // resolve overlaps by pushing downwards in the established order.
    const desired = group.map((node) => {
      if (r === 0) return undefined;
      const links = (incoming.get(node.id) ?? []).filter((e) => {
        const source = byId.get(e.from.nodeId);
        return source !== undefined && source.rank < node.rank;
      });
      if (links.length === 0) return undefined;

      const sum = links.reduce((total, edge) => {
        const source = byId.get(edge.from.nodeId)!;
        const sourceRow = anchorRowForLine(
          source.rows, edge.from.side, edge.from.line, source.visibleRows,
        );
        const sourceY =
          source.y +
          (sourceRow === undefined
            ? source.height / 2
            : rowOffset(sourceRow, metrics));
        const fileLevel = edge.kind === "import";
        const targetRow = fileLevel
          ? undefined
          : anchorRowForLine(node.rows, edge.to.side, edge.to.line, node.visibleRows);
        const offset = anchorOffset(node, targetRow, fileLevel, metrics);
        return total + (sourceY - offset);
      }, 0);
      return sum / links.length;
    });

    let cursor = metrics.margin;
    group.forEach((node, i) => {
      const target = desired[i];
      node.y = Math.round(Math.max(cursor, target ?? cursor));
      cursor = node.y + node.height + metrics.rowGap;
    });
  }

  // Pull the drawing back to the top-left without changing relative positions.
  const minY = nodes.reduce((min, n) => Math.min(min, n.y), Infinity);
  if (Number.isFinite(minY)) {
    const shift = metrics.margin - minY;
    for (const node of nodes) node.y += shift;
  }
}

// -------------------------------------------------------------------- routing

function routeEdges(
  edges: Edge[],
  byId: Map<string, PlacedNode>,
  metrics: LayoutMetrics,
): PlacedEdge[] {
  return edges.map((edge) => {
    const source = byId.get(edge.from.nodeId)!;
    const target = byId.get(edge.to.nodeId)!;

    // The call site of an import is a real line; its target is the file itself.
    const fileLevel = edge.kind === "import";
    const fromRow = anchorRowForLine(
      source.rows, edge.from.side, edge.from.line, source.visibleRows,
    );
    const toRow = fileLevel
      ? undefined
      : anchorRowForLine(target.rows, edge.to.side, edge.to.line, target.visibleRows);

    const fromY = source.y + anchorOffset(source, fromRow, false, metrics);
    const toY = target.y + anchorOffset(target, toRow, fileLevel, metrics);

    // Leave and enter by whichever borders face each other.
    const goesRight = target.x + target.width / 2 >= source.x + source.width / 2;
    const fromSide = goesRight ? "right" : "left";
    const toSide = goesRight ? "left" : "right";

    const placed: PlacedEdge = {
      id: edge.id,
      edge,
      from: { x: fromSide === "right" ? source.x + source.width : source.x, y: fromY },
      to: { x: toSide === "left" ? target.x : target.x + target.width, y: toY },
      fromSide,
      toSide,
    };
    if (fromRow !== undefined) placed.fromRow = fromRow;
    if (toRow !== undefined) placed.toRow = toRow;
    return placed;
  });
}

// --------------------------------------------------------------------- shared

/**
 * Where an arrow should meet a card.
 *
 * An import names a file, not a position in it. Pointing such an arrow at line
 * one lands it on whatever happens to be written there — a licence header, a
 * package declaration — which reads as a claim about that line. Anchoring at
 * the title says what is actually meant: this reference is to the file.
 */
function anchorOffset(
  node: PlacedNode,
  row: number | undefined,
  fileLevel: boolean,
  metrics: LayoutMetrics,
): number {
  if (fileLevel) return metrics.titleHeight / 2;
  return row === undefined ? node.height / 2 : rowOffset(row, metrics);
}

function groupByRank(nodes: PlacedNode[]): PlacedNode[][] {
  const maxRank = nodes.reduce((max, n) => Math.max(max, n.rank), 0);
  const ranks: PlacedNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const node of nodes) ranks[node.rank]!.push(node);
  return ranks;
}

function measureBounds(
  nodes: PlacedNode[],
  metrics: LayoutMetrics,
): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  }
  return { width: width + metrics.margin, height: height + metrics.margin };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
