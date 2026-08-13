import type {
  DisplayRow,
  FileNode,
  GraphLayout,
  LayoutMetrics,
  PlacedNode,
  Theme,
} from "@odin/core";

import type { CardTitle } from "../canvas/rows.js";
import type { Arrangement, ViewModel } from "../model.js";
import type { CardFace, DrawnCell, DrawnRow, Drawn, RowAt } from "./card.js";

/**
 * A laid-out graph, turned into the two things a drawing is rendered from.
 *
 * The components take a view model, because that is what every other target
 * hands them and a second shape would be a second thing to keep in step. The
 * host has a `GraphLayout` instead, so this is where one becomes the other.
 *
 * Nothing here calls into `@odin/core`, only reads its types. Everything the
 * application imports is bundled with it for the browser as well as for this
 * side, and core's entry point reaches `node:child_process` — so a single
 * runtime import of it would take the whole client build down. The three pieces
 * of arithmetic that had to come across are written out below; they are the
 * layout engine's own, and they are the reason the drawing lines up with the
 * arrows the layout engine placed.
 */
export interface DrawingOptions {
  theme: Theme;
  /** Every component's compiled styles, which only the package can reach. */
  css: string;
  includeImports?: boolean;
  includeUnchanged?: boolean;
}

export function drawingOf(
  layout: GraphLayout,
  options: DrawingOptions,
): { model: ViewModel; drawn: Drawn } {
  const { metrics } = layout;

  // One arrangement, not four. A page carries the change laid out with tests
  // and without, split and unified, because a reader can switch between them;
  // a file on disk is whichever one it was written as.
  const arrangement: Arrangement = {
    width: layout.width,
    height: layout.height,
    nodes: Object.fromEntries(
      layout.nodes.map((node) => [
        node.id,
        {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          column: node.rank,
        },
      ]),
    ),
  };

  const paths = new Map(layout.nodes.map((node) => [node.id, node.path]));
  const pathOf = (id: string): string => paths.get(id) ?? id;

  const model: ViewModel = {
    width: layout.width,
    height: layout.height,
    rowGap: metrics.rowGap,
    charWidth: metrics.charWidth,
    textLeft: metrics.padding + metrics.gutterWidth,
    padding: metrics.padding,
    gutterWidth: metrics.gutterWidth,
    columnGap: metrics.columnGap,
    margin: metrics.margin,
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      path: node.path,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      column: node.rank,
      isTest: node.node.isTest === true,
      language: node.node.language,
      untouched: node.node.status === "phantom",
      status: node.node.status,
      ...(node.node.kind ? { kind: node.node.kind } : {}),
    })),
    edges: layout.edges.map((placed) => ({
      id: placed.id,
      from: placed.edge.from.nodeId,
      to: placed.edge.to.nodeId,
      fromPath: pathOf(placed.edge.from.nodeId),
      toPath: pathOf(placed.edge.to.nodeId),
      fromLine: placed.edge.from.line,
      toLine: placed.edge.to.line,
      fromSide: placed.edge.from.side,
      toSide: placed.edge.to.side,
      change: placed.edge.change,
      kind: placed.edge.kind,
      confidence: placed.edge.confidence,
      symbol: placed.edge.to.symbolName ?? "",
      fromSymbol: placed.edge.from.symbolName ?? "",
      label: placed.edge.label ?? "",
    })),
    arrangements: { withTests: arrangement, withoutTests: arrangement },
    unified: layout.unified,
    // Everything the page's chrome is drawn from is left empty rather than
    // filled with something plausible. None of it is in the picture: an SVG has
    // no bar, no tabs and no threads, and a made-up pair of ref names would be
    // a claim about the change made by a file somebody attaches to a review.
    parts: [],
    meta: { baseRef: "", headRef: "" },
    canReview: false,
    review: "",
    viewer: "",
    viewerFace: "",
    comments: [],
  };

  const cards: Record<string, CardFace> = {};
  for (const node of layout.nodes) {
    cards[node.id] = faceOf(node, metrics, layout.unified);
  }

  return {
    model,
    drawn: {
      ink: options.theme,
      metrics,
      cards,
      css: options.css,
      includeImports: options.includeImports !== false,
      includeUnchanged: options.includeUnchanged === true,
    },
  };
}

/** One card's heading and every row of it, measured. */
function faceOf(
  node: PlacedNode,
  metrics: LayoutMetrics,
  unified: boolean,
): CardFace {
  const panes = unified || singlePane(node.node) ? 1 : 2;
  const capacity = textCapacity(node.width, metrics, panes);

  const rows: DrawnRow[] = node.pairs
    .slice(0, node.visibleRows)
    .map((pair, index) => {
      const row: DrawnRow = at(index, metrics);

      if (pair.band) {
        row.band = { text: pair.band.text };
        if (pair.band.header) row.band.header = pair.band.header;
        return row;
      }
      // A one-pane card shows whichever side the file exists on, so a deletion
      // is not drawn into an empty column beside a blank one.
      if (panes === 1) {
        row.left = cellOf(pair.right ?? pair.left, capacity);
        return row;
      }
      row.left = cellOf(pair.left, capacity);
      row.right = cellOf(pair.right, capacity);
      return row;
    });

  const face: CardFace = { title: titleOf(node.node), panes, rows };
  if (node.hiddenRows > 0) {
    face.more = {
      ...at(node.visibleRows, metrics),
      text: `${node.hiddenRows} more lines`,
    };
  }
  return face;
}

/** A line of code, cut to what its pane has room for. */
function cellOf(
  side: DisplayRow | undefined,
  capacity: number,
): DrawnCell | undefined {
  // An absent side and a band are the same thing to a pane: there is no line
  // here. Both are drawn as a faint fill rather than as nothing, so a row that
  // only one side has still reads as a row.
  if (!side || side.kind === "gap") return undefined;
  return {
    kind: side.kind,
    text: fitText(side.text, capacity),
    base: side.oldLine,
    head: side.newLine,
  };
}

/**
 * A card's heading, from the change rather than from the placement.
 *
 * The same six pieces `cardTitle` produces in the layout engine, worked out
 * again here for the reason at the top of this file. A count of zero is left
 * out on purpose: "+54 −0" reads as though something was removed, and invites a
 * second look at a file that only ever gained lines.
 */
function titleOf(node: FileNode): CardTitle {
  const untouched = node.status === "phantom";
  const additions =
    !untouched && node.stats.additions > 0 ? `+${node.stats.additions}` : "";
  const deletions =
    !untouched && node.stats.deletions > 0 ? `−${node.stats.deletions}` : "";

  return {
    name: basename(node.path),
    was: node.prevPath ? `← ${basename(node.prevPath)}` : "",
    // A schema card is not a file that nothing happened to; it is a drawing of
    // what the change talks to.
    stats:
      node.kind === "database"
        ? "schema"
        : untouched
          ? "untouched"
          : [additions, deletions].filter(Boolean).join(" "),
    additions,
    deletions,
    note:
      node.resolution === "unsupported"
        ? `no ${node.language} resolver`
        : node.resolution === "binary"
          ? "binary"
          : "",
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Whether a card is drawn as one column of code rather than two.
 *
 * A file that exists on one side only has one text to show, and a schema is not
 * a diff at all — it is a list of what the database holds, which has no before
 * and after to set beside each other.
 */
function singlePane(node: FileNode): boolean {
  return (
    node.kind === "database" ||
    node.status === "added" ||
    node.status === "deleted"
  );
}

/**
 * Where a row sits on its card: the top of its fill, and its baseline.
 *
 * The offset is the layout engine's own, and has to stay that way. Every arrow
 * in the drawing was aimed at a height this arithmetic produced, so a card that
 * placed its rows even slightly differently would have arrows arriving between
 * two lines and pointing at neither.
 */
function at(row: number, metrics: LayoutMetrics): RowAt {
  const middle =
    metrics.titleHeight +
    metrics.padding +
    row * metrics.lineHeight +
    metrics.lineHeight / 2;
  return {
    top: middle - metrics.lineHeight / 2,
    // Half a capital below the middle, less two: a monospace face's cap height
    // is a little under half its size, and rows placed on the arithmetic alone
    // ride low in their own bands.
    y: middle + metrics.fontSize / 2 - 2,
  };
}

/** How many characters one pane of a card this wide has room for. */
function textCapacity(
  width: number,
  metrics: LayoutMetrics,
  panes: number,
): number {
  const available = (width - metrics.padding * 2) / panes - metrics.gutterWidth;
  return Math.max(0, Math.floor(available / metrics.charWidth));
}

/** Truncates a line to fit, marking that something was cut. */
function fitText(text: string, capacity: number): string {
  if (capacity <= 1 || text.length <= capacity) return text;
  return `${text.slice(0, capacity - 1)}…`;
}
