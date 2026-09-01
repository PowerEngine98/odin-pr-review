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

import {
  bezier,
  curveEnd,
  curvePoints,
  rim,
  round,
  shorten,
} from "@odin/core/layout/curves.js";

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

/** How near an arrow may leave or land to the top or bottom of its own card. */
const EDGE = 6;
/**
 * Where an arrow about a whole file meets the card.
 *
 * An import names the file, so it arrives at the title rather than at a line.
 * Half a title's height, in the ordinary case where nobody has measured one —
 * the cards can say better, and when they do this is not consulted.
 */
const TITLE_MID = 17;

/*
 * The curve arithmetic itself lives in the layout rather than here.
 *
 * Three renderers draw these arrows — this page, the first paint the host
 * writes into the document, and the standalone SVG — and an arrow that changed
 * shape the moment the page booted is a picture moving for no reason anybody
 * can see. That happened, and it was the same maths written out twice.
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
  /**
   * Whether it is still travelling rightwards when it lands.
   *
   * Not the same question as `goesRight`, and the difference is a real fault:
   * two cards that overlap in x are joined most cheaply by leaving one border
   * and coming back into the border on the same side of the other. Anything
   * about the last few pixels — the head, the dot just inside the card, the way
   * a gathered run's trunk bends — has to follow the arrival rather than the
   * departure, or it is drawn on the far side of the card it points into.
   */
  arrivesRight: boolean;
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
  /*
   * Which side of each card the arrow uses, chosen by what it costs.
   *
   * Middles are the wrong question whenever two cards overlap in x, and on a
   * drawing of files that is common: a wide card and a narrow one in
   * neighbouring columns, or a card that grew when its rows were measured. The
   * middle of a wide destination can sit to the left of a narrow source while
   * its right-hand edge is far to the right — so the line left by the source's
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
    // Setting off the wrong way for where it lands: the line has to come back
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
   * Which way the arrow is pointing when it arrives, which is not always the
   * way it set off. Everything about the last few pixels follows the arrival:
   * the head, the dot just inside the destination, and which way the curve
   * leans as it comes in.
   */
  const into = best.in;

  const leaves = { x: fromX, y: from.y };
  const arrive = { x: toX, y: to.y };

  // Clear of the card, not on its edge: half a dot under the border is a
  // smudge, and this one is meant to be pressed.
  const port = { x: fromX + away * PORT_GAP, y: from.y };
  /*
   * On the rim of the dot, facing where the arrow is going.
   *
   * Read from the same anchor as the dot itself and in the same breath, so the
   * two cannot disagree. They did, when the line was planned in one place and
   * the dot remembered in another: a hundred and twenty-nine of them on a
   * drawing of two hundred files, the worst two thousand eight hundred pixels
   * apart — a dot sitting on a card with its line starting somewhere else
   * entirely, which is what kept being reported as a line that does not render.
   */
  const start = rim(port, arrive, PORT_RIM);

  const points = curvePoints(leaves, arrive, away, into, start);
  const cut = shorten(points, HEAD);
  const last = curveEnd(cut);

  return {
    goesRight,
    arrivesRight: into > 0,
    from: leaves,
    to: arrive,
    port,
    // Just inside the destination's own edge, whichever edge the arrow came to.
    home: { x: toX + into * HOME_GAP, y: to.y },
    start,
    hit: bezier(points),
    stem: bezier(cut),
    // The head rides its own segment so it can be oriented and placed without
    // anything drawn along it — the stroke is off, only the marker shows.
    head: `M ${last.x} ${last.y} L ${round(toX)} ${round(to.y)}`,
  };
}

/**
 * What has to match for two references to be drawn as one line.
 *
 * The same destination row and the same kind of change. An added reference and
 * a removed one to the same table are two different facts and stay two arrows.
 */
export function runKey(edge: EdgeView): string {
  /*
   * Where it lands, not where it left.
   *
   * The source used to be part of this, so two files calling the same line of
   * the same file drew two lines the whole way and arrived a pixel apart — the
   * same fact said twice, at twice the ink. What makes several references one
   * line is that they end in the same place; where they start is what the stems
   * are for.
   *
   * Which of them actually travel together is decided afterwards, by how near
   * they are: two files at opposite ends of the drawing land on the same row
   * without going anywhere near each other, and joining those would draw a line
   * across everything between them.
   */
  return [edge.to, edge.toLine, edge.toSide, edge.change, edge.kind].join("|");
}

/** An arrow with everything the layers need to draw it. */
export interface Arrow {
  edge: EdgeView;
  /** Reaches the database rather than a file, and is coloured and filtered so. */
  schema: boolean;
  wire: Wire;
  /** The run this one travels with, or nothing when it travels alone. */
  run: string | null;
  /** Whether this is the one carrying its run's trunk and head. */
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
/*
 * The last set of arrows, and what they were worked out from.
 *
 * Two layers ask for them — the lines under the cards and the dots over them —
 * with the same question in the same tick, and each answer is six hundred
 * routed arrows. Answering it twice was half of what the drawing spent on
 * arrows during a build; the cache took the boot's longest task from four and a
 * half seconds to one and a third.
 *
 * The model, the placement and the row heights are compared by identity, which
 * is honest for them: each is a reactive object the page replaces when it
 * changes. The reading is not, and is compared by what it says — each layer
 * builds its own, so two identical readings are two objects and an identity
 * test never matches. That is how both layers came to be routing every arrow
 * separately.
 */
let asked: Scene | null = null;
let answered: Arrow[] = [];

/**
 * Bumped by anything that changes an answer without changing the question.
 *
 * Nothing in the geometry does that at the moment; it is what the page has to
 * say "these are stale" with, and without it the first cached answer was handed
 * out for ever no matter what else had happened.
 */
let generation = 0;
let asOf = -1;

/**
 * Where the cards were when the last answer was worked out.
 *
 * Not which cards, which is what the object identity says: the placement moves
 * a card by writing to the object it already handed over, so an answer can be
 * about positions that no longer exist while every reference in it is still the
 * same reference. Measured on a change of two hundred files: sixty-one arrows
 * anchored to a box a hundred and twenty-four pixels from where their card was
 * drawn, heights matching exactly.
 *
 * Every card is folded in, not the count and the two ends. That was the cheap
 * version and it was wrong — a column re-flowing in the middle of the drawing
 * leaves both ends where they were.
 */
let placedAt = "";

function wherePlaced(scene: Scene): string {
  if (!scene.boxes) return "none";
  const boxes = Object.values(scene.boxes);
  let hash = boxes.length;
  for (const box of boxes) {
    // Rounded, because a measured card is a fraction of a pixel different on
    // every pass and an arrow does not care about a third of a pixel.
    hash = (Math.imul(hash, 31) + Math.round(box.x)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(box.y)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(box.width)) | 0;
    hash = (Math.imul(hash, 31) + Math.round(box.height)) | 0;
  }
  return `${boxes.length}:${hash}`;
}

export function rerouted(): void {
  generation += 1;
}

export function arrows(scene: Scene): Arrow[] {
  if (
    asked &&
    asked.model === scene.model &&
    asked.boxes === scene.boxes &&
    asked.lineAt === scene.lineAt &&
    asOf === generation &&
    placedAt === wherePlaced(scene) &&
    sameReading(asked.reading, scene.reading)
  ) {
    return answered;
  }
  const drawn = routeAll(scene);
  asked = scene;
  answered = drawn;
  asOf = generation;
  placedAt = wherePlaced(scene);
  return drawn;
}

function sameReading(one: Reading, two: Reading): boolean {
  return (
    one.unified === two.unified &&
    one.showTests === two.showTests &&
    one.showImports === two.showImports &&
    one.showUnchanged === two.showUnchanged &&
    one.showInfra === two.showInfra &&
    one.hideViewed === two.hideViewed &&
    one.part === two.part &&
    one.viewed === two.viewed
  );
}

function routeAll(scene: Scene): Arrow[] {
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
    if (measured != null) {
      /*
       * Held inside the card it belongs to.
       *
       * A card measures where its own rows are, and on a drawing of two hundred
       * files forty-one of those answers put an arrow above the card that gave
       * them — the worst of them two thousand seven hundred pixels above it —
       * and eight below. What that draws is a line starting in open space with
       * a dot floating beside it, which is one of the things being reported as
       * a line that does not render.
       *
       * Why a card sometimes answers with a position outside itself is a
       * separate question and not answered here. This is the thing that is true
       * whatever the answer turns out to be: an arrow leaves the card it
       * belongs to, so it is held there.
       */
      const inside = Math.min(Math.max(measured, EDGE), Math.max(EDGE, box.height - EDGE));
      return { box, y: box.y + inside };
    }
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

  for (const [key, run] of runs) {
    for (const near of together(run)) gather(key, near);
  }

  return drawn;
}

/**
 * How far apart two arrows may start and still travel together.
 *
 * About a screen at reading distance. Beyond it the stem that joins one to the
 * junction is longer than the trunk they share, which is a line drawn to save
 * ink that saves none.
 */
const NEAR = 900;

/**
 * The arrows heading for one place, split into the groups that are near enough
 * to be worth joining.
 *
 * Sorted down the drawing and cut wherever the next one is too far below the
 * last, so a crowd in one column becomes one line and a straggler two screens
 * away keeps its own. Arrows leaving in opposite directions are never joined:
 * they meet the card on different sides and share nothing at all.
 */
function together(run: Arrow[]): Arrow[][] {
  if (run.length < 2) return [run];

  const groups: Arrow[][] = [];
  for (const side of [true, false]) {
    const facing = run
      .filter((arrow) => arrow.wire.goesRight === side)
      .sort((one, two) => one.wire.start.y - two.wire.start.y);

    let group: Arrow[] = [];
    for (const arrow of facing) {
      const last = group[group.length - 1];
      if (last && arrow.wire.start.y - last.wire.start.y > NEAR) {
        groups.push(group);
        group = [];
      }
      group.push(arrow);
    }
    if (group.length > 0) groups.push(group);
  }
  return groups;
}

/**
 * How far a stem leans out on its way into the junction, and the least it may
 * ever lean.
 *
 * A larger share than the arrows themselves use, because a stem is short and a
 * gentle bend over forty pixels is a diagonal: the stems have to look like they
 * belong to the same junction, and a fan of straight lines into a point looks
 * like a starburst rather than like traffic joining a road.
 */
const STEM_REACH = 0.55;
const STEM_NEAREST = 18;

/**
 * Several references to one place, drawn as one line.
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
  /*
   * Clear of every card the run leaves, not merely of the first of them.
   *
   * The arrows in a run can come from different files, so the junction has to
   * sit beyond the furthest of their edges — put at the first one's, it would
   * fall inside a neighbour and the stem from that neighbour would set off
   * backwards through its own card.
   */
  const edge = run.reduce(
    (far, arrow) =>
      first.goesRight
        ? Math.max(far, arrow.wire.from.x)
        : Math.min(far, arrow.wire.from.x),
    first.from.x,
  );
  const joinX = edge + away * Math.max(46, Math.min(160, reach * 0.16));
  const joinY = run.reduce((sum, r) => sum + r.wire.from.y, 0) / run.length;
  const junction = { x: joinX, y: joinY };

  for (const arrow of run) {
    // Each line keeps its own short stem into the junction, so the row it comes
    // from is still the thing you press and still says where it is.
    const start = arrow.wire.start;
    const bend = Math.max(STEM_NEAREST, Math.abs(joinX - start.x) * STEM_REACH);
    const stem = bezier([
      start,
      { x: start.x + away * bend, y: start.y },
      { x: joinX - away * bend, y: joinY },
      junction,
    ]);
    arrow.run = key;
    arrow.stem = stem;
    arrow.hit = stem;
    // The head is drawn once, at the far end of the line, by whichever of them
    // carries it. One triangle per stem would put a row of them at the junction.
    arrow.head = "";
  }

  const carrier = run[0]!;
  const to = carrier.wire.to;
  /*
   * The trunk arrives the way its carrier would have arrived alone.
   *
   * It is the longest line on the drawing and it is the one the reader follows,
   * so leaning it the way the run set off rather than the way it lands puts the
   * head on the far side of the card it points into — the hook, at the end that
   * matters most, on the arrows most worth reading.
   */
  const into = carrier.wire.arrivesRight ? 1 : -1;
  const road = curvePoints(junction, to, away, into);
  const cut = shorten(road, HEAD);
  const last = curveEnd(cut);
  carrier.carrier = true;
  carrier.trunk = bezier(cut);
  // The trunk is most of what the eye follows, so it is what the pointer finds.
  // Its own hit area, along the whole of it, rather than the stem's.
  carrier.road = bezier(road);
  carrier.head = `M ${last.x} ${last.y} L ${round(to.x)} ${round(to.y)}`;
}
