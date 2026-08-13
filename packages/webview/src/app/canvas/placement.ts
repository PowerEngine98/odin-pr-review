/**
 * Where every card on the canvas ends up, and how much room they need.
 *
 * Nothing here reads the document or the reactive state — the placement is a
 * function of the change, the arrangement the engine chose for the reading in
 * force, and what the cards have measured so far. That is deliberate and it is
 * the same argument `wire.ts` makes about the arrows: this is the arithmetic
 * with the accumulators in it, the part that decides how wide the drawing is and
 * therefore what `fit` frames, and every question it answers is answerable at a
 * desk. Held in the camera module it could only be exercised by mounting a page.
 */

import type { Arrangement, NodeView, ViewModel } from "../model.js";
import { isSchema } from "./wire.js";

/** A card, at the coordinates the arrangement in force gives it. */
export interface Placed {
  node: NodeView;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One card's place in an arrangement. */
type Spot = Arrangement["nodes"][string];

/**
 * Everything the placement needs that is not in the view model.
 *
 * Passed in rather than read, so that the arithmetic below can be run at a desk:
 * it is the part with the accumulators in it, and the part that was wrong. The
 * camera does the reading, in three lines with nothing in them to get wrong.
 */
export interface Standing {
  /** The part of the change on screen, or nothing for the whole of it. */
  inPart: ReadonlySet<string> | null;
  showInfra: boolean;
  hideViewed: boolean;
  viewed: ReadonlySet<string>;
  /** What a card turned out to be, where a browser has drawn one. */
  measured: (id: string) => number | undefined;
}

/**
 * Positions for one part of the change, closed up.
 *
 * A part keeps the coordinates the whole change gave it, and those were chosen
 * with forty other files in the picture: columns as wide as the widest card
 * anywhere, rows spaced for cards that are no longer on screen. Read on its own,
 * a part of three files was three cards in the corners of an empty canvas.
 *
 * The cards keep their sizes and their column order, which is what the arrows
 * were routed around; only the space between them closes. Each column takes the
 * width of the widest card still in it, and the whole part is brought back to
 * the margin.
 *
 * Worked from the engine's own numbers rather than from the measured ones. What
 * closes here is empty space, and a card that turned out taller than it was
 * estimated at still starts where the engine put it — carrying that difference
 * down the column is the next pass's business, and doing it in both would
 * subtract the same space twice.
 */
export function packed(
  data: ViewModel,
  arrangement: Arrangement,
  inPart: ReadonlySet<string>,
): Arrangement {
  const columns = new Map<number, { id: string; spot: Spot }[]>();
  let top = Infinity;

  for (const node of data.nodes) {
    if (!inPart.has(node.id)) continue;
    const spot = arrangement.nodes[node.id];
    if (!spot) continue;
    const bucket = columns.get(spot.column);
    if (bucket) bucket.push({ id: node.id, spot });
    else columns.set(spot.column, [{ id: node.id, spot }]);
    top = Math.min(top, spot.y);
  }

  // Vertical bands nobody in this part occupies. Rows were spaced for files that
  // are no longer here, and a part read on its own should not open with two
  // screens of nothing between its second and third card. Gaps close to the same
  // clearance the engine leaves; the order and the rough alignment that keeps
  // arrows level survive, because only the empty stretches move.
  const spans: [number, number][] = [];
  for (const bucket of columns.values()) {
    for (const entry of bucket) {
      spans.push([entry.spot.y, entry.spot.y + entry.spot.height]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);

  const lifts: { from: number; by: number }[] = [];
  let lifted = 0;
  let reach = -Infinity;
  for (const span of spans) {
    if (reach !== -Infinity && span[0] - reach > data.rowGap) {
      lifted += span[0] - reach - data.rowGap;
    }
    lifts.push({ from: span[0], by: lifted });
    reach = Math.max(reach, span[1]);
  }

  const liftFor = (y: number): number => {
    let by = 0;
    for (const lift of lifts) {
      if (lift.from > y) break;
      by = lift.by;
    }
    return by;
  };

  const nodes: Arrangement["nodes"] = {};
  let x = data.margin;
  let right = data.margin;
  let bottom = data.margin;

  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const bucket = columns.get(column)!;
    const widest = bucket.reduce((max, e) => Math.max(max, e.spot.width || 0), 0);

    for (const entry of bucket) {
      const y = entry.spot.y - liftFor(entry.spot.y) - top + data.margin;
      // Centred in the column the way the engine centres them, so a narrow card
      // beside a wide one keeps its arrows level.
      const offset = Math.round((widest - (entry.spot.width || 0)) / 2);
      nodes[entry.id] = {
        x: x + offset,
        y,
        width: entry.spot.width,
        height: entry.spot.height,
        column: entry.spot.column,
      };
      bottom = Math.max(bottom, y + entry.spot.height);
      // The far edge of a card, not of the lane it sits in. Taking it after the
      // gap had been added left a column's worth of clearance hanging off the
      // right of a part that ends there, and the part then framed as though it
      // had another column nobody could see.
      right = Math.max(right, x + offset + (entry.spot.width || 0));
    }

    x += widest + data.columnGap;
  }

  return {
    nodes,
    width: Math.round(right + data.margin),
    height: Math.round(bottom + data.margin),
  };
}

/** Every card on the canvas, placed, and the room they need between them. */
export interface Layout {
  cards: Placed[];
  width: number;
  height: number;
}

/**
 * The drawing as it actually stands.
 *
 * The arrangement's own coordinates are treated as immutable and never written
 * back to, so there is exactly one source of truth to drift from — the previous
 * renderer nudged cards by a delta per action, and any action that reset
 * positions left those nudges recorded but no longer applied, so the next one
 * subtracted the same space twice and stacked cards on top of each other. Every
 * pass here starts from the engine's numbers and derives the whole answer.
 *
 * A vertex the arrangement has nothing to say about is not drawn: that is how
 * the layout engine says a file belongs to the other reading of the change.
 *
 * The heights are the measured ones where a card has been drawn and reported
 * itself, and the estimates until then. A card that turned out taller than it
 * was counted at pushes the rest of its column down by the difference, and a
 * running floor keeps the engine's clearance between neighbours — the shift
 * alone does not, because a card going away subtracts space, and if something
 * above it has grown the two can meet in the middle.
 *
 * Both sides of the extent come out of the cards this pass placed, and neither
 * is taken from the arrangement's own header. The header is the engine's answer
 * about every card in the change, laid out for one reading of it: read unified,
 * the arrangement in force is the one the engine drew for unified and its width
 * is a different number from the width the drawing is actually occupying; with a
 * part open, or the infrastructure hidden, most of that width is space the cards
 * that are gone left behind. Deriving both from what is on the canvas is what
 * makes the number true of the picture rather than of some other one — and it
 * reproduces the engine's own figure exactly when nothing has been filtered,
 * which is the case it was ever right in.
 */
export function place(
  data: ViewModel,
  whole: Arrangement,
  standing: Standing,
): Layout {
  const { inPart, measured } = standing;
  // A part is laid out for itself rather than shown in the space the whole
  // change left for it.
  const arrangement = inPart ? packed(data, whole, inPart) : whole;

  const columns = new Map<number, { node: NodeView; spot: Spot }[]>();
  for (const node of data.nodes) {
    if (inPart && !inPart.has(node.id)) continue;
    // A vertex standing for something outside the change goes when the reader
    // says they do not want it, whatever the arrangement holds. It leaves no
    // hole behind: it was never part of the spacing of this column.
    if (!standing.showInfra && isSchema(node.path)) continue;
    const spot = arrangement.nodes[node.id];
    if (!spot) continue;
    const bucket = columns.get(spot.column);
    if (bucket) bucket.push({ node, spot });
    else columns.set(spot.column, [{ node, spot }]);
  }

  const placed = new Map<string, Placed>();
  let tallest = 0;
  let widest = 0;

  for (const bucket of columns.values()) {
    bucket.sort((a, b) => a.spot.y - b.spot.y);

    let shift = 0;
    let floor = -Infinity;
    for (const { node, spot } of bucket) {
      const estimate = spot.height || node.height;
      // A file the change touched stays on the canvas whatever happens to it. It
      // goes quiet when it has been read — dimmed, its box ticked — but it does
      // not leave: the picture is of this change, and a change with its read
      // files removed is a picture of something else. What the switch takes away
      // is the untouched files, which are only here because something pointed at
      // them, and which have nothing left to say once that has been read.
      if (standing.hideViewed && node.untouched && standing.viewed.has(node.path)) {
        shift -= estimate + data.rowGap;
        continue;
      }

      const height = measured(node.id) ?? estimate;
      const y = Math.max(spot.y + shift, floor);
      floor = y + height + data.rowGap;
      shift += height - estimate;

      // The arrangement's width and not the node's. The node carries the width
      // the engine sized it at for the reading the page was built in, and the
      // reader may be in the other one; the card is drawn to fill what it is
      // placed in, so this is the width it will have on screen and the width
      // every arrow leaving it is aimed at.
      const width = spot.width || node.width;
      placed.set(node.id, { node, x: spot.x, y, width, height });
      tallest = Math.max(tallest, y + height);
      widest = Math.max(widest, spot.x + width);
    }
  }

  // Back into the model's own order, so that a filter re-places the cards
  // without also reordering the elements they are drawn as.
  const cards: Placed[] = [];
  for (const node of data.nodes) {
    const card = placed.get(node.id);
    if (card) cards.push(card);
  }

  // Room past the last card on each side. Nothing on the canvas is a drawing
  // with no extent — it is a drawing that has not arrived — so the model's own
  // figures stand in rather than a canvas of two margins.
  return {
    cards,
    width: cards.length ? Math.round(widest + data.margin) : data.width,
    height: tallest > 0 ? Math.round(tallest + data.margin) : data.height,
  };
}
