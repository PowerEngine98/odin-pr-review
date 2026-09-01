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
    ...gather(uprights, corners, "vertical", reach, many, sideways(walls, "vertical")),
    ...gather(flats, corners, "horizontal", reach, many, sideways(walls, "horizontal")),
  ];

  for (let at = 0; at < roads.length; at++) {
    moved.set(roads[at]!.id, straighten(corners[at]!));
  }
  return { roads: moved, highways: lanes };
}

/**
 * The cards as the axis sees them, so one comparison serves both directions.
 *
 * A horizontal run's "between" is measured up and down; a vertical run's is
 * measured left and right. Turning the cards once is cheaper and plainer than
 * writing every comparison twice.
 */
function sideways(walls: readonly Standing[], axis: "vertical" | "horizontal"): Standing[] {
  if (axis === "vertical") return walls as Standing[];
  return walls.map((wall) => ({
    x: wall.y,
    y: wall.x,
    width: wall.height,
    height: wall.width,
  }));
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
  walls: readonly Standing[],
): Highway[] {
  if (legs.length === 0) return [];
  legs.sort((one, two) => one.at - two.at || one.from - two.from);

  const found: Highway[] = [];
  let band: Leg[] = [];

  const closeBand = () => {
    if (band.length >= many) found.push(...merge(band, corners, axis, many));
    band = [];
  };
  // Beside a run rather than at one end of it, which is what "between" means
  // for a road: the cards to compare against are the same for every pair here.

  for (const leg of legs) {
    const last = band[band.length - 1];
    // Near enough to be the same lane, or with nothing standing between them,
    // which is the same statement made about the drawing rather than about a
    // number.
    if (last && leg.at - last.at > reach && !nothingBetween(last, leg, walls)) closeBand();
    band.push(leg);
  }
  closeBand();
  return found;
}

/**
 * Whether two runs are hemmed in by the same pair of cards.
 *
 * True of runs that never pass each other — one above, one below — which is
 * why it is asked as well as, rather than instead of, what stands between them.
 */
function sameCorridor(one: Leg, two: Leg): boolean {
  if (one.gapLow === undefined && one.gapHigh === undefined) return false;
  if (two.gapLow === undefined && two.gapHigh === undefined) return false;
  const low = Math.max(one.gapLow ?? -Infinity, two.gapLow ?? -Infinity);
  const high = Math.min(one.gapHigh ?? Infinity, two.gapHigh ?? Infinity);
  return low <= high && one.at >= low && one.at <= high && two.at >= low && two.at <= high;
}

/**
 * Whether two runs have nothing standing between them.
 *
 * The whole rule, said as plainly as it can be. Two lines a hundred pixels
 * apart with clear space between them are one road drawn twice; two lines the
 * same distance apart with a card between them are two roads, and joining them
 * would draw one through the card.
 *
 * Asked about the stretch they share and no more. The first version compared
 * each run's clearance along its whole length, which sounds like the same
 * question and is much stricter: a run three thousand pixels long passes many
 * cards, any one of which narrows its clearance, and two runs that are plainly
 * side by side were kept apart by a card neither of them goes anywhere near.
 * Measured on a change of two hundred files, that was eleven of the twelve
 * pairs a reader would have merged by eye.
 */
function nothingBetween(one: Leg, two: Leg, walls: readonly Standing[]): boolean {
  if (walls.length === 0) return false;
  // Hemmed in by the same cards, which is the same question asked of two runs
  // that never pass each other — they share a corridor without sharing a
  // stretch of it, and a band is a chain, so dropping that link splits crowds
  // that plainly belong together.
  if (sameCorridor(one, two)) return true;

  const low = Math.min(one.at, two.at);
  const high = Math.max(one.at, two.at);
  const from = Math.max(one.from, two.from);
  const to = Math.min(one.to, two.to);
  // No shared stretch at all: two runs in the same column at opposite ends of
  // the drawing share a lane and nothing else.
  if (from >= to) return false;

  for (const wall of walls) {
    if (wall.x + wall.width <= low || wall.x >= high) continue;
    if (wall.y + wall.height <= from || wall.y >= to) continue;
    return false;
  }
  return true;
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
      /*
       * The lane they move to, and which of them can actually reach it.
       *
       * A run can only be moved to a lane that is clear along its own length,
       * and in a crowd the members are hemmed in by different cards — so a
       * group where no single lane suits everybody used to be abandoned
       * whole, leaving five parallel lines because one of them could not join.
       * The ones that can travel together do; the rest stay where they are and
       * are no worse off than before.
       */
      const middle = [...together].sort((one, two) => one.at - two.at)[
        together.length >> 1
      ]!.at;
      const lane = Math.min(
        Math.max(middle, Math.max(...together.map((leg) => leg.gapLow ?? -Infinity))),
        Math.min(...together.map((leg) => leg.gapHigh ?? Infinity)),
      );
      const at = Number.isFinite(lane) ? lane : middle;
      const joining = together.filter(
        (leg) => at >= (leg.gapLow ?? -Infinity) && at <= (leg.gapHigh ?? Infinity),
      );

      if (joining.length >= many) {
        for (const leg of joining) {
          const road = corners[leg.road]!;
          const a = road[leg.corner]!;
          const b = road[leg.corner + 1]!;
          if (axis === "vertical") {
            a.x = at;
            b.x = at;
          } else {
            a.y = at;
            b.y = at;
          }
        }
        found.push({
          axis,
          at,
          from: Math.min(...joining.map((leg) => leg.from)),
          to: Math.max(...joining.map((leg) => leg.to)),
          users: joining.length,
        });
      }
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
