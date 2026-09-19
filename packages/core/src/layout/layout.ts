import { sortGraph } from "../graph/build.js";
import { components } from "../graph/components.js";
import type { ChangeGraph, Edge, FileNode, Side } from "../model/types.js";
import {
  anchorRowForLine,
  cardTitle,
  displayRows,
  pairRows,
  sideOf,
  singlePane,
  titleLength,
  type DisplayRow,
  type RowPair,
  type Snippet,
} from "./display.js";
import { folderOf } from "./folders.js";
import { DEFAULT_METRICS, type LayoutMetrics } from "./metrics.js";

export interface PlacedNode {
  id: string;
  path: string;
  node: FileNode;
  rows: DisplayRow[];
  /** The same rows with the two sides of the change laid out side by side. */
  pairs: RowPair[];
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
  /** One column of code per card rather than two. */
  unified: boolean;
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
  /**
   * One column of code rather than two.
   *
   * Unified reads as a diff does on the command line, and keeps cards narrow;
   * split puts the two sides beside each other, where a rewritten line and its
   * replacement share a row and both gutters carry a real number. The choice
   * changes how wide and how tall every card is, so it belongs to the layout
   * and not to the stylesheet.
   */
  unified?: boolean;
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
  const placed = measureNodes(graph, metrics, options.snippets, options.unified === true);
  const byId = new Map(placed.map((n) => [n.id, n]));

  const edges = graph.edges.filter(
    (e) => byId.has(e.from.nodeId) && byId.has(e.to.nodeId),
  );

  const parts = partOrder(graph);
  assignRanks(placed, byId, edges);

  const anchored = anchorEdges(edges, byId, metrics);
  const ranks = groupByRank(placed);
  assignColumns(ranks, metrics);
  orderWithinRanks(placed, ranks, anchored, parts, metrics);
  liftToTop(placed, metrics);

  const routed = routeEdges(anchored);
  const bounds = measureBounds(placed, metrics);

  return { unified: options.unified === true, nodes: placed, edges: routed, ...bounds, metrics };
}

/**
 * Width of the controls a card title carries at its end, plus their spacing.
 *
 * Copy the path, show the whole file, open it, mark it read, and the count of
 * what has been said about it. Set aside here rather than measured, because the
 * card is sized before anything is in a browser to measure.
 */
const TITLE_CONTROLS = 168;

/**
 * How wide a row needs the card to be, counted in characters.
 *
 * The line's own length, plus room for the mark that says the file ends without
 * a newline: it is drawn after the last character, and a card sized to the
 * characters alone would put it in the space it does not have and ellipsize it
 * away — which loses the one thing on that row the code does not show.
 */
/**
 * How wide a row is, counting what it is standing in front of.
 *
 * A band is a few characters — "⋯ 3 imports" — and the lines behind it are
 * whatever the file happens to say. Measuring only the band sized a card to its
 * own label: the reader opened it and the code inside came out clipped to
 * thirteen characters, because the card had never been told those lines
 * existed. A card that shrank to fit its folds is a card that cannot show what
 * unfolding reveals.
 *
 * So a band answers for the widest thing it hides. It costs width on cards that
 * are never expanded, and width is the cheaper mistake by a distance: nothing
 * is lost to a card being wider than it needed, and a line is lost to a card
 * being narrower.
 */
function roomFor(row: DisplayRow | undefined): number {
  if (!row) return 0;
  const own = row.text.length + (row.kind !== "gap" && row.noNewline ? 2 : 0);
  if (row.kind !== "gap" || !row.rows) return own;
  return row.rows.reduce((widest, hidden) => Math.max(widest, roomFor(hidden)), own);
}

// ---------------------------------------------------------------- measurement

function measureNodes(
  graph: ChangeGraph,
  metrics: LayoutMetrics,
  snippets?: Map<string, Snippet[]>,
  unified = false,
): PlacedNode[] {
  const anchors = collectAnchors(graph);

  return graph.nodes.map((node) => {
    const rows = displayRows(node, snippets?.get(node.id) ?? [], {
      anchors: anchors.get(node.id) ?? [],
    });
    // Unified is one row per line of the diff, with both gutters on the outside
    // of a single column of code; split pairs each removed line with the line
    // that replaced it. Both are described the same way -- a row is what the
    // card draws on one line -- so everything downstream counts the same thing.
    const pairs: RowPair[] = unified
      ? rows.map((row) =>
          row.kind === "gap" ? { band: row } : { left: row, right: row },
        )
      : pairRows(rows);

    // Split sizes the panes from the widest line on either side: they have to
    // be equal or the divider between them wanders down the card.
    //
    // Every line, because a wider card is never at the expense of a narrower
    // one: the panes are sized to what the card holds, and the cap is the only
    // thing that ever cuts. Sizing by the changed lines alone made a card that
    // an arrow lands on as narrow as the single line it lands on, and clipped
    // the context around it that was fetched to give the arrow somewhere to go.
    /*
     * Every row the card holds, bands included.
     *
     * Read off `rows` as well as off the pairs, because a band is not in a
     * pair's `left` or `right` — it sits in `band`, which the pane sums never
     * looked at. So a card whose long lines were all behind folds was sized to
     * the short ones in front of them: measured at twenty characters, holding
     * ninety-seven, and clipping every one of them the moment a reader opened
     * the fold.
     */
    const held = rows.reduce((max, row) => Math.max(max, roomFor(row)), 0);
    const widest = unified
      ? held
      : pairs.reduce(
          (max, pair) => Math.max(max, roomFor(pair.left), roomFor(pair.right)),
          held,
        );
    // A band runs across both panes, so it needs the whole width rather than
    // half of it — it is the one row that is not split.
    const widestBand = pairs.reduce(
      (max, pair) => Math.max(max, pair.band?.text.length ?? 0),
      0,
    );
    // A file that only exists on one side of the change has one pane: the other
    // would be blank from top to bottom, and a card twice as wide as it needs to
    // be to show that is a card that says nothing twice.
    const panes =
      unified || singlePane(node) ? 1 : 2;
    // One column of code has one column of picking marks, however many gutters
    // are around it: a unified row can start a remark from either side, but both
    // ends of a range are drawn at the head of the one piece of code there is.
    const contentWidth = unified
      ? widest * metrics.charWidth +
        metrics.gutterWidth +
        metrics.pickColumn +
        metrics.rightGutterWidth +
        metrics.padding * 2
      : Math.max(
          paneWidth(widest, metrics) * panes + metrics.padding * 2,
          widestBand * metrics.charWidth + metrics.gutterWidth + metrics.padding * 2,
        );
    // The controls at the end of a title — open the file, mark it read — are
    // not text, so they are not in titleLength. Without room set aside for them
    // a card sized to its own filename ends with them against its border.
    const titleWidth =
      titleLength(cardTitle(node)) * metrics.charWidth +
      metrics.padding * 4 +
      TITLE_CONTROLS;

    // As wide as the widest thing on the card, and never narrower than a card
    // is drawn. No upper bound: see `minCardWidth` for why there is not one.
    const width = Math.max(contentWidth, titleWidth, metrics.minCardWidth);
    // The cap is for tails of unchanged context, and for nothing else. A line
    // the change touched must never be behind it — the card is a picture of
    // that change, and hiding part of it behind a bar the reader has to find is
    // how a review misses something. A line an arrow points at is kept for the
    // same reason: an arrow into the part a card has not unrolled says which
    // file and not where.
    const reach = Math.max(
      lastChangedRow(pairs),
      lastAnchoredRow(pairs, anchors.get(node.id) ?? []),
    );
    const visibleRows = Math.min(
      pairs.length,
      Math.max(metrics.maxCardRows, reach + 1),
    );
    const hiddenRows = pairs.length - visibleRows;
    // The truncation bar occupies a row of its own, so it is part of the height.
    const drawnRows = visibleRows + (hiddenRows > 0 ? 1 : 0);
    const height =
      pairs.length === 0
        ? metrics.emptyCardHeight
        : metrics.titleHeight + metrics.padding * 2 + drawnRows * metrics.lineHeight;

    return {
      id: node.id,
      path: node.path,
      node,
      rows,
      pairs,
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
/** The last row the change itself touched, as an index, or -1 for none. */
function lastChangedRow(pairs: RowPair[]): number {
  let last = -1;
  pairs.forEach((pair, index) => {
    if (pair.left?.kind === "del" || pair.right?.kind === "add") last = index;
  });
  return last;
}

/** How far down a card an arrow reaches, as a row index, or -1 for none. */
function lastAnchoredRow(
  pairs: RowPair[],
  anchors: { side: Side; line: number }[],
): number {
  if (anchors.length === 0) return -1;

  const wanted = new Set(anchors.map((a) => `${a.side}:${a.line}`));
  const hit = (row?: DisplayRow): boolean =>
    row !== undefined &&
    row.kind !== "gap" &&
    ((row.oldLine !== undefined && wanted.has(`base:${row.oldLine}`)) ||
      (row.newLine !== undefined && wanted.has(`head:${row.newLine}`)));

  let last = -1;
  pairs.forEach((pair, index) => {
    if (hit(pair.left) || hit(pair.right)) last = index;
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
 * What one of a card's two panes takes up: its gutter, the column the picking
 * marks are drawn in, and this much code.
 *
 * Each pane pays for a column of its own, because each has its own numbering
 * and a remark begun in one is about that side of the change.
 */
export function paneWidth(characters: number, metrics: LayoutMetrics): number {
  return metrics.gutterWidth + metrics.pickColumn + characters * metrics.charWidth;
}

/**
 * How many characters of source one pane of a card this wide can show.
 *
 * Cards are clamped to a maximum width, so a long enough line will always
 * overflow one. Both renderers ask this so they cut at the same place, and so
 * neither ever draws text past its own border.
 */
export function textCapacity(
  width: number,
  metrics: LayoutMetrics,
  panes = 2,
): number {
  const available =
    (width - metrics.padding * 2) / panes -
    metrics.gutterWidth -
    metrics.pickColumn;
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

  /*
   * Every file any arrow touches at all, which is a wider net than `connected`
   * and deliberately so.
   *
   * `connected` is built from the forward edges, so a file whose only reference
   * was dropped as a back edge is not in it and is parked in the trailing
   * column along with the files that genuinely reference nothing. That has
   * always been true and is left alone. What must not happen is that such a
   * file is then dealt sideways into a lane, because it does have an arrow and
   * that arrow's direction is a claim the drawing is making. The lanes below
   * are safe precisely because the files in them have neither a caller nor a
   * callee, and this is the set that says so.
   */
  const touched = new Set<string>();
  for (const edge of edges) {
    touched.add(edge.from.nodeId);
    touched.add(edge.to.nodeId);
  }

  const parked = nodes.filter((node) => !connected.has(node.id));

  /*
   * Which lane each folder of unreferenced files is dealt into.
   *
   * The trailing column is not a lane in the dependency chain, it is the pile
   * of everything that is not in the chain — and on a real change it is most of
   * the change, because most files in a pull request reference nothing that the
   * pull request also touched. Measured on this repository's own history it ran
   * from two thirds to five sixths of the cards: two hundred and thirty-seven of
   * three hundred and twenty-seven on the largest. All of them queued in a
   * single column, which is a drawing a hundred times taller than it is wide,
   * and a reader who asked to see the whole thing was handed it at a scale where
   * a card is a speck. Grouped into folders it was worse rather than better,
   * because every folder in that column spans the same one column, so no two of
   * them could ever stand side by side and they stacked into one endless tower.
   *
   * Dealt by path and never by height, and that is the one thing here that is
   * not a matter of taste. Balancing the lanes by how tall each folder is packs
   * them far better and is unusable: the deal then depends on the contents of
   * the files, so an agent adding thirty lines to one file re-deals the entire
   * drawing underneath a reader who is looking at it. Measured, that moved some
   * other card two hundred and fifty-one thousand units, against five hundred
   * and forty for the same edit today. What is balanced instead is how many
   * files each folder holds, which is a fact about the change and not about its
   * contents: adding thirty lines to a file does not add a file, so the deal
   * comes out the same and the figure stays at exactly five hundred and forty —
   * the same as today, and better than today on how many cards move at all,
   * because folders spread across lanes means an edit disturbs fewer cards
   * below it.
   *
   * Counting rather than dealing them round in path order, which is what this
   * did first. Round-robin is stable in the same way and balances worse, and it
   * is brittle in a way that is easy to miss: the lane a folder lands in is its
   * position in the list, so a folder dropping out of the list moves every
   * folder after it by one and re-deals the whole drawing. That happens for real
   * — the mixed folders below leave the list — and on one change it put a third
   * back onto the height. Balancing by weight, a folder leaving takes only its
   * own weight with it.
   *
   * A folder at a time rather than a file at a time, because the point of the
   * exercise is that a folder's box can stand beside another one. Scattering a
   * folder's own files across the lanes would give its box every lane to span
   * and put it straight back in everybody's way.
   */
  const laneKey = (node: PlacedNode) => folderOf(node.path) ?? "";
  const loose = parked.filter((node) => !touched.has(node.id));

  /*
   * Where each folder already stands in the chain, for the folders that do.
   *
   * A folder is very often a mixture: one file in it calls something, and the
   * three beside it call nothing at all. Dealing the three off to a lane of
   * their own was answering the question "where do the files nobody references
   * go" without noticing that it had also answered "how wide is this folder's
   * box", and the second answer was much the worse of the two. A box is drawn
   * from its leftmost card to its rightmost, so a folder with one file in the
   * first column and one dealt to the last was drawn as a box straddling the
   * whole drawing — and a box that wide overlaps every other box there is, so
   * nothing could stand beside it and everything queued underneath it. A reader
   * saw two files with no arrow between them placed side by side as though the
   * drawing were claiming a relationship, a sibling folder pushed below one it
   * is not downstream of, and most of the width of its own box standing empty
   * between the two cards that defined it.
   *
   * So a loose file whose folder is already somewhere goes there instead. It
   * costs nothing to put it there: the box already reaches that column, so the
   * drawing gets no wider, and the file has no arrow so no claim about call
   * order is touched. What it buys is a box that is the width of its own
   * contents again.
   */
  const chainAt = new Map<string, number[]>();
  for (const node of nodes) {
    if (!connected.has(node.id)) continue;
    const key = laneKey(node);
    const seen = chainAt.get(key);
    if (seen) seen.push(node.rank);
    else chainAt.set(key, [node.rank]);
  }
  for (const [key, ranks] of chainAt) {
    chainAt.set(key, [...new Set(ranks)].sort((a, b) => a - b));
  }

  /*
   * Spread over the columns the folder already occupies, rather than all piled
   * into the first of them.
   *
   * Free, for the same reason the whole of this is free: the box reaches every
   * one of those columns whether or not anything of ours is standing in them,
   * so using them costs no width at all and saves the height of stacking five
   * loose files under one card. Dealt by path order, because the alternative is
   * to deal by how tall each file is and that is the deal that re-lays the
   * drawing every time somebody types.
   */
  const spread = new Map<string, number>();
  for (const node of [...loose].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const home = chainAt.get(laneKey(node));
    if (!home) continue;
    /*
     * A file the change did not write a line of goes in the first column and is
     * not spread at all.
     *
     * Which is almost always a rename. Git reports one as a file with a new
     * path and no hunks, so the card has a title and nothing under it — a
     * sliver a few lines high. Six of them spread across three columns for the
     * sake of balancing height that none of them has, and the folder's box was
     * then drawn from the first to the last: a rectangle most of the width of
     * the drawing, holding six slivers and, by area, almost nothing. A reader
     * called it a huge folder made for no reason, and was right.
     *
     * The spreading below is worth its width when the cards being spread are
     * tall, because that is height coming off the drawing. Here there is no
     * height to take off, so the width buys nothing and costs the box.
     *
     * Asked as "did the change write any lines into this file" rather than as
     * "is this card short", and the difference matters more than it looks. How
     * tall a card is depends on what is in it, so a rule reading that would
     * re-lay the drawing the moment an agent typed into one of these files. How
     * many hunks a file has is a fact about the change itself, and adding lines
     * to a file that has none is not an edit, it is a different change.
     */
    if (node.node.hunks.length === 0) {
      node.rank = home[0]!;
      continue;
    }
    const seen = spread.get(laneKey(node)) ?? 0;
    spread.set(laneKey(node), seen + 1);
    node.rank = home[seen % home.length]!;
  }

  // Whatever is left is a folder with nothing in the chain at all, and those
  // are the ones the lanes were made for.
  const adrift = loose.filter((node) => !chainAt.has(laneKey(node)));
  const weight = new Map<string, number>();
  for (const node of adrift) weight.set(laneKey(node), (weight.get(laneKey(node)) ?? 0) + 1);
  const folders = [...weight.keys()].sort((a, b) => weight.get(b)! - weight.get(a)! || a.localeCompare(b));
  const load = new Array(TRAILING_LANES).fill(0) as number[];
  const lanes = new Map<string, number>();
  for (const folder of folders) {
    let best = 0;
    for (let i = 1; i < load.length; i++) if (load[i]! < load[best]!) best = i;
    lanes.set(folder, best);
    load[best] = load[best]! + weight.get(folder)!;
  }

  for (const node of parked) {
    if (!touched.has(node.id) && chainAt.has(laneKey(node))) continue;
    // A parked file that an arrow still touches stays in the first lane, which
    // is the column it has always been in.
    const lane = touched.has(node.id) ? 0 : (lanes.get(laneKey(node)) ?? 0);
    node.rank = lastRank + 1 + lane;
  }
}

/**
 * How many columns the files that reference nothing are spread over.
 *
 * A trade between the two directions, and they are not worth the same. The
 * drawing is framed into a window that is wider than it is tall, so height is
 * the binding side by a long way — before this the largest change in this
 * repository's history came out eleven thousand units wide and one and a
 * quarter million tall, which is to say the width was never what the reader was
 * short of. Spending it to buy height back is very nearly free.
 *
 * Six rather than eight, which is the figure that measured slightly better on
 * the largest change alone. Past six the height stops coming down much on
 * anything smaller while the width keeps going up, and a change of forty files
 * does not have enough folders to fill eight lanes — it just pays for the empty
 * ones in white space. Six was within a few per cent of the best on the large
 * change and clearly better than eight everywhere below it.
 */
const TRAILING_LANES = 6;

// ------------------------------------------------------------------- ordering

/**
 * Which part of the change each file belongs to, in the order the parts are
 * offered.
 *
 * The tabs above the drawing already split a change into the pieces that do not
 * reach each other, largest first, with the files nothing calls at the end. The
 * drawing itself ignored that and laid every file out together, so a change of
 * six independent stories came out as one interleaved thicket — and the same
 * file sat in a different place depending on which tab was open.
 *
 * Grouping the whole drawing the way the parts are grouped costs nothing and
 * buys both: the parts stack down the canvas in the order they are listed, and
 * a part opened on its own keeps the shape it had in the picture of everything.
 */
function partOrder(graph: ChangeGraph): Map<string, number> {
  const rank = new Map<string, number>();
  const parts = components(graph);
  // Everything that stands alone shares the last place, the way the tabs put
  // them all under "on their own" rather than giving each its own name.
  const alone = parts.filter((p) => p.files > 1).length;
  const placeOf = (part: { files: number }, index: number) =>
    part.files > 1 ? index : alone;

  /*
   * The schema is filed with whatever points at it, not with whatever is
   * biggest.
   *
   * A database vertex is listed under every part of the change, because any
   * part may talk to it and a part read on its own still has to draw the card
   * its arrows end at. Left to the rule below — first claim wins, and the parts
   * arrive largest first — that made the schema a member of the largest part of
   * the change whether or not a single line of it ever touched the database.
   *
   * Which is not a harmless mislabelling, because a column is ordered by part
   * before it is ordered by where its arrows want it. The schema was pinned
   * among cards it shares no arrow with, while the stacking below put it at the
   * height its own arrows asked for; so it sat in a band of the drawing
   * belonging to work it has nothing to do with, and every card under it in that
   * column was pushed down past it to make room. The reader saw the database
   * card adrift from the files that read it, and a stretch of empty canvas where
   * those cards used to be.
   *
   * So it takes the place of the first part that actually points at it. Still
   * the largest such part, since the parts arrive in that order, which is the
   * one a reader is likeliest to have open when the database matters at all.
   */
  const pointedAt = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (node.kind === "database") pointedAt.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    pointedAt.get(edge.to.nodeId)?.add(edge.from.nodeId);
  }
  for (const [id, referrers] of pointedAt) {
    const found = parts.findIndex((part) =>
      part.nodeIds.some((member) => referrers.has(member)),
    );
    if (found >= 0) rank.set(id, placeOf(parts[found]!, found));
  }

  parts.forEach((part, index) => {
    const place = placeOf(part, index);
    // The first part that claims a file keeps it, and the parts arrive largest
    // first. Some files are in several — the schema is in all of them, and a
    // file the change never touched is in every part that leans on it — and a
    // card can only be in one place on the canvas. Letting the last claim win
    // would file those with the smallest part that mentions them, which is the
    // one a reader is least likely to be looking at when they matter.
    for (const id of part.nodeIds) if (!rank.has(id)) rank.set(id, place);
  });
  return rank;
}

/**
 * One end of an arrow, as the card at the other end feels it.
 *
 * `at` is how far down the neighbour the arrow leaves, `own` how far down this
 * card it arrives; so the height that would draw it flat is `other.y + at -
 * own`, and that subtraction is the only thing either pass ever asks of an
 * arrow.
 */
interface Pull {
  other: PlacedNode;
  at: number;
  own: number;
}

/**
 * Sweeps in each direction. Four was already past the point of diminishing
 * returns for the graph sizes a pull request produces, and the best-of rule
 * below means a wasted sweep costs time and never the picture.
 */
const ORDER_PASSES = 4;

/**
 * Orders the cards within each column so the arrows between columns are short.
 *
 * Two things separate this from the textbook sweep. The first is that the key
 * is a height in pixels and not a neighbour's index: cards differ in height by
 * two orders of magnitude here, so the fifth card in a column and the sixth can
 * be twenty thousand pixels apart, and an ordering built from indices was
 * answering a question about a drawing nobody was looking at. The second is the
 * median rather than the mean, because the thing being minimised is a sum of
 * absolute distances and the median is what minimises one.
 *
 * Sorting a column by where its arrows want it is also the best that ordering
 * alone can do, given that the cards are then packed downwards without
 * overlapping: two cards in the wrong relative order can only push each other
 * further from where they were aiming.
 */
function orderWithinRanks(
  nodes: PlacedNode[],
  ranks: PlacedNode[][],
  anchored: Anchored[],
  part: Map<string, number>,
  metrics: LayoutMetrics,
): void {
  // Files whose part is unknown sort after every known one rather than at the
  // front, which is where an absent number would otherwise put them.
  const partOf = (node: PlacedNode) => part.get(node.id) ?? part.size;
  const byPath = (a: PlacedNode, b: PlacedNode) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

  const above = new Map<string, Pull[]>();
  const below = new Map<string, Pull[]>();
  for (const node of nodes) {
    above.set(node.id, []);
    below.set(node.id, []);
  }
  // Only arrows that cross columns pull, and only forwards. An arrow inside a
  // column has no height it prefers, and one that runs backwards would pull a
  // card towards a column that has not been placed yet.
  for (const link of anchored) {
    if (link.source.rank >= link.target.rank) continue;
    above.get(link.target.id)!.push({
      other: link.source, at: link.fromOffset, own: link.toOffset,
    });
    below.get(link.source.id)!.push({
      other: link.target, at: link.toOffset, own: link.fromOffset,
    });
  }

  for (const group of ranks) {
    group.sort((a, b) => partOf(a) - partOf(b) || byPath(a, b));
    group.forEach((node, i) => { node.order = i; });
  }

  const stack = () => {
    for (const group of ranks) stackColumn(group, above, metrics);
  };

  const sweep = (group: PlacedNode[], links: Map<string, Pull[]>) => {
    const wanted = new Map<string, number>();
    for (const node of group) {
      const pulls = links.get(node.id)!;
      // A card nothing pulls on keeps the height it already has, so a sweep
      // moves it only when the cards around it have moved past it.
      wanted.set(node.id, pulls.length === 0 ? node.y : median(heights(pulls)));
    }
    // The part comes first and the pull second: a sweep may tidy a file's place
    // among its own part, never move it out of one.
    group.sort(
      (a, b) =>
        partOf(a) - partOf(b) ||
        wanted.get(a.id)! - wanted.get(b.id)! ||
        a.order - b.order ||
        byPath(a, b),
    );
    group.forEach((node, i) => { node.order = i; });
  };

  stack();
  let shortest = roadLength(anchored);
  let best = nodes.map((node) => node.order);
  // A sweep is a heuristic and can lengthen the drawing as easily as shorten
  // it, and the last sweep is not the best one often enough to matter. Keeping
  // the shortest order seen means the pass can never leave the drawing longer
  // than the plain path ordering it started from. Strictly shorter, so an order
  // that merely ties never displaces one the reader may already be looking at.
  const consider = () => {
    stack();
    const length = roadLength(anchored);
    if (length < shortest) {
      shortest = length;
      best = nodes.map((node) => node.order);
    }
  };

  for (let pass = 0; pass < ORDER_PASSES; pass++) {
    // Downwards, placing each column as it is settled so that the next one is
    // reading heights and not the ones from the pass before.
    for (let r = 1; r < ranks.length; r++) {
      sweep(ranks[r]!, above);
      stackColumn(ranks[r]!, above, metrics);
    }
    consider();
    for (let r = ranks.length - 2; r >= 0; r--) sweep(ranks[r]!, below);
    consider();
  }

  nodes.forEach((node, i) => { node.order = best[i]!; });
  stack();
}

/** Where the arrows would put a card, one height each. */
function heights(pulls: Pull[]): number[] {
  return pulls.map((pull) => pull.other.y + pull.at - pull.own);
}

/**
 * The middle of a list of heights.
 *
 * The median and not the mean, because a card is being placed to make a sum of
 * absolute distances small and that is the number a median minimises. One
 * outlying reference — a constants file called from the far end of the change —
 * used to drag a card halfway down the canvas away from the neighbours it
 * actually shares its arrows with.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Total vertical travel of every arrow.
 *
 * The whole of what ordering can change: how far apart the columns are is the
 * ranking's business and the widths', and ordering touches neither, so two
 * orders of the same graph differ in this and in nothing else.
 */
function roadLength(anchored: Anchored[]): number {
  let total = 0;
  for (const link of anchored) {
    total += Math.abs(
      link.source.y + link.fromOffset - (link.target.y + link.toOffset),
    );
  }
  return total;
}

// ---------------------------------------------------------------- coordinates

function assignColumns(ranks: PlacedNode[][], metrics: LayoutMetrics): void {
  let x = metrics.margin;
  for (const group of ranks) {
    /*
     * A rank with nothing in it reserves nothing.
     *
     * It used to charge a column gap for a column that was not there. A change
     * whose references all resolved outside itself has every card parked in the
     * trailing lanes and rank zero left standing empty, so the drawing opened
     * with a gap the width of a corridor and no card on the near side of it —
     * and a reader reads that as a column whose cards failed to load rather
     * than as a margin. Spreading the parked files over several lanes makes the
     * empty rank easier to produce, so it is worth not producing.
     */
    if (group.length === 0) continue;
    const columnWidth = group.reduce((max, n) => Math.max(max, n.width), 0);
    for (const node of group) {
      // Centre narrower cards in their column so the arrow gutters stay even.
      node.x = Math.round(x + (columnWidth - node.width) / 2);
    }
    x += columnWidth + metrics.columnGap;
  }
}

/**
 * Puts one column's cards down the page.
 *
 * Each aims at the height that would make the arrows arriving from the left
 * horizontal; overlaps are then resolved by pushing downwards in the order the
 * column was given, which is the order the pass above chose for exactly this.
 */
function stackColumn(
  group: PlacedNode[],
  above: Map<string, Pull[]>,
  metrics: LayoutMetrics,
): void {
  group.sort((a, b) => a.order - b.order);

  let cursor = metrics.margin;
  for (const node of group) {
    const pulls = above.get(node.id)!;
    const target = pulls.length === 0 ? cursor : median(heights(pulls));
    node.y = Math.round(Math.max(cursor, target));
    cursor = node.y + node.height + metrics.rowGap;
  }
}

/** Pulls the drawing back to the top without changing relative positions. */
function liftToTop(nodes: PlacedNode[], metrics: LayoutMetrics): void {
  const minY = nodes.reduce((min, n) => Math.min(min, n.y), Infinity);
  if (!Number.isFinite(minY)) return;
  const shift = metrics.margin - minY;
  for (const node of nodes) node.y += shift;
}

// -------------------------------------------------------------------- routing

/**
 * An arrow together with the two things about it that do not move: which row of
 * each card it touches, and how far down that card the row sits.
 *
 * Both are read off a card's own rows, so neither depends on where the card
 * ends up on the canvas. Working them out once is what lets the ordering pass
 * place the drawing repeatedly without paying for the anchors again.
 */
interface Anchored {
  edge: Edge;
  source: PlacedNode;
  target: PlacedNode;
  fromOffset: number;
  toOffset: number;
  fromRow: number | undefined;
  toRow: number | undefined;
}

function anchorEdges(
  edges: Edge[],
  byId: Map<string, PlacedNode>,
  metrics: LayoutMetrics,
): Anchored[] {
  return edges.map((edge) => {
    const source = byId.get(edge.from.nodeId)!;
    const target = byId.get(edge.to.nodeId)!;

    // The call site of an import is a real line; its target is the file itself.
    const fileLevel = edge.kind === "import";
    const fromRow = anchorRowForLine(
      sideOf(source.pairs, edge.from.side), edge.from.side, edge.from.line, source.visibleRows,
    );
    const toRow = fileLevel
      ? undefined
      : anchorRowForLine(sideOf(target.pairs, edge.to.side), edge.to.side, edge.to.line, target.visibleRows);

    return {
      edge,
      source,
      target,
      fromOffset: anchorOffset(source, fromRow, false, metrics),
      toOffset: anchorOffset(target, toRow, fileLevel, metrics),
      fromRow,
      toRow,
    };
  });
}

function routeEdges(anchored: Anchored[]): PlacedEdge[] {
  return anchored.map(({ edge, source, target, fromOffset, toOffset, fromRow, toRow }) => {
    // Leave and enter by whichever borders face each other.
    const goesRight = target.x + target.width / 2 >= source.x + source.width / 2;
    const fromSide = goesRight ? "right" : "left";
    const toSide = goesRight ? "left" : "right";

    const placed: PlacedEdge = {
      id: edge.id,
      edge,
      from: {
        x: fromSide === "right" ? source.x + source.width : source.x,
        y: source.y + fromOffset,
      },
      to: {
        x: toSide === "left" ? target.x : target.x + target.width,
        y: target.y + toOffset,
      },
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

