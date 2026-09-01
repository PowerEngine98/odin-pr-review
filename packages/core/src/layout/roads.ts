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

/** A building the roads have to go around. */
export interface Blocking {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a road keeps off a card, so it passes rather than leans on it. */
export const CLEAR = 12;

/**
 * How many buildings one road will plan around.
 *
 * The streets are the lines the buildings leave between them, so the map is
 * their count squared. Two dozen is a couple of thousand junctions and a
 * fraction of a millisecond; a hundred would be forty thousand, for one arrow,
 * on a drawing with hundreds of them.
 *
 * Past this the road is planned around the buildings nearest it rather than
 * abandoned. Giving up entirely was the wrong answer to the wrong question: a
 * road long enough to pass two dozen cards is exactly the road that most needs
 * planning, and the plain one it fell back to went straight through all of
 * them. Planning around the nearest two dozen may still clip something far
 * down its length; it will not walk through the wall in front of it.
 */
const CROWD = 24;

/**
 * How many times a road will be planned again before it is drawn as it stands.
 *
 * Each go puts the buildings the last road walked into onto the map, so each is
 * a road that knows something the one before it did not, and the loop stops of
 * its own accord as soon as a road hits nothing. The cap is only for the road
 * that never settles. It was three, which was a guess and too low: on a change
 * of two hundred cards the worst road needed eleven, and the fourteen roads
 * that ran out of goes were drawn straight through the cards they had not yet
 * been told about. Twelve reaches every one of them, and costs nothing on the
 * ones that never ask, since a road that hits nothing is planned once.
 */
const ATTEMPTS = 12;

/**
 * The buildings a road is most likely to hit, when there are too many to map.
 *
 * Nearest to the straight line between the ends, which is where the road will
 * be if nothing pushes it off — so the ones it would walk into come first and
 * the ones it would pass at a distance are the ones dropped. A dropped building
 * is not a wrong road, only an unplanned one: the road may still clip something
 * far down its length, where before it went through everything.
 */
function closest(
  walls: readonly Blocking[],
  from: Point,
  to: Point,
  keep: number,
): Blocking[] {
  const scored = walls.map((wall) => ({
    wall,
    away: toSegment(
      { x: wall.x + wall.width / 2, y: wall.y + wall.height / 2 },
      from,
      to,
    ),
  }));
  scored.sort((one, two) => one.away - two.away);
  return scored.slice(0, keep).map((one) => one.wall);
}

/** How far a point is from a line segment. */
function toSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
}

/** Whether a run passes through any building. */
function blocked(
  a: Point,
  b: Point,
  walls: readonly Blocking[],
  margin: number,
): boolean {
  const lowX = Math.min(a.x, b.x);
  const highX = Math.max(a.x, b.x);
  const lowY = Math.min(a.y, b.y);
  const highY = Math.max(a.y, b.y);

  for (const wall of walls) {
    if (
      highX <= wall.x - margin ||
      lowX >= wall.x + wall.width + margin ||
      highY <= wall.y - margin ||
      lowY >= wall.y + wall.height + margin
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/** The cheapest open junction, in log time rather than by looking at them all. */
class Queue {
  private readonly nodes: number[] = [];
  private readonly costs: number[] = [];

  push(node: number, cost: number): void {
    this.nodes.push(node);
    this.costs.push(cost);
    let at = this.nodes.length - 1;
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (this.costs[up]! <= this.costs[at]!) break;
      this.swap(at, up);
      at = up;
    }
  }

  pop(): number | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0]!;
    const node = this.nodes.pop()!;
    const cost = this.costs.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = node;
      this.costs[0] = cost;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let small = at;
        if (left < this.costs.length && this.costs[left]! < this.costs[small]!) small = left;
        if (right < this.costs.length && this.costs[right]! < this.costs[small]!) small = right;
        if (small === at) break;
        this.swap(at, small);
        at = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!];
    [this.costs[a], this.costs[b]] = [this.costs[b]!, this.costs[a]!];
  }
}

/**
 * A road that goes around the buildings rather than through them.
 *
 * The picture is buildings and streets: cards, and the space between them. The
 * arrows are drawn under the cards — they have to be, or every road would be
 * laid across the code it connects — so a road that crosses a card is a road
 * that disappears and comes out the other side. At a distance, where the cards
 * are solid blocks, what the reader sees is a line in pieces with no way to
 * tell which pieces belong together.
 *
 * The streets are found rather than invented: each building offers a line clear
 * of each of its four sides, and where those lines cross is a junction. That is
 * the gaps between the buildings, exactly. Then A* over it, by distance, with a
 * small charge for turning so that two roads of equal length are not chosen
 * between at random — the same pair would otherwise be joined by a staircase
 * one frame and a dog-leg the next.
 *
 * The plain road is kept for the two cases where planning is not worth it:
 * nothing is in the way, which is most arrows, and too much is.
 */
export function roadAround(
  from: Point,
  to: Point,
  goesRight: boolean,
  walls: readonly Blocking[],
  margin: number = CLEAR,
): Point[] {
  const plain = roadPoints(from, to, goesRight);
  /*
   * A level road is two points and used to be waved through here, on the
   * grounds that there is nothing to plan. There is: two cards can sit at the
   * same height with a third between them, and the straight line joining them
   * goes through it. That was the commonest broken road on a large drawing —
   * the one case where the shortest road is also the one most likely to be
   * obstructed, and the only one that was never asked.
   */
  if (walls.length === 0 || plain.length < 2) return plain;

  const lowX = Math.min(from.x, to.x) - margin;
  const highX = Math.max(from.x, to.x) + margin;
  const lowY = Math.min(from.y, to.y) - margin;
  const highY = Math.max(from.y, to.y) + margin;
  // Only what stands between the two ends: a card on the far side of the
  // drawing cannot be in the way, and counting it would cost the search dearly.
  const near: Blocking[] = [];
  for (const wall of walls) {
    if (
      wall.x + wall.width + margin > lowX &&
      wall.x - margin < highX &&
      wall.y + wall.height + margin > lowY &&
      wall.y - margin < highY
    ) {
      near.push(wall);
    }
  }
  if (near.length === 0) return plain;

  let crosses = false;
  for (let at = 1; at < plain.length && !crosses; at++) {
    crosses = blocked(plain[at - 1]!, plain[at]!, near, margin);
  }
  if (!crosses) return plain;

  /*
   * Planned against the buildings it is about to hit, and then checked against
   * every building on the drawing.
   *
   * The map has to be small — it is the buildings squared — so on a crowded
   * drawing it holds the ones nearest the straight line and nothing else. A
   * road planned around those can still walk into one that was left off, and
   * that is worth another go rather than a shrug: the ones it hit are exactly
   * the ones the map was missing, so they go on it and it plans again.
   *
   * Checked against everything and not merely against `near`, which is the
   * cheap answer and was the wrong one. `near` is what stands in the box
   * between the two ends, and a road that has to detour leaves that box — it
   * goes over or under the building in its way, and out there stands a card
   * nobody mentioned. Because that card was not on the list, the road came back
   * reported clean and was drawn straight through it. Half the roads still
   * crossing a card on a real change were this, every one of them with nothing
   * against it on its own map.
   */
  let around = near.length > CROWD ? closest(near, from, to, CROWD) : near;
  // What the map already holds, kept beside it because the check is made once
  // per building per go and scanning the map for each was the second-largest
  // cost in the loop.
  const mapped = new Set(around);
  for (let go = 0; ; go++) {
    const road = search(from, to, goesRight, around, margin);
    if (!road) return plain;

    const hit = walls.filter(
      (wall) => !mapped.has(wall) && crossesAny(road, wall, margin),
    );
    if (hit.length === 0 || go >= ATTEMPTS) return road;

    for (const wall of hit) mapped.add(wall);
    around = [...around, ...hit].slice(0, CROWD * 3);
  }
}

/** Whether any leg of a road passes through one building. */
function crossesAny(road: readonly Point[], wall: Blocking, margin: number): boolean {
  for (let at = 1; at < road.length; at++) {
    if (blocked(road[at - 1]!, road[at]!, [wall], margin)) return true;
  }
  return false;
}

/**
 * One run of the search, over the map it is given.
 *
 * Nothing here decides what is on the map — that is the caller's, and it may
 * ask again with more on it.
 */
function search(
  from: Point,
  to: Point,
  goesRight: boolean,
  around: readonly Blocking[],
  margin: number,
): Point[] | null {
  /*
   * The search runs between the stubs, not the ends.
   *
   * A road has to leave and arrive square to the card — that is what makes the
   * head point at the row rather than down onto it — and a search left to
   * itself will come down from above, because that is a perfectly good path and
   * nobody told it otherwise. Those two legs are fixed here.
   */
  const away = goesRight ? 1 : -1;
  const leaves = { x: from.x + away * STUB, y: from.y };
  const arrives = { x: to.x - away * STUB, y: to.y };

  const xs = new Set<number>([leaves.x, arrives.x]);
  const ys = new Set<number>([leaves.y, arrives.y]);
  for (const wall of around) {
    xs.add(wall.x - margin);
    xs.add(wall.x + wall.width + margin);
    ys.add(wall.y - margin);
    ys.add(wall.y + wall.height + margin);
  }
  const lanes = [...xs].sort((a, b) => a - b);
  const rows = [...ys].sort((a, b) => a - b);

  const wide = lanes.length;
  const tall = rows.length;
  const total = wide * tall;
  const at = (col: number, row: number) => row * wide + col;

  /*
   * Which runs between junctions are shut, worked out once rather than at each
   * junction in turn.
   *
   * Every junction the search settles asks about the four runs off it, and each
   * answer used to be a scan of every building on the map — so the search cost
   * the junctions times the buildings, and planning a road around two dozen of
   * them was expensive enough that the number had to be kept low and the
   * retries few. Both of those were the reason roads were still being drawn
   * through cards.
   *
   * Each building can instead shut its own runs in one pass, because the lanes
   * and the rows are the buildings' own edges: the runs one building blocks are
   * a rectangle of the grid, found by walking to its first and last lane and
   * row, not a set that has to be searched for. The answers are the same ones —
   * the comparisons below are `blocked` written out for a run that is level or
   * upright, which every run here is.
   */
  const shutAcross = new Uint8Array(total);
  const shutDown = new Uint8Array(total);
  for (const wall of around) {
    const lowX = wall.x - margin;
    const highX = wall.x + wall.width + margin;
    const lowY = wall.y - margin;
    const highY = wall.y + wall.height + margin;

    let firstRow = 0;
    while (firstRow < tall && rows[firstRow]! <= lowY) firstRow++;
    let lastRow = tall - 1;
    while (lastRow >= 0 && rows[lastRow]! >= highY) lastRow--;
    let firstLane = 0;
    while (firstLane < wide && lanes[firstLane]! <= lowX) firstLane++;
    let lastLane = wide - 1;
    while (lastLane >= 0 && lanes[lastLane]! >= highX) lastLane--;

    // A run reaches the building when its far end is past the near side, not
    // only when it starts inside it, so each set of runs begins one lane or one
    // row before the first that is inside.
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = Math.max(0, firstLane - 1); col <= lastLane && col < wide - 1; col++) {
        shutAcross[row * wide + col] = 1;
      }
    }
    for (let col = firstLane; col <= lastLane; col++) {
      for (let row = Math.max(0, firstRow - 1); row <= lastRow && row < tall - 1; row++) {
        shutDown[row * wide + col] = 1;
      }
    }
  }
  const start = at(lanes.indexOf(leaves.x), rows.indexOf(leaves.y));
  const goal = at(lanes.indexOf(arrives.x), rows.indexOf(arrives.y));

  const best = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const settled = new Uint8Array(total);
  best[start] = 0;

  const queue = new Queue();
  queue.push(start, 0);

  let reached = false;
  for (;;) {
    const here = queue.pop();
    if (here === undefined) break;
    if (settled[here]) continue;
    if (here === goal) {
      reached = true;
      break;
    }
    settled[here] = 1;

    const col = here % wide;
    const row = (here - col) / wide;
    const before = cameFrom[here] ?? -1;
    const wasVertical = before >= 0 ? before % wide === col : null;

    // The four ways off a junction, counted out rather than listed as pairs.
    // This is the innermost thing the whole file does, and a literal here built
    // five arrays for every junction the search settled.
    for (let side = 0; side < 4; side++) {
      const nextCol = side === 0 ? col - 1 : side === 1 ? col + 1 : col;
      const nextRow = side === 2 ? row - 1 : side === 3 ? row + 1 : row;
      if (nextCol < 0 || nextRow < 0 || nextCol >= wide || nextRow >= tall) continue;
      const next = at(nextCol, nextRow);
      if (settled[next]) continue;

      const shut =
        nextRow === row
          ? shutAcross[row * wide + Math.min(col, nextCol)]!
          : shutDown[Math.min(row, nextRow) * wide + col]!;
      if (shut) continue;

      const stepX = Math.abs(lanes[nextCol]! - lanes[col]!);
      const stepY = Math.abs(rows[nextRow]! - rows[row]!);
      const nowVertical = nextCol === col;
      const turn = wasVertical !== null && wasVertical !== nowVertical ? margin : 0;
      const cost = best[here]! + stepX + stepY + turn;
      if (cost >= best[next]!) continue;

      best[next] = cost;
      cameFrom[next] = here;
      // The estimate is the distance left as the roads run, which never
      // overstates it — so the first time the goal comes off the queue is by
      // the cheapest road to it.
      queue.push(
        next,
        cost +
          Math.abs(lanes[nextCol]! - arrives.x) +
          Math.abs(rows[nextRow]! - arrives.y),
      );
    }
  }
  if (!reached) return null;

  const road: Point[] = [];
  for (let node = goal; node >= 0; node = cameFrom[node]!) {
    const col = node % wide;
    road.push({ x: lanes[col]!, y: rows[(node - col) / wide]! });
    if (node === start) break;
  }
  road.reverse();
  // The two legs the search was not allowed an opinion about.
  return straightened([from, ...road, to]);
}

/**
 * The same road with its collinear points dropped.
 *
 * The search walks one junction at a time, so a straight run comes back as a
 * dozen points on one line. They draw identically and they are not identical to
 * work with: every corner routine downstream measures the legs either side of a
 * point, and a leg of length zero has no direction.
 */
function straightened(road: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of road) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = out[out.length - 2];
    if (last && before) {
      const wasVertical = last.x === before.x;
      const nowVertical = point.x === last.x;
      if (wasVertical === nowVertical) {
        out[out.length - 1] = point;
        continue;
      }
    }
    out.push(point);
  }
  return out;
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
 * How wide a hop over another road is.
 *
 * Twice the stroke and then some: narrower and the two lines still touch at the
 * shoulders, wider and it reads as a kink in the road rather than a crossing.
 */
export const HOP = 7;

/**
 * A road with a little bridge wherever it crosses one of the others.
 *
 * Two roads meeting at a right angle draw an X, and an X is the one thing this
 * shape cannot say: at a junction of four straight lines there is no telling
 * which pair belongs together, so a reader following an arrow across the change
 * loses it at the first crossing and picks up whichever line continues. Every
 * wiring diagram ever drawn solves this the same way — one wire hops the other
 * — and it works because a hop is the only mark on a drawing of straight lines
 * that can only mean "these two do not meet".
 *
 * Which one hops is not arbitrary. An addition goes over a deletion, because a
 * change is read forwards: what the branch does now is the thing in front, and
 * what it used to do passes underneath.
 *
 * The crossings are given rather than found here — whoever holds all the roads
 * knows which cross which, and this only has to draw them.
 */
export function roadOver(points: readonly Point[], hops: readonly Point[]): string {
  if (hops.length === 0) return roadPath(points);

  let path = "";
  for (let at = 1; at < points.length; at++) {
    const a = points[at - 1]!;
    const b = points[at]!;
    const vertical = a.x === b.x;

    // Only the hops on this leg, in the order the road meets them.
    const along = hops
      .filter((hop) =>
        vertical
          ? Math.abs(hop.x - a.x) < 0.5 &&
            hop.y > Math.min(a.y, b.y) + HOP &&
            hop.y < Math.max(a.y, b.y) - HOP
          : Math.abs(hop.y - a.y) < 0.5 &&
            hop.x > Math.min(a.x, b.x) + HOP &&
            hop.x < Math.max(a.x, b.x) - HOP,
      )
      .sort((one, two) =>
        vertical
          ? (b.y > a.y ? one.y - two.y : two.y - one.y)
          : (b.x > a.x ? one.x - two.x : two.x - one.x),
      );

    if (at === 1) path += `M ${round(a.x)} ${round(a.y)}`;
    for (const hop of along) {
      const before = vertical
        ? { x: a.x, y: hop.y - Math.sign(b.y - a.y) * HOP }
        : { x: hop.x - Math.sign(b.x - a.x) * HOP, y: a.y };
      const after = vertical
        ? { x: a.x, y: hop.y + Math.sign(b.y - a.y) * HOP }
        : { x: hop.x + Math.sign(b.x - a.x) * HOP, y: a.y };
      path += ` L ${round(before.x)} ${round(before.y)}`;
      // A half circle over the road below. Swept the same way every time, so a
      // row of hops along one road all bulge to the same side.
      path += ` A ${HOP} ${HOP} 0 0 ${vertical ? 1 : 1} ${round(after.x)} ${round(after.y)}`;
    }
    path += ` L ${round(b.x)} ${round(b.y)}`;
  }
  return path;
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
