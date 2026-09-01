/**
 * Arrows as curves: one cubic per reference, level where it leaves the card and
 * level where it arrives at the other.
 *
 * A cubic whose two control points sit on the same heights as its ends leaves
 * and arrives horizontally, which is what makes the head read as pointing at
 * the row rather than down onto it. Everything else about the shape falls out
 * of one number — how far the control points reach along x — and that number is
 * a fraction of the gap the arrow crosses, so a short reference bends gently
 * and a long one leans out far enough to be told from its neighbours.
 *
 * The geometry is here rather than in any of the renderers because there are
 * three of them — the page, the first paint the host writes into the document,
 * and the standalone SVG — and an arrow that took one shape in the document and
 * another once the page booted is a picture that moves for no reason anybody
 * can see. That was a real report, and it was the same arithmetic written out
 * twice and drifting.
 */

/**
 * A place on the drawing.
 *
 * Named locally rather than exported: the layout already publishes a `Point`
 * and two of the same name in one barrel is an ambiguity every importer has to
 * resolve. What this module is about is the shape of an arrow, not the name of
 * a pair of numbers.
 */
interface Point {
  x: number;
  y: number;
}

/**
 * How far a curve's control points reach along x, as a share of the crossing.
 *
 * Enough that the line has clearly left the card before it starts climbing, and
 * not so much that two arrows between the same pair of columns lie on top of
 * each other.
 */
const REACH = 0.45;

/**
 * And the least it may ever be.
 *
 * Two cards almost level and almost touching would otherwise get a control
 * point a pixel or two out, which draws a straight diagonal — the one shape
 * that says nothing about which border the arrow left by.
 */
const NEAREST = 40;

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The four points of one arrow's curve.
 *
 * `out` and `into` are which way the arrow is travelling as it leaves and as it
 * arrives, each 1 for rightwards and -1 for leftwards. They are not always the
 * same: two cards that overlap in x can be joined most cheaply by leaving the
 * right-hand border and coming back into the right-hand border of the other,
 * and a curve told only about the first of those arrives from the wrong side
 * with its head on the far edge of the card it is pointing into.
 *
 * The bend is measured between `from` and `to`, which are the borders the arrow
 * joins, while the line is drawn from `start`. A line that begins a few pixels
 * out on a dot's rim is still the same arrow between the same two cards, and
 * letting that offset into the arithmetic would give two arrows out of one card
 * slightly different bends for no reason a reader could name.
 */
export function curvePoints(
  from: Point,
  to: Point,
  out: number,
  into: number,
  start: Point = from,
): Point[] {
  const reach = Math.max(NEAREST, Math.abs(to.x - from.x) * REACH);
  return [
    start,
    { x: from.x + out * reach, y: from.y },
    { x: to.x - into * reach, y: to.y },
    { x: to.x, y: to.y },
  ];
}

/** A point a fraction of the way from one place to another. */
export function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Where a cubic is at `t`, by de Casteljau. */
export function pointAt(p: readonly Point[], t: number): Point {
  const a = mix(p[0]!, p[1]!, t);
  const b = mix(p[1]!, p[2]!, t);
  const c = mix(p[2]!, p[3]!, t);
  return mix(mix(a, b, t), mix(b, c, t), t);
}

/** The path a set of four control points draws. */
export function bezier(p: readonly Point[]): string {
  return (
    `M ${round(p[0]!.x)} ${round(p[0]!.y)} C ${round(p[1]!.x)} ${round(p[1]!.y)}, ` +
    `${round(p[2]!.x)} ${round(p[2]!.y)}, ${round(p[3]!.x)} ${round(p[3]!.y)}`
  );
}

/**
 * The same curve with its last `back` pixels taken off.
 *
 * Cut with de Casteljau rather than by stepping back along the end tangent: the
 * curve is at its most bent right where it arrives, so a straight backoff of a
 * head's length lands off the line and leaves a visible kink between the stem
 * and the triangle it feeds.
 *
 * The points come back rounded. Every one of them is about to be printed into a
 * path attribute, and full double precision writes sixteen digits per number
 * for a difference nothing can see.
 */
export function shorten(p: readonly Point[], back: number): Point[] {
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

/** Where a curve ends, for placing the head that finishes it. */
export function curveEnd(points: readonly Point[]): Point {
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

/**
 * The point on a dot's rim that faces where the line is going.
 *
 * The middle of the ring rather than the outside of it: a line stopping cleanly
 * at the outer edge leaves a hairline of background between the two, and what
 * that draws is a dot with a gap after it rather than a line leaving a dot.
 */
export function rim(centre: Point, towards: Point, radius: number): Point {
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: round(centre.x + (dx / length) * radius),
    y: round(centre.y + (dy / length) * radius),
  };
}
