/**
 * The shape of every arrow in the drawing, worked out as numbers.
 *
 * Nothing here touches the document or the reactive state. That is deliberate:
 * the geometry is the part that was hardest to get right — a head that floats
 * off the end of a curve, a stem that shows through the triangle it feeds, a
 * junction that lands on top of the card it left — and every one of those is a
 * question about four points, answerable at a desk. Under the old renderer the
 * same arithmetic was spread between the markup it was first drawn with and the
 * script that redrew it on every filter, and the two drifted: the dot at an
 * arrow's head moved two pixels further out in one of them and nowhere else.
 *
 * Positions are in canvas units throughout. The canvas is a single transformed
 * layer, so none of this changes with pan or zoom, and none of it needs to be
 * recomputed when the camera moves.
 */

import type { Arrangement, EdgeView, NodeView, ViewModel } from "../model.js";

export interface Point {
  x: number;
  y: number;
}

/** A card, as far as an arrow is concerned. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far the arrow head reaches back from the line's end. */
export const HEAD = 13;
/** How far the dot an arrow sets out from sits from the card. */
export const PORT_GAP = 9;
/**
 * How far the dot that comes home sits from the card it lands at.
 *
 * Further out than the one it left, because the arrow head is already occupying
 * the border here: at the same gap the dot and the triangle overlapped, and the
 * dot read as a blob on the end of the arrow rather than as something to press.
 */
export const HOME_GAP = 11;
/**
 * Where a line starting at the dot starts.
 *
 * The dot's own radius, which is the middle of its ring rather than the outside
 * of it: a line stopping cleanly at the outer edge leaves a hairline of
 * background between the two. This tucks the end under the ring instead.
 */
export const PORT_RIM = 4.5;
/**
 * Where an arrow about a whole file meets the card.
 *
 * An import names the file, so it arrives at the title rather than at a line.
 * Half a title's height, in the ordinary case where nobody has measured one —
 * the cards can say better, and when they do this is not consulted.
 */
const TITLE_MID = 17;

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function pointAt(p: Point[], t: number): Point {
  const a = mix(p[0]!, p[1]!, t);
  const b = mix(p[1]!, p[2]!, t);
  const c = mix(p[2]!, p[3]!, t);
  return mix(mix(a, b, t), mix(b, c, t), t);
}

export function bezier(p: Point[]): string {
  return (
    `M ${p[0]!.x} ${p[0]!.y} C ${p[1]!.x} ${p[1]!.y}, ` +
    `${p[2]!.x} ${p[2]!.y}, ${p[3]!.x} ${p[3]!.y}`
  );
}

/**
 * The same curve with its last `back` pixels taken off.
 *
 * Cut with de Casteljau rather than by stepping back along the end tangent: the
 * curve is at its most bent right where it arrives, so a straight backoff of a
 * head's length lands off the line and leaves a visible kink.
 *
 * The points come back rounded. Every one of them is about to be printed into a
 * path attribute, and full double precision writes sixteen digits per number
 * for a difference nothing can see.
 */
export function shorten(p: Point[], back: number): Point[] {
  const steps = 96;
  const seen: Point[] = [];
  for (let i = 0; i <= steps; i++) seen.push(pointAt(p, i / steps));

  let travelled = 0;
  let t = 0;
  for (let i = steps; i > 0; i--) {
    const step = Math.hypot(seen[i]!.x - seen[i - 1]!.x, seen[i]!.y - seen[i - 1]!.y);
    if (travelled + step >= back) {
      // Between two samples, not at one of them. On a long arrow a single step
      // is tens of pixels, and stopping at the near end of it leaves the head
      // floating that far off the end of the line.
      t = (i - 1 + (travelled + step - back) / (step || 1)) / steps;
      break;
    }
    travelled += step;
  }

  const a = mix(p[0]!, p[1]!, t);
  const b = mix(p[1]!, p[2]!, t);
  const c = mix(p[2]!, p[3]!, t);
  const d = mix(a, b, t);
  const e = mix(b, c, t);
  return [p[0]!, a, d, mix(d, e, t)].map((q) => ({ x: round(q.x), y: round(q.y) }));
}

/** The point on the dot's rim that faces the far end of the arrow. */
export function rim(cx: number, cy: number, tx: number, ty: number): Point {
  const dx = tx - cx;
  const dy = ty - cy;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: round(cx + (dx / length) * PORT_RIM),
    y: round(cy + (dy / length) * PORT_RIM),
  };
}

/** Where an arrow meets a card: which card, and the line's height on it. */
export interface Anchor {
  box: Box;
  y: number;
}

/**
 * One arrow, as the handful of paths and points it is drawn from.
 *
 * `from` and `to` are on the cards' borders and are what the camera travels to;
 * `port` and `home` are the two dots, which sit clear of the border on either
 * side; `start` is where the drawn line actually begins, on the outgoing dot's
 * rim.
 */
export interface Wire {
  goesRight: boolean;
  from: Point;
  to: Point;
  port: Point;
  home: Point;
  start: Point;
  hit: string;
  stem: string;
  head: string;
}

/**
 * An arrow, as three paths: what you press, what is drawn, and the head.
 *
 * The line does not run the whole way at either end. It starts on the rim of the
 * dot — drawn from the card it went straight through the dot and out again, so
 * the dot read as a bead threaded onto the line rather than the thing the line
 * leaves from — and it stops where the head begins, since a stem carried on
 * underneath a filled triangle shows as a lump at the join.
 *
 * Which sides it uses is decided by where the cards are, not by which checkout
 * the two ends live in: an arrow leaves by the border facing its destination.
 */
export function route(from: Anchor, to: Anchor): Wire {
  const goesRight = to.box.x + to.box.width / 2 >= from.box.x + from.box.width / 2;
  const away = goesRight ? 1 : -1;
  const fromX = goesRight ? from.box.x + from.box.width : from.box.x;
  const toX = goesRight ? to.box.x : to.box.x + to.box.width;

  const dx = Math.max(40, Math.abs(toX - fromX) * 0.45);
  const c1 = goesRight ? fromX + dx : fromX - dx;
  const c2 = goesRight ? toX - dx : toX + dx;

  // Clear of the card, not on its edge: half a dot under the border is a
  // smudge, and this one is meant to be pressed.
  const port = { x: fromX + away * PORT_GAP, y: from.y };
  const start = rim(port.x, port.y, toX, to.y);

  const points: Point[] = [
    start,
    { x: c1, y: from.y },
    { x: c2, y: to.y },
    { x: toX, y: to.y },
  ];
  const cut = shorten(points, HEAD);

  return {
    goesRight,
    from: { x: fromX, y: from.y },
    to: { x: toX, y: to.y },
    port,
    home: { x: toX + away * HOME_GAP, y: to.y },
    start,
    hit: bezier(points),
    stem: bezier(cut),
    // The head rides its own segment so it can be oriented and placed without
    // anything drawn along it — the stroke is off, only the marker shows.
    head: `M ${cut[3]!.x} ${cut[3]!.y} L ${toX} ${to.y}`,
  };
}

/**
 * What has to match for two references to be drawn as one road.
 *
 * The same source card, the same destination row, and the same kind of change.
 * An added reference and a removed one to the same table are two different
 * facts and stay two arrows.
 */
export function runKey(edge: EdgeView): string {
  return [edge.from, edge.to, edge.toLine, edge.toSide, edge.change, edge.kind].join("|");
}

/** An arrow with everything the layers need to draw it. */
export interface Arrow {
  edge: EdgeView;
  /** Reaches the database rather than a file, and is coloured and filtered so. */
  schema: boolean;
  wire: Wire;
  /** The run this one travels with, or nothing when it travels alone. */
  run: string | null;
  /** Whether this is the one carrying its run's road and head. */
  carrier: boolean;
  hit: string;
  stem: string;
  head: string;
  trunk: string;
  road: string;
}

/**
 * Where following an arrow takes the camera, and which card should flash.
 *
 * The point travels with the request rather than being looked up when it
 * arrives: this layer is the only one that knows where an arrow's ends came out,
 * and by the time the camera has finished moving those numbers would be stale.
 */
export interface Journey {
  edge: EdgeView;
  nodeId: string;
  x: number;
  y: number;
}

/** How the reader has the drawing set up, as far as the arrows are concerned. */
export interface Reading {
  unified: boolean;
  showTests: boolean;
  showImports: boolean;
  showUnchanged: boolean;
  showInfra: boolean;
  hideViewed: boolean;
  part: string | null;
  viewed: ReadonlySet<string>;
}

/**
 * Where a line sits inside its card, measured from the card's top.
 *
 * Only the cards can answer this: a row can be folded into a band, held below
 * the height cap, or hidden with the reading it belongs to, and the honest
 * answer is then the position of whatever stands in for it. Relative to the
 * card rather than to the canvas so that the answer survives the card being
 * moved — which happens on every filter, after the rows have been measured.
 */
export type LineAt = (
  nodeId: string,
  side: "base" | "head",
  line: number,
  fileLevel: boolean,
) => number | null;

export interface Scene {
  model: ViewModel;
  reading: Reading;
  /** Where the cards actually ended up, when something has placed them. */
  boxes?: Record<string, Box>;
  lineAt?: LineAt;
}

/**
 * The placement in force.
 *
 * A card is a different width and height split than it is unified, and taller
 * with the tests in than with them out, so the way the change is being read
 * picks a whole arrangement rather than a stylesheet. Falls back to the one the
 * page was rendered in when the other was never computed — a graph built before
 * the alternate existed still has to draw.
 */
export function arrangementFor(model: ViewModel, reading: Reading): Arrangement {
  const primary = reading.unified === model.unified;
  const key = reading.showTests ? "withTests" : "withoutTests";
  const other = reading.showTests ? "otherWithTests" : "otherWithoutTests";
  return (primary ? model.arrangements[key] : model.arrangements[other]) ??
    model.arrangements[key];
}

/**
 * The vertices that stand for something outside the change.
 *
 * The view model says what a card's file is and what happened to it, not what
 * kind of thing it is, and the schema is the one vertex that is not a file
 * anybody wrote. Its path is the signal the host leaves behind.
 */
export function isSchema(path: string): boolean {
  return path.startsWith("database/");
}

/** The file a vertex stands for, or its id when nothing better is known. */
export function pathOf(nodes: NodeView[], id: string): string {
  return nodes.find((n) => n.id === id)?.path ?? id;
}

/** An element id from something that came out of a file path. */
export function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Whether the reader has asked to see this reference at all.
 *
 * Every filter that can take an arrow away, in one place, because two things
 * need the same answer: the layer that draws the arrows, and the cards, which
 * box the word at each end of one. The box is the arrow saying which name it is
 * about, so a box without its arrow is a mark on a word with nothing pointing
 * at it — a reference the reader is invited to look for and cannot find. Asked
 * twice, in two spellings, the two drift, and the way that shows is boxes
 * surviving a filter the arrows obeyed.
 *
 * This is only the reader's filters. Whether both ends actually landed on the
 * canvas is a separate question, and the answer to it is a measurement.
 */
export function wantedEdges(
  model: ViewModel,
  reading: Reading,
): ((edge: EdgeView) => boolean) & { structural: (edge: EdgeView) => boolean } {
  const schema = new Set(model.nodes.filter((n) => isSchema(n.path)).map((n) => n.id));
  const part = reading.part
    ? new Set(model.parts.find((p) => p.id === reading.part)?.nodes ?? [])
    : null;

  // An arrow into or out of a schema card describes the shape of the database
  // rather than a change to it, and is never hidden by a filter about
  // references that did not change.
  const structural = (edge: EdgeView) => schema.has(edge.from) || schema.has(edge.to);

  const wanted = (edge: EdgeView): boolean => {
    const infra = structural(edge);
    if (edge.kind === "import" && !reading.showImports) return false;
    if (edge.change === "unchanged" && !infra && !reading.showUnchanged) return false;
    if (infra && !reading.showInfra) return false;
    if (part && (!part.has(edge.from) || !part.has(edge.to))) return false;
    if (
      reading.hideViewed &&
      (reading.viewed.has(pathOf(model.nodes, edge.from)) ||
        reading.viewed.has(pathOf(model.nodes, edge.to)))
    ) {
      return false;
    }
    return true;
  };

  return Object.assign(wanted, { structural });
}

/**
 * Every arrow that is on screen, routed and gathered.
 *
 * Arrows the reader has filtered away are left out rather than drawn and
 * hidden. That is not only cheaper: the gathering below has to work on what is
 * actually visible, and a run of four whose other three are filtered out is not
 * a run at all — it is one arrow, and it should be drawn as one, head and all.
 */
export function arrows(scene: Scene): Arrow[] {
  const { model, reading, boxes, lineAt } = scene;
  const arrangement = arrangementFor(model, reading);
  const wanted = wantedEdges(model, reading);

  const sizes = new Map(model.nodes.map((n) => [n.id, n] as const));

  const boxOf = (id: string): Box | null => {
    // Once the canvas has said where the cards are, that is the only answer.
    //
    // Falling back to the arrangement looks harmless and is not: the canvas's
    // boxes are measured and, when one part is open, packed back to the
    // margin, while the arrangement still holds the estimates for the whole
    // change. Mixing them puts one end of an arrow in a coordinate system the
    // other end is not in, and the arrow leaves for where the card would have
    // been if nothing had been filtered — across the drawing and off the edge
    // of it. A card the canvas did not place is a card that is not on screen,
    // and an arrow to it is not a shorter arrow, it is no arrow.
    const placed = boxes ? boxes[id] : arrangement.nodes[id];
    if (!placed) return null;
    // An arrangement can carry a card's place without its size when the layout
    // engine had nothing to measure. Zero width puts both borders in the same
    // spot, and the arrow then leaves by the wrong side of the card.
    const node = sizes.get(id);
    return {
      x: placed.x,
      y: placed.y,
      width: placed.width || node?.width || 0,
      height: placed.height || node?.height || 0,
    };
  };

  const anchor = (
    id: string,
    side: "base" | "head",
    line: number,
    fileLevel: boolean,
  ): Anchor | null => {
    const box = boxOf(id);
    if (!box) return null;
    const measured = lineAt?.(id, side, line, fileLevel);
    if (measured != null) return { box, y: box.y + measured };
    // Nothing has measured the rows yet — the first paint, or a card asleep.
    // The middle of the card is the one position that is never wrong about
    // which card the arrow belongs to, which is what the reader reads first.
    return { box, y: box.y + (fileLevel ? TITLE_MID : box.height / 2) };
  };

  const drawn: Arrow[] = [];
  const runs = new Map<string, Arrow[]>();

  for (const edge of model.edges) {
    if (!wanted(edge)) continue;
    const structural = wanted.structural(edge);

    // The name matters at both ends: a call site whose row is folded away is
    // found the same way its definition is, rather than falling back to the
    // band and leaving the arrow to start from a stretch of unchanged code.
    const from = anchor(edge.from, edge.fromSide, edge.fromLine, false);
    const to = anchor(edge.to, edge.toSide, edge.toLine, edge.kind === "import");
    if (!from || !to) continue;

    const wire = route(from, to);
    const arrow: Arrow = {
      edge,
      schema: structural,
      wire,
      run: null,
      carrier: false,
      hit: wire.hit,
      stem: wire.stem,
      head: wire.head,
      trunk: "",
      road: "",
    };
    drawn.push(arrow);

    const key = runKey(edge);
    const run = runs.get(key);
    if (run) run.push(arrow);
    else runs.set(key, [arrow]);
  }

  for (const [key, run] of runs) gather(key, run);
  return drawn;
}

/**
 * Several references to one place, drawn as one road.
 *
 * A file that reads the same table on ten lines drew ten curves along the same
 * corridor, arriving at the same row: ten times the ink for one fact, and a
 * thicket where a single arrow would have said it. They are gathered instead —
 * a short stem from each line to a junction just clear of the card, and one
 * line from there to where they are all going.
 */
function gather(key: string, run: Arrow[]): void {
  if (run.length < 2) return;

  // The junction sits clear of the card the arrows leave, at the middle of the
  // lines it gathers: near enough that each stem is obviously a stem, far
  // enough that they have separated from their own rows.
  const first = run[0]!.wire;
  const reach = Math.abs(first.to.x - first.from.x);
  const away = first.goesRight ? 1 : -1;
  const joinX = first.from.x + away * Math.max(46, Math.min(160, reach * 0.16));
  const joinY = run.reduce((sum, r) => sum + r.wire.from.y, 0) / run.length;

  for (const arrow of run) {
    // Each line keeps its own short stem into the junction, so the row it comes
    // from is still the thing you press and still says where it is.
    const start = arrow.wire.start;
    const bend = Math.max(18, Math.abs(joinX - start.x) * 0.55);
    const stem = bezier([
      start,
      { x: start.x + away * bend, y: start.y },
      { x: joinX - away * bend, y: joinY },
      { x: joinX, y: joinY },
    ]);
    arrow.run = key;
    arrow.stem = stem;
    arrow.hit = stem;
    // The head is drawn once, at the far end of the road, by whichever of them
    // carries it. One triangle per stem would put a row of them at the junction.
    arrow.head = "";
  }

  const carrier = run[0]!;
  const to = carrier.wire.to;
  const dx = Math.max(40, Math.abs(to.x - joinX) * 0.45);
  const road: Point[] = [
    { x: joinX, y: joinY },
    { x: joinX + away * dx, y: joinY },
    { x: to.x - away * dx, y: to.y },
    to,
  ];
  const cut = shorten(road, HEAD);
  carrier.carrier = true;
  carrier.trunk = bezier(cut);
  // The road is most of what the eye follows, so it is what the pointer finds.
  // Its own hit area, along the whole of it, rather than the stem's.
  carrier.road = bezier(road);
  carrier.head = `M ${cut[3]!.x} ${cut[3]!.y} L ${to.x} ${to.y}`;
}
