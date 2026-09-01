/**
 * The order things arrive in while a drawing is being built.
 *
 * A large change takes seconds to put on screen, and what those seconds looked
 * like was a covered window with a number on it. A bar at sixty per cent is the
 * same picture whether the tool is reading a diff, resolving a reference or
 * painting a row — a countdown rather than a view.
 *
 * So the page builds itself in front of the reader: each thing that becomes
 * ready says so, and its arrival is drawn as a square leaving the middle of the
 * window for the place the thing belongs. This is the arithmetic of that — what
 * leaves when, what has landed, and when there is nothing left to watch. It
 * knows nothing about windows, frames or elements, which is why it can be
 * tested rather than described.
 */

export interface Arrival {
  id: string;
  kind: "node" | "tab";
  /** Where it lands, in the window's own coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** What happened to the file, as a colour the square is drawn in. */
  tone: string;
}

/** An arrival on its way, with the moment it left. */
export interface Flight extends Arrival {
  left: number;
}

/**
 * How long each kind takes, and how closely they follow one another.
 *
 * Tabs are slow and single file: there are a handful, they are the shape of the
 * change rather than a file in it, and each is worth reading as it lands. Cards
 * are quick and come in numbers, because there are two hundred and a reader
 * watching them one at a time would be watching for a minute.
 */
export const PACE = {
  node: { flight: 420, apart: 16, batch: 6 },
  tab: { flight: 900, apart: 130, batch: 1 },
} as const;

/** How long a gap has to be before the build counts as over. */
export const QUIET = 700;

/**
 * And how long the whole sequence may last, whatever happens.
 *
 * A build that has taken this long has something wrong with it, and a
 * decoration that outlives the thing it decorates is worse than one that gives
 * up.
 */
export const GIVE_UP = 20_000;

export class Sequence {
  running = false;

  private waiting: Arrival[] = [];
  private going: Flight[] = [];
  private here = new Set<string>();
  /** What is queued or in the air, which is the only thing held back. */
  private pending = new Set<string>();
  private began = 0;
  private busy = 0;
  private lastOff = -Infinity;

  /** Everything currently in the air. */
  get flying(): readonly Flight[] {
    return this.going;
  }

  /** Nothing waiting and nothing flying. */
  get idle(): boolean {
    return this.waiting.length === 0 && this.going.length === 0;
  }

  /** Whether anything has arrived at all. */
  get anyArrived(): boolean {
    return this.here.size > 0;
  }

  /**
   * Whether a thing may be drawn for real.
   *
   * Held back only while its square is actually queued or in the air. Anything
   * else is drawn — including something this sequence has never heard of,
   * which is the important case: the drawing must not be hidden by a sequence
   * that has lost track of it. That is not hypothetical. The first version
   * hid whatever had not landed, the queue was emptied by a bug on the way
   * past, and two hundred cards stayed invisible for as long as the page was
   * open. A decoration cannot be allowed to fail like that.
   */
  landed(id: string): boolean {
    if (!this.running) return true;
    return !this.pending.has(id);
  }

  start(at: number): void {
    if (this.running) return;
    this.running = true;
    this.waiting = [];
    this.going = [];
    this.here = new Set();
    this.pending = new Set();
    this.began = at;
    this.busy = at;
    this.lastOff = -Infinity;
  }

  /**
   * The same sequence, timed against a different clock.
   *
   * The page starts watching as it wakes up, before there is a window to time
   * anything against, so the first readings are from a clock that answers zero.
   * When the real one arrives the sequence has to be told, or its idea of when
   * it began is twenty seconds in the past and it gives up at once. Everything
   * queued stays queued: restarting instead loses whatever was announced in
   * between, which is exactly how the drawing came to be hidden.
   */
  rebase(at: number): void {
    if (!this.running) return;
    this.began = at;
    this.busy = at;
    this.lastOff = -Infinity;
    for (const one of this.going) one.left = at;
  }

  /**
   * Something is ready, and here is where it goes.
   *
   * Ignored when nothing is being watched, so the same call is safe on a page
   * that has already been built.
   */
  add(one: Arrival): boolean {
    if (!this.running) return false;
    if (this.here.has(one.id)) return false;
    if (this.waiting.some((other) => other.id === one.id)) return false;
    if (this.going.some((other) => other.id === one.id)) return false;
    this.waiting.push(one);
    this.pending.add(one.id);
    return true;
  }

  /**
   * Everything still queued arrives at once, and the watching stops.
   *
   * The sequence is a way of seeing the page arrive, never a gate it has to get
   * through: a card that is ready must not be held back by an animation about
   * it.
   */
  end(): void {
    if (!this.running) return;
    for (const one of this.waiting) this.here.add(one.id);
    for (const one of this.going) this.here.add(one.id);
    this.waiting = [];
    this.going = [];
    this.pending = new Set();
    this.running = false;
  }

  /**
   * Move to `at`: land what has arrived, and let the next few go.
   *
   * Returns whether anything is still expected, so the caller knows whether to
   * ask again.
   */
  step(at: number): boolean {
    if (!this.running) return false;

    const still: Flight[] = [];
    for (const one of this.going) {
      if (at - one.left >= PACE[one.kind].flight) {
        this.here.add(one.id);
        this.pending.delete(one.id);
      } else still.push(one);
    }
    this.going = still;

    const next = this.waiting[0];
    if (next) {
      const pace = PACE[next.kind];
      if (at - this.lastOff >= pace.apart) {
        for (let sent = 0; sent < pace.batch; sent++) {
          const first = this.waiting[0];
          // One kind at a time: a tab that has waited its turn should not be
          // swept out in the middle of a burst of cards, at the cards' pace.
          if (!first || first.kind !== next.kind) break;
          this.waiting.shift();
          this.going.push({ ...first, left: at });
        }
        this.lastOff = at;
      }
    }

    if (!this.idle) {
      this.busy = at;
      return true;
    }

    /*
     * Nothing left to watch.
     *
     * What ends the sequence is the absence of news. Held for a moment first: a
     * build arrives in bursts with gaps between them, and ending on the first
     * gap would put the mark away while two thirds of the change was still
     * being read. Something must have arrived, or a page whose model has not
     * turned up yet would end the sequence before it began.
     */
    if (this.anyArrived && at - this.busy >= QUIET) {
      this.end();
      return false;
    }
    if (at - this.began >= GIVE_UP) {
      this.end();
      return false;
    }
    return true;
  }
}
