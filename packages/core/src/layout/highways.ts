/**
 * Many roads going the same way, gathered onto one.
 *
 * Look at a drawing of a change and most of the traffic is going to the same
 * few places: twenty files call one module, and their roads leave twenty
 * different rows, run down twenty lanes a few pixels apart, and arrive
 * separately. Every one of those lanes is a line the reader has to tell from
 * its neighbours, and none of them says anything the one beside it does not.
 *
 * A road network does not look like that. It has a highway, and everything
 * going that way joins it, travels together, and comes off at its own exit.
 * That is what this does: the vertical runs that are nearly in line with each
 * other, and overlap along their length, are put on one lane and the lane is
 * drawn once, wide and grey, underneath. What was twenty lines an eighth of an
 * inch apart becomes one road with twenty things on it.
 *
 * Nothing is hidden by this and no arrow loses its ends. Each road still leaves
 * its own row and arrives at its own row — only the long middle is shared,
 * which is the part where they were all saying the same thing anyway.
 */

interface Point {
  x: number;
  y: number;
}

/** A road that may be moved onto a lane. */
export interface Travelling {
  id: string;
  corners: Point[];
}

/** A stretch of road that several of them travel. */
export interface Highway {
  /** Which way it runs. */
  axis: "vertical" | "horizontal";
  /** Where the lane sits: an x for a vertical highway, a y for a horizontal one. */
  at: number;
  /** How far it runs, along its own direction. */
  from: number;
  to: number;
  /** How many roads travel it, which is what its width says. */
  users: number;
}

/**
 * How far apart two lanes can be and still be the same road.
 *
 * Wide enough to gather the lanes a search leaves a few pixels apart — they
 * come from card edges, so they cluster at the widths cards happen to be — and
 * narrow enough that a road is never moved somewhere a reader would call a
 * different place. It is about a card's margin.
 */
export const REACH = 26;

/**
 * The shortest run worth gathering.
 *
 * A jog of thirty pixels between two turns is not a journey and putting it on a
 * highway would drag it sideways for nothing.
 */
export const RUN = 70;

/** How many roads make a highway. Two lines side by side are just two lines. */
export const MANY = 3;

/** One straight run of one road, as an interval along its axis. */
interface Leg {
  road: number;
  /** Index of the first of the two corners. */
  corner: number;
  at: number;
  from: number;
  to: number;
  /** The clear space this run has to move within, if it is known. */
  gapLow?: number;
  gapHigh?: number;
}

/** A card, for working out which gap a run is travelling down. */
export interface Standing {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How close a lane may sit to the card beside it. */
const CLEAR = 12;

/**
 * Puts the roads that travel together onto shared lanes.
 *
 * The corners are rewritten in place of the ones handed in — the caller owns
 * the arrays and this returns new ones — and the lanes that ended up carrying
 * a crowd come back as highways for the drawing to lay down underneath.
 */
export function highways(
  roads: readonly Travelling[],
  { reach = REACH, run = RUN, many = MANY, walls = [] as readonly Standing[] } = {},
): { roads: Map<string, Point[]>; highways: Highway[] } {
  const moved = new Map<string, Point[]>();
  const corners = roads.map((road) => road.corners.map((point) => ({ ...point })));

  const uprights: Leg[] = [];
  const flats: Leg[] = [];
  for (let at = 0; at < corners.length; at++) {
    const road = corners[at]!;
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1]!;
      const b = road[i]!;
      if (a.x === b.x && Math.abs(b.y - a.y) >= run) {
        uprights.push({
          road: at,
          corner: i - 1,
          at: a.x,
          from: Math.min(a.y, b.y),
          to: Math.max(a.y, b.y),
        });
      } else if (a.y === b.y && Math.abs(b.x - a.x) >= run) {
        flats.push({
          road: at,
          corner: i - 1,
          at: a.y,
          from: Math.min(a.x, b.x),
          to: Math.max(a.x, b.x),
        });
      }
    }
  }

  /*
   * The gap each run is travelling down, when the cards are known.
   *
   * Distance alone is the wrong measure of "the same road". Three lines a
   * hundred pixels apart in one empty channel between two columns are plainly
   * one road that has been drawn three times, and three lines the same distance
   * apart with a card between them are three roads. What makes them the same is
   * that nothing stands between them — so the space a run has to itself is
   * worked out first, and runs sharing a space share a lane however far apart
   * they started.
   */
  for (const leg of uprights) hem(leg, walls, "vertical");
  for (const leg of flats) hem(leg, walls, "horizontal");

  const lanes = [
    ...gather(uprights, corners, "vertical", reach, many),
    ...gather(flats, corners, "horizontal", reach, many),
  ];

  for (let at = 0; at < roads.length; at++) {
    moved.set(roads[at]!.id, straighten(corners[at]!));
  }
  return { roads: moved, highways: lanes };
}

/**
 * The clear space a run has either side of it, up to the nearest card.
 *
 * Only cards that stand beside this run — ones it actually passes — can hem it
 * in. A card above or below a vertical run is not in its way and has no opinion
 * about which lane it should take.
 */
function hem(leg: Leg, walls: readonly Standing[], axis: "vertical" | "horizontal"): void {
  if (walls.length === 0) return;
  let low = -Infinity;
  let high = Infinity;

  for (const wall of walls) {
    const acrossLow = axis === "vertical" ? wall.y : wall.x;
    const acrossHigh = axis === "vertical" ? wall.y + wall.height : wall.x + wall.width;
    // Beside the run rather than at one end of it.
    if (acrossHigh <= leg.from || acrossLow >= leg.to) continue;

    const nearLow = axis === "vertical" ? wall.x : wall.y;
    const nearHigh = axis === "vertical" ? wall.x + wall.width : wall.y + wall.height;
    if (nearHigh <= leg.at && nearHigh > low) low = nearHigh;
    else if (nearLow >= leg.at && nearLow < high) high = nearLow;
  }

  leg.gapLow = low === -Infinity ? undefined : low + CLEAR;
  leg.gapHigh = high === Infinity ? undefined : high - CLEAR;
}

/**
 * Finds the crowds among one axis's legs, and moves them together.
 *
 * Two passes, both cheap. Sorted by position, legs within `reach` of the one
 * before them are a band — every lane in that band is a candidate for the same
 * road. Then within a band, legs that actually overlap along their length are
 * one highway: two runs in the same column at opposite ends of the drawing are
 * not sharing anything, and joining them would draw a road through everything
 * between them.
 */
function gather(
  legs: Leg[],
  corners: Point[][],
  axis: "vertical" | "horizontal",
  reach: number,
  many: number,
): Highway[] {
  if (legs.length === 0) return [];
  legs.sort((one, two) => one.at - two.at || one.from - two.from);

  const found: Highway[] = [];
  let band: Leg[] = [];

  const closeBand = () => {
    if (band.length >= many) found.push(...merge(band, corners, axis, many));
    band = [];
  };

  for (const leg of legs) {
    const last = band[band.length - 1];
    // Near enough to be the same lane, or in the same gap between cards, which
    // is the same statement made about the drawing rather than about a number.
    if (last && leg.at - last.at > reach && !sameGap(last, leg)) closeBand();
    band.push(leg);
  }
  closeBand();
  return found;
}

/**
 * Whether two runs are travelling the same clear space.
 *
 * Both hemmed by the same pair of cards, and nothing standing between them:
 * that is what makes two lines a hundred pixels apart one road drawn twice
 * rather than two roads. Unknown on either side means the cards were not given,
 * and then distance is all there is to go on.
 */
function sameGap(one: Leg, two: Leg): boolean {
  if (one.gapLow === undefined && one.gapHigh === undefined) return false;
  if (two.gapLow === undefined && two.gapHigh === undefined) return false;
  const low = Math.max(one.gapLow ?? -Infinity, two.gapLow ?? -Infinity);
  const high = Math.min(one.gapHigh ?? Infinity, two.gapHigh ?? Infinity);
  // A shared gap wide enough to hold a road, and holding both of them already.
  return low <= high && one.at >= low && one.at <= high && two.at >= low && two.at <= high;
}

/**
 * One band of nearby lanes, split into the runs that actually overlap.
 *
 * The lane they all move to is the middle one rather than the average: an
 * average sits between lanes and moves every road, where the middle leaves at
 * least one where it already was and is a lane the search has already found a
 * way through.
 */
function merge(
  band: Leg[],
  corners: Point[][],
  axis: "vertical" | "horizontal",
  many: number,
): Highway[] {
  const along = [...band].sort((one, two) => one.from - two.from);
  const found: Highway[] = [];

  let together: Leg[] = [];
  let reachedTo = -Infinity;

  const close = () => {
    if (together.length >= many) {
      let middle = [...together].sort((one, two) => one.at - two.at)[
        together.length >> 1
      ]!.at;
      /*
       * Inside the space all of them share.
       *
       * The middle lane is one of theirs and so is already clear of the cards
       * it passes — but it is only clear of *its own*, and the others may be
       * hemmed in more tightly. Moving a road onto a lane that runs through a
       * card is the fault this whole file is meant to relieve.
       */
      const low = Math.max(...together.map((leg) => leg.gapLow ?? -Infinity));
      const high = Math.min(...together.map((leg) => leg.gapHigh ?? Infinity));
      if (low <= high) middle = Math.min(Math.max(middle, low), high);
      for (const leg of together) {
        const road = corners[leg.road]!;
        const a = road[leg.corner]!;
        const b = road[leg.corner + 1]!;
        if (axis === "vertical") {
          a.x = middle;
          b.x = middle;
        } else {
          a.y = middle;
          b.y = middle;
        }
      }
      found.push({
        axis,
        at: middle,
        from: Math.min(...together.map((leg) => leg.from)),
        to: Math.max(...together.map((leg) => leg.to)),
        users: together.length,
      });
    }
    together = [];
    reachedTo = -Infinity;
  };

  for (const leg of along) {
    // Overlapping, not merely adjacent: two runs that meet end to end are one
    // road's continuation rather than two roads sharing a stretch.
    if (together.length > 0 && leg.from >= reachedTo) close();
    together.push(leg);
    reachedTo = Math.max(reachedTo, leg.to);
  }
  close();
  return found;
}

/**
 * The same road with the kinks that moving it left behind taken out.
 *
 * Putting a leg on a lane shortens the legs either side of it, and one of them
 * can end up with no length at all — two corners in the same place, which every
 * routine downstream measures the direction of. It is also how a road ends up
 * with a turn that no longer turns.
 */
function straighten(road: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of road) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = out[out.length - 2];
    if (last && before) {
      const wasVertical = last.x === before.x;
      const nowVertical = point.x === last.x;
      const wasFlat = last.y === before.y;
      const nowFlat = point.y === last.y;
      if ((wasVertical && nowVertical) || (wasFlat && nowFlat)) {
        out[out.length - 1] = point;
        continue;
      }
    }
    out.push(point);
  }
  return out;
}
