/**
 * Arrows as roads: straight runs, right-angled turns, rounded corners.
 *
 * The drawing is columns of files with references crossing between them, and a
 * curve says nothing true about that. Two curves leaving the same card fan
 * apart at slightly different angles and cross each other somewhere in the
 * middle, so following one across a wide change means keeping your eye on a
 * line that is never where you last saw it. There is nothing to follow *along*.
 *
 * A road is followable. It leaves the card horizontally, runs to the gap
 * between the columns, turns once, runs down that gap, and turns again to
 * arrive — so every arrow in a change is made of the same two kinds of stretch,
 * and two arrows sharing a gap run beside each other rather than through each
 * other. The corners are rounded because a mitre at every turn reads as a
 * diagram of a circuit; the eye follows a fillet without stopping at it.
 *
 * The geometry is here rather than in either renderer because there are three
 * of them — the page, the first paint the host writes, and the standalone SVG —
 * and an arrow that took one shape in the document and another once the page
 * booted is a picture that moves for no reason anybody can see.
 */

/**
 * A place on the drawing.
 *
 * Named locally rather than exported: the layout already publishes a `Point`
 * and two of the same name in one barrel is an ambiguity every importer has to
 * resolve. What this module is about is the shape of a road, not the name of a
 * pair of numbers.
 */
interface Point {
  x: number;
  y: number;
}

/** How wide a turn is. Small enough to read as a corner rather than a curve. */
export const CORNER = 10;

/**
 * How far a road runs straight out of a card before it may turn.
 *
 * A turn that begins on the border reads as the line leaving at an angle, which
 * is the thing this is here to avoid — and it has to clear the dot the line
 * starts from.
 */
export const STUB = 18;

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The corners of one road, from where it leaves to where it arrives.
 *
 * Three shapes, and which one it is falls out of the geometry rather than being
 * chosen:
 *
 * - Level, or near enough that a jog would be a wobble: one straight run.
 * - Room between the cards: out, across the gap, in. Two turns.
 * - No room — the destination is behind the source, or beside it — the road
 *   goes out past the stub, along, and back in. Still only right angles, and
 *   still two turns; the channel is simply outside the pair rather than
 *   between them.
 */
export function roadPoints(
  from: Point,
  to: Point,
  goesRight: boolean,
): Point[] {
  const away = goesRight ? 1 : -1;
  const straight = Math.abs(to.y - from.y) < 1;
  if (straight) return [from, { x: to.x, y: from.y }];

  const first = from.x + away * STUB;
  const last = to.x - away * STUB;

  /*
   * Where the road turns down, which is the gap between the columns when there
   * is one. Halfway is what makes two cards in neighbouring columns share a
   * channel: the gap between them is the same gap for every arrow that crosses
   * it, so the roads stack up in it instead of wandering across the cards.
   */
  const between = (first + last) / 2;
  const channel = goesRight
    ? Math.max(first, Math.min(between, last))
    : Math.min(first, Math.max(between, last));

  // A destination that is not far enough ahead to have a gap: the road still
  // leaves and arrives straight, and turns in the stub it was given.
  const turn = goesRight
    ? Math.max(channel, from.x + away * STUB)
    : Math.min(channel, from.x + away * STUB);

  return [
    from,
    { x: turn, y: from.y },
    { x: turn, y: to.y },
    { x: to.x, y: to.y },
  ];
}

/**
 * A path along those corners, with each turn rounded.
 *
 * Each corner is cut back by the radius on both sides and joined with a
 * quadratic through the corner itself, which is the one curve that leaves both
 * straights tangent — a fillet rather than a swerve. The radius shrinks to fit
 * a short leg, so a road that turns twice in twenty pixels bends twice rather
 * than overlapping itself.
 */
export function roadPath(points: readonly Point[], radius = CORNER): string {
  if (points.length === 0) return "";
  const at = (p: Point) => `${round(p.x)} ${round(p.y)}`;
  if (points.length === 1) return `M ${at(points[0]!)}`;

  let path = `M ${at(points[0]!)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1]!;
    const corner = points[i]!;
    const after = points[i + 1]!;

    const back = Math.min(
      radius,
      Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
      Math.hypot(after.x - corner.x, after.y - corner.y) / 2,
    );
    if (back <= 0.5) {
      path += ` L ${at(corner)}`;
      continue;
    }

    path += ` L ${at(towards(corner, before, back))}`;
    path += ` Q ${at(corner)} ${at(towards(corner, after, back))}`;
  }
  return `${path} L ${at(points[points.length - 1]!)}`;
}

/** `distance` from `corner` along the line towards `other`. */
function towards(corner: Point, other: Point, distance: number): Point {
  const dx = other.x - corner.x;
  const dy = other.y - corner.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: corner.x + (dx / length) * distance,
    y: corner.y + (dy / length) * distance,
  };
}

/**
 * The same road with its last stretch shortened by `back`.
 *
 * Trivial where a curve was not: the final leg of a road is straight, so the
 * head's length comes off it with subtraction. A curve had to be cut with de
 * Casteljau because it is at its most bent exactly where it arrives.
 *
 * A final leg shorter than the head loses the leg rather than reversing it,
 * which would draw the arrow pointing back the way it came.
 */
export function shortenRoad(points: readonly Point[], back: number): Point[] {
  if (points.length < 2) return [...points];
  const end = points[points.length - 1]!;
  const before = points[points.length - 2]!;
  const length = Math.hypot(end.x - before.x, end.y - before.y);
  if (length <= back) return points.slice(0, -1);
  return [...points.slice(0, -1), towards(end, before, back)];
}

/** Where a road ends, for placing the head that finishes it. */
export function roadEnd(points: readonly Point[]): Point {
  return points[points.length - 1] ?? { x: 0, y: 0 };
}
