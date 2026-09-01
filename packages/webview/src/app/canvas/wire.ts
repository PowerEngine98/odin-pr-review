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

import { highways, type Highway } from "@odin/core/layout/highways.js";
import {
  roadAround,
  roadEnd,
  roadOver,
  roadPath,
  roadPoints,
  round,
  shortenRoad,
  type Blocking,
} from "@odin/core/layout/roads.js";

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

/*
 * The curve maths that used to live here is gone.
 *
 * `mix`, `pointAt`, `bezier` and `shorten` existed to draw a cubic and to cut
 * the head's length off the end of one, which had to be done with de Casteljau
 * because a curve is at its most bent exactly where it arrives. A road's last
 * leg is straight, so that is subtraction, and the shape itself is now
 * `roadPath` in the layout — shared, because three renderers draw these and an
 * arrow that changed shape when the page booted would be a picture moving for
 * no reason anybody can see.
 */


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
  /** The corners the road turns at, for whoever has to draw over them. */
  corners: Point[];
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
export function route(
  from: Anchor,
  to: Anchor,
  /**
   * Every other card on the drawing, so a road can go around them.
   *
   * Empty for a first paint that has not placed anything, where the road takes
   * the plain way and is re-planned the moment the cards say where they are.
   */
  walls: readonly Blocking[] = [],
): Wire {
  /*
   * Which side of each card the road uses, chosen by what it costs.
   *
   * Middles are the wrong question whenever two cards overlap in x, and on a
   * drawing of files that is common: a wide card and a narrow one in
   * neighbouring columns, or a card that grew when its rows were measured. The
   * middle of a wide destination can sit to the left of a narrow source while
   * its right-hand edge is far to the right — so the road left by the source's
   * left side and then travelled right across the card it had just left, past
   * its own beginning, to reach an edge on the far side of everything. What
   * that draws is a hook: out, back over itself, and away.
   *
   * There are only four ways to join two cards side to side, so all four are
   * costed and the cheapest wins. The cost is the distance, plus a heavy charge
   * for setting off in one direction and arriving from the other — that is the
   * hook, and it is worth a long way round to avoid it.
   */
  const options = [
    { leaves: from.box.x + from.box.width, out: 1, lands: to.box.x, in: 1 },
    { leaves: from.box.x + from.box.width, out: 1, lands: to.box.x + to.box.width, in: -1 },
    { leaves: from.box.x, out: -1, lands: to.box.x, in: 1 },
    { leaves: from.box.x, out: -1, lands: to.box.x + to.box.width, in: -1 },
  ];

  let best = options[0]!;
  let cheapest = Infinity;
  for (const option of options) {
    const travel = option.lands - option.leaves;
    // Setting off the wrong way for where it lands: the road has to come back
    // across the card it just left.
    const doubling = Math.sign(travel) !== 0 && Math.sign(travel) !== option.out;
    // And arriving the wrong way round the destination, which puts the head on
    // the far side of the card it is pointing into.
    const wrongEnd = Math.sign(travel) !== 0 && Math.sign(travel) !== option.in;
    const cost = Math.abs(travel) + (doubling ? 100_000 : 0) + (wrongEnd ? 100_000 : 0);
    if (cost < cheapest) {
      cheapest = cost;
      best = option;
    }
  }

  const goesRight = best.out > 0;
  const away = best.out;
  const fromX = best.leaves;
  const toX = best.lands;
  /*
   * Which way the road is pointing when it arrives, which is not always the way
   * it set off. Everything about the last few pixels follows the arrival: the
   * head, the dot just inside the destination, and the channel the road turns
   * in before it gets there.
   */
  const into = best.in;

  // Clear of the card, not on its edge: half a dot under the border is a
  // smudge, and this one is meant to be pressed.
  const port = { x: fromX + away * PORT_GAP, y: from.y };
  /*
   * Straight out of the dot rather than aimed at the far end.
   *
   * A road leaves horizontally, so the line starts at the side of the dot the
   * road runs from — aiming it at the destination would put the first pixel of
   * a straight line at an angle to it.
   */
  const start = { x: round(port.x + away * PORT_RIM), y: port.y };

  const arrive = { x: toX, y: to.y };
  const arrivesRight = into > 0;
  const points = detours.on
    ? planned(start, arrive, arrivesRight, walls, from.box, to.box)
    : roadPoints(start, arrive, arrivesRight);
  const cut = shortenRoad(points, HEAD);
  const last = roadEnd(cut);

  return {
    goesRight,
    corners: points,
    from: { x: fromX, y: from.y },
    to: { x: toX, y: to.y },
    port,
    // Just inside the destination's own edge, whichever edge the road came to.
    home: { x: toX + into * HOME_GAP, y: to.y },
    start,
    hit: roadPath(points),
    stem: roadPath(cut),
    // The head rides its own segment so it can be oriented and placed without
    // anything drawn along it — the stroke is off, only the marker shows.
    head: `M ${last.x} ${last.y} L ${toX} ${to.y}`,
  };
}

/*
 * Roads already planned, by the ends they join.
 *
 * The arrows are worked out again whenever anything about the drawing changes,
 * and most of what changes does not move a card: a filter, a part opening, a
 * hover. Planning is cheap for one road and there are hundreds of them, so the
 * same answer was being computed dozens of times over during a boot — five
 * seconds of it, measured, on a change of a hundred and thirty files.
 *
 * Keyed by the two ends and thrown away whole whenever the cards move, which is
 * the only thing that can change the answer.
 */
const planning = new Map<string, Point[]>();
/**
 * And where each road hops another, by the same key.
 *
 * Worked out once per placement for the same reason the roads are: finding the
 * crossings means comparing every pair of roads, and the arrows are rebuilt
 * whenever anything about the drawing changes — a filter, a hover, a part
 * opening. Measured on a change of a hundred and thirty files, doing it every
 * time was twenty-four seconds of a boot; doing it once is a fifth of a second.
 */
const bridging = new Map<string, string>();

/**
 * How a second pass gets scheduled, filled in by the page.
 *
 * The crossings cannot be found until every road is planned, and planning them
 * all is the last thing the first frame does — so the sweep happens after that
 * frame rather than inside it. Which "after" means is the drawing's business,
 * not this module's.
 */
export const secondPass: { run: ((go: () => void) => void) | null } = { run: null };
let plannedFor = "";

/**
 * Whether roads are planned around the cards yet.
 *
 * They are worth planning once, and during the first build the cards move on
 * every pass: each measured card changes the map, which throws away every road
 * planned against the old one. Measured on a change of two hundred files, that
 * was two and a half seconds of the boot spent planning roads around
 * arrangements nobody ever saw — the drawing was covered the whole time.
 *
 * So the page starts with plain roads and turns this on when the cards have
 * stopped moving. Everywhere else — the written document, the standalone
 * drawing, the tests — there is no settling and no cover, the cards are where
 * they are from the first line, and roads are planned from the start.
 */
export const detours = {
  on: true,
  set(on: boolean): void {
    if (detours.on === on) return;
    detours.on = on;
    // Both memos are about the old answer, and the question has changed.
    planning.clear();
    bridging.clear();
    plannedFor = "";
  },
};

/**
 * Every card's place in one number, so a move throws the plans away.
 *
 * It used to be the count and the first and last card, which is cheap and
 * wrong: a column re-flowing in the middle of the drawing leaves both ends
 * where they were, and the roads planned around where those cards used to be
 * stayed on the drawing. Every card is folded in instead.
 *
 * Answered once per set rather than once per road. The set is built fresh each
 * time the arrows are worked out, so its identity is the question "is this the
 * same pass", and hundreds of roads asking within one pass ask it once.
 */
let counted: readonly Blocking[] | null = null;
let count = "";

function shapeOf(walls: readonly Blocking[]): string {
  if (walls === counted) return count;
  let hash = walls.length;
  for (const wall of walls) {
    // Rounded, because a measured card is a fraction of a pixel different on
    // every pass and a road does not care about a third of a pixel.
    hash = (Math.imul(hash, 31) + Math.round(wall.x)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(wall.y)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(wall.width)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(wall.height)) | 0;
  }
  counted = walls;
  count = `${walls.length}:${hash}`;
  return count;
}

function planned(
  from: Point,
  to: Point,
  goesRight: boolean,
  walls: readonly Blocking[],
  mine: Blocking,
  theirs: Blocking,
): Point[] {
  const shape = shapeOf(walls);
  if (shape !== plannedFor) {
    planning.clear();
    bridging.clear();
    plannedFor = shape;
  }

  const key = `${from.x},${from.y},${to.x},${to.y},${goesRight ? 1 : 0}`;
  const known = planning.get(key);
  if (known) return known;

  /*
   * Its own two cards are not obstacles. A road has to leave one and reach the
   * other, and a card cannot be in the way of the arrow that belongs to it.
   */
  const between = walls.filter((wall) => wall !== mine && wall !== theirs);
  const road = roadAround(from, to, goesRight, between);
  planning.set(key, road);
  return road;
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
  /**
   * The long line this arrow actually draws, as the corners it turns at.
   *
   * Which path holds it depends on what the arrow is: an arrow travelling alone
   * draws its whole road as its stem, and one carrying a gathered run draws the
   * run's road as its trunk while its own stem is a slip road a few dozen
   * pixels long. The bridges care about the long one and about nothing else, so
   * it is named here rather than guessed at there — guessing was how a slip
   * road came to be replaced by the full road it feeds, drawing a second copy
   * of a line that was already there.
   */
  line: Point[];
  /** Which of the two paths `line` is drawn into. */
  lineIs: "stem" | "trunk";
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

  /*
   * The buildings, gathered once for every road on this drawing rather than
   * per arrow: the set is the same for all of them and a change carries
   * hundreds.
   */
  const walls: Blocking[] = [];
  for (const node of model.nodes) {
    const box = boxOf(node.id);
    if (box) walls.push(box);
  }

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

    const wire = route(from, to, walls);
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
      line: wire.corners,
      lineIs: "stem",
    };
    drawn.push(arrow);

    const key = runKey(edge);
    const run = runs.get(key);
    if (run) run.push(arrow);
    else runs.set(key, [arrow]);
  }

  for (const [key, run] of runs) gather(key, run, walls, boxOf);
  join(drawn, walls);
  bridge(drawn);
  return drawn;
}

/**
 * The roads that travel together, put on one lane.
 *
 * Twenty files calling one module drew twenty roads down twenty lanes a few
 * pixels apart: twenty lines for the reader to tell from their neighbours, none
 * of them saying anything the one beside it does not. A road network does not
 * look like that — everything going that way joins the highway, travels
 * together, and comes off at its own exit.
 *
 * Only the long middles are moved. Each arrow still leaves its own row and
 * arrives at its own row, so nothing about which file calls which is lost; what
 * is lost is nineteen parallel lines.
 *
 * The lanes come back for the drawing to lay down underneath the arrows, wide
 * and grey, which is what says "many of these go this way" without saying it in
 * words.
 */
let lanes: Highway[] = [];

function join(drawn: Arrow[], walls: readonly Blocking[]): void {
  /*
   * Only once the roads have been planned around the cards.
   *
   * Before that they are the plain way through, and gathering plain roads onto
   * shared lanes would be arranging a picture that is about to be replaced —
   * and doing it on every measurement pass of the boot.
   */
  if (!detours.on) {
    lanes = [];
    return;
  }

  const travelling = drawn
    .filter((arrow) => arrow.line.length > 1)
    .map((arrow) => ({ id: arrow.edge.id, corners: arrow.line }));
  if (travelling.length < 2) {
    lanes = [];
    return;
  }

  // The cards go in as well as the roads: what makes two lines one road is that
  // nothing stands between them, and only the cards can say that.
  const gathered = highways(travelling, { walls });
  lanes = gathered.highways;

  for (const arrow of drawn) {
    const moved = gathered.roads.get(arrow.edge.id);
    if (moved && moved.length > 1) redraw(arrow, moved);
  }

  /*
   * What colour each lane is, from what travels it.
   *
   * A lane is a band under the roads rather than a thing in its own right, and
   * a grey band under a run of green arrows says there is something else there.
   * It takes the colour of the traffic most of it is, and stays grey only where
   * the traffic genuinely is of more than one kind.
   */
  const carrying = new Map<Highway, Map<string, number>>();
  for (const arrow of drawn) {
    if (arrow.line.length < 2) continue;
    for (const lane of travelled(shortenRoad(arrow.line, HEAD), lanes)) {
      const kinds = carrying.get(lane) ?? new Map<string, number>();
      kinds.set(arrow.edge.change, (kinds.get(arrow.edge.change) ?? 0) + 1);
      carrying.set(lane, kinds);
    }
  }

  for (const lane of lanes) lane.change = commonest(carrying.get(lane));
}

/** The lanes the last set of arrows ended up sharing. */
export function sharedRoads(): Highway[] {
  return lanes;
}

/** The kind of change most of a lane's traffic is, or nothing for an empty one. */
function commonest(kinds: Map<string, number> | undefined): string | undefined {
  if (!kinds || kinds.size === 0) return undefined;
  let best: string | undefined;
  let most = 0;
  // Sorted, so a tie is broken by the name rather than by whichever road
  // happened to be worked out first.
  for (const kind of [...kinds.keys()].sort()) {
    const many = kinds.get(kind)!;
    if (many > most) {
      most = many;
      best = kind;
    }
  }
  return best;
}

/** Every lane a road runs along. */
function travelled(corners: readonly Point[], within: readonly Highway[]): Highway[] {
  const found: Highway[] = [];
  for (let at = 1; at < corners.length; at++) {
    const lane = laneUnder(corners[at - 1]!, corners[at]!, within);
    if (lane && !found.includes(lane)) found.push(lane);
  }
  return found;
}

/** The lane a leg is running along, if it is running along one. */
function laneUnder(a: Point, b: Point, within: readonly Highway[]): Highway | undefined {
  const upright = a.x === b.x;
  const at = upright ? a.x : a.y;
  const from = upright ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
  const to = upright ? Math.max(a.y, b.y) : Math.max(a.x, b.x);

  return within.find(
    (one) =>
      (one.axis === "vertical") === upright &&
      Math.abs(one.at - at) < 1 &&
      from >= one.from - 1 &&
      to <= one.to + 1,
  );
}

/**
 * An arrow's paths, written again from corners that have moved.
 *
 * Every one of them is derived from the same list of corners — what is drawn,
 * what is pressed, where the head sits — so moving the corners without redoing
 * all four leaves an arrow whose head is where the road used to end.
 */
function redraw(arrow: Arrow, corners: Point[]): void {
  arrow.line = corners;
  const cut = shortenRoad(corners, HEAD);
  const last = roadEnd(cut);
  const end = corners[corners.length - 1]!;
  const whole = roadPath(corners);

  if (arrow.lineIs === "trunk") {
    arrow.trunk = roadPath(cut);
    arrow.road = whole;
  } else {
    arrow.stem = roadPath(cut);
    arrow.hit = whole;
  }
  arrow.head = `M ${round(last.x)} ${round(last.y)} L ${round(end.x)} ${round(end.y)}`;
}

/**
 * A little bridge wherever one road crosses another.
 *
 * Two roads meeting at a right angle draw an X, and an X cannot say which pair
 * of arms belongs together — so a reader following an arrow loses it at the
 * first crossing and picks up whichever line carries on. Every wiring diagram
 * solves this the same way, and it works because a hop is the one mark on a
 * drawing of straight lines that can only mean "these two do not meet".
 *
 * An addition hops a deletion, because a change is read forwards: what the
 * branch does now is in front, and what it used to do passes underneath. Where
 * both are the same kind, the one going right hops, which is arbitrary and
 * consistent — what matters is that exactly one of any pair does.
 *
 * Skipped once a drawing has more roads than this can compare in a frame: the
 * crossings are found by looking at every pair, and past a few hundred roads
 * that is the whole frame gone for a decoration.
 */
function roadKey(arrow: Arrow): string {
  const first = arrow.line[0]!;
  const last = arrow.line[arrow.line.length - 1]!;
  /*
   * The whole road, not only its ends.
   *
   * The ends alone looked like enough — nothing moves a road without moving
   * where it starts or stops — and then the lanes arrived, which move a road's
   * middle and leave both ends exactly where they were. The key matched, the
   * hopped line cached before the road was moved was applied to the road after
   * it, and what that drew was an arrow running along its old course with a
   * wide grey lane beside it carrying nothing.
   */
  let hash = arrow.line.length;
  for (const point of arrow.line) {
    hash = (Math.imul(hash, 31) + Math.round(point.x)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(point.y)) | 0;
  }
  return `${arrow.lineIs}:${first.x},${first.y},${last.x},${last.y}:${hash}`;
}

function bridge(drawn: Arrow[]): void {
  const roads = drawn.filter((arrow) => arrow.line.length > 1);
  if (roads.length < 2) return;

  /*
   * The sweep waits for the frame the arrows go up in.
   *
   * Which roads cross which cannot be known until every road is planned, and
   * planning them all is the last thing that frame does — so doing the sweep
   * inside it delays the one thing the reader is waiting for in order to
   * decorate it. The arrows appear, and a beat later the ones that cross gain
   * their hops.
   */
  if (bridging.size === 0) {
    const pending = roads.map((arrow) => ({ arrow, corners: arrow.line }));
    /*
     * Handed to whoever is drawing rather than scheduled here.
     *
     * This module is the geometry and nothing else — it is imported by tests
     * with no browser and by the host with no frames, and a module that
     * reaches for a frame or for reactive state cannot be either of those
     * things. The page fills this in; everywhere else it is nothing and the
     * bridges simply do not appear, which is right, since nobody is watching.
     */
    secondPass.run?.(() => sweep(pending));
    return;
  }

  for (const arrow of roads) {
    const drawnOver = bridging.get(roadKey(arrow));
    // Onto whichever path holds the long line. A run's hops belong on its
    // trunk; putting them on the carrier's stem would draw the whole road a
    // second time, over the top of the slip road it replaced.
    if (drawnOver) arrow[arrow.lineIs] = drawnOver;
  }
}

/**
 * Every crossing on the drawing, and the line each hopping road becomes.
 *
 * Found by sweeping rather than by comparing every pair. A change of this size
 * draws six hundred roads, and asking each pair whether they meet is a hundred
 * and eighty thousand questions — five seconds of one, measured. A crossing is
 * a vertical leg meeting a horizontal one, so the horizontals are sorted by
 * height and each vertical asks only about the band it spans. Nearly all of
 * them ask about none.
 */
function sweep(roads: readonly { arrow: Arrow; corners: Point[] }[]): void {
  /*
   *
   * A change of this size draws six hundred roads, and asking each pair whether
   * they meet is a hundred and eighty thousand questions — five seconds of one,
   * measured. A crossing is a vertical leg meeting a horizontal one, so the
   * horizontals are sorted by height and each vertical asks only about the band
   * it actually spans. Nearly all of them ask about none.
   */
  interface Leg { arrow: Arrow; at: number; from: number; to: number }
  const uprights: Leg[] = [];
  const flats: Leg[] = [];

  for (const { arrow, corners } of roads) {
    for (let at = 1; at < corners.length; at++) {
      const a = corners[at - 1]!;
      const b = corners[at]!;
      if (a.x === b.x) {
        uprights.push({ arrow, at: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) });
      } else if (a.y === b.y) {
        flats.push({ arrow, at: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) });
      }
    }
  }
  flats.sort((one, two) => one.at - two.at);
  const heights = flats.map((leg) => leg.at);

  /** The first flat leg at or below a height, by halving. */
  const firstAt = (y: number): number => {
    let low = 0;
    let high = heights.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (heights[mid]! < y) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const rank = (arrow: Arrow) =>
    arrow.edge.change === "added" ? 2 : arrow.edge.change === "removed" ? 0 : 1;

  const hops = new Map<Arrow, Point[]>();
  const note = (arrow: Arrow, point: Point) => {
    const already = hops.get(arrow);
    if (already) already.push(point);
    else hops.set(arrow, [point]);
  };

  for (const upright of uprights) {
    for (let at = firstAt(upright.from); at < flats.length; at++) {
      const flat = flats[at]!;
      if (flat.at > upright.to) break;
      if (flat.arrow === upright.arrow) continue;
      // A proper crossing, not two roads sharing a junction: strictly inside
      // both legs, so a corner they both turn at is not a bridge over nothing.
      if (upright.at <= flat.from || upright.at >= flat.to) continue;
      if (flat.at <= upright.from || flat.at >= upright.to) continue;

      /*
       * Which one goes over. An addition hops a deletion, because a change is
       * read forwards: what the branch does now is in front, and what it used
       * to do passes underneath. Between two of a kind the upright hops, which
       * is arbitrary and consistent — what matters is that exactly one does.
       */
      const over =
        rank(upright.arrow) === rank(flat.arrow)
          ? upright.arrow
          : rank(upright.arrow) > rank(flat.arrow)
            ? upright.arrow
            : flat.arrow;
      note(over, { x: upright.at, y: flat.at });
    }
  }

  for (const [arrow, met] of hops) {
    // Only the drawn line hops. What the pointer follows stays the plain road:
    // a hit area with bumps in it is a hit area that misses.
    // The finished line rather than the crossings, so applying it on the next
    // redraw is an assignment rather than the drawing of it again.
    bridging.set(roadKey(arrow), roadOver(shortenRoad(arrow.line, HEAD), met));
  }
  // Recorded even when nobody hops, so the sweep is not repeated for this
  // placement just because it found nothing.
  if (hops.size === 0 && roads.length > 0) {
    const first = roads[0]!.arrow;
    bridging.set(roadKey(first), first[first.lineIs]);
  }
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
function gather(
  key: string,
  run: Arrow[],
  walls: readonly Blocking[],
  boxOf: (id: string) => Box | null,
): void {
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
    // from is still the thing you press and still says where it is. A slip
    // road: out of the card, across, and onto the trunk.
    const start = arrow.wire.start;
    const stem = roadPath(
      roadPoints(start, { x: joinX, y: joinY }, first.goesRight),
    );
    arrow.run = key;
    arrow.stem = stem;
    arrow.hit = stem;
    // A slip road is a few dozen pixels between a row and the junction it feeds.
    // Nothing long enough to be worth hopping, and its corners are not the road
    // this arrow travels — the trunk is, and the trunk belongs to the carrier.
    arrow.line = [];
    // The head is drawn once, at the far end of the road, by whichever of them
    // carries it. One triangle per stem would put a row of them at the junction.
    arrow.head = "";
  }

  const carrier = run[0]!;
  const to = carrier.wire.to;
  /*
   * The run's road is planned around the cards like any other.
   *
   * It was not, and it is the longest line on the drawing: a file that reads
   * another on ten lines draws one road the whole way across, and drawing it
   * straight put it through every card in between. The arrows are under the
   * cards, so what that looked like was a road in pieces — the one report that
   * kept coming back after the single arrows were fixed.
   */
  const mine = boxOf(carrier.edge.from);
  const theirs = boxOf(carrier.edge.to);
  const between = detours.on
    ? walls.filter((wall) => wall !== mine && wall !== theirs)
    : [];
  const road = roadAround({ x: joinX, y: joinY }, to, first.goesRight, between);
  const cut = shortenRoad(road, HEAD);
  const last = roadEnd(cut);
  carrier.carrier = true;
  carrier.trunk = roadPath(cut);
  carrier.line = road;
  carrier.lineIs = "trunk";
  // The road is most of what the eye follows, so it is what the pointer finds.
  // Its own hit area, along the whole of it, rather than the stem's.
  carrier.road = roadPath(road);
  carrier.head = `M ${last.x} ${last.y} L ${to.x} ${to.y}`;
}
