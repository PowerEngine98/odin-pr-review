import { Sequence, type Arrival, type Flight } from "./sequence.js";

/**
 * The build sequence, as the page's own state.
 *
 * The arithmetic — what leaves when, what has landed, when there is nothing
 * left to watch — is in `sequence.ts`, which knows nothing about windows and
 * can therefore be tested. This is the part that has to be reactive: what the
 * drawing reads to know whether to show a card, and what the sequence reads to
 * know what time it is.
 */
const run = new Sequence();

const state = $state({
  /** Bumped whenever the sequence moves, which is what redraws it. */
  at: 0,
  /** What the build is doing, in the fewest words that are true. */
  doing: "",
  /** Roads planned so far, and how many there are, when that is known. */
  roads: { done: 0, total: 0 },
});

/** Whether anything is being watched arrive. */
export function booting(): boolean {
  void state.at;
  return run.running;
}

/** The squares currently in the air, for whoever draws them. */
export function flights(): readonly Flight[] {
  void state.at;
  return run.flying;
}

/** Whether a thing has arrived, so the real one can be shown in its place. */
export function landed(id: string): boolean {
  void state.at;
  return run.landed(id);
}

/** What the build is doing, and how far the roads have got. */
export function doing(): string {
  return state.doing;
}

export function roadsDone(): { done: number; total: number } {
  return state.roads;
}

/** Say what the build is doing now. */
export function bootDoing(what: string): void {
  if (run.running) state.doing = what;
}

/** Say how the roads are coming along, which is the last stage of a build. */
export function bootRoads(done: number, total: number): void {
  state.roads = { done, total };
}

/*
 * The clock and the frame, which belong to a window.
 *
 * The tests, the written document and the server-side render have neither, so
 * they hand nothing in and nothing flies — the right answer for all three,
 * since none of them has anybody watching.
 */
let now: () => number = () => 0;
let frame: ((go: () => void) => void) | null = null;
let ticking = false;

export function driveBoot(
  clock: () => number,
  scheduleFrame: (go: () => void) => void,
): void {
  now = clock;
  frame = scheduleFrame;
  if (!run.running) return;
  /*
   * The sequence can begin before there is a window to time it against — the
   * page says "start" as it wakes up and the component holding the clock
   * mounts a moment later. Until now the clock answered zero, so the sequence's
   * idea of when it began is nonsense: the first real reading would be twenty
   * seconds after it, and it would give up on the spot.
   */
  run.rebase(now());
  wake();
}

/** Start watching. Anything announced from here on is drawn arriving. */
export function bootStart(what = "reading the change"): void {
  if (run.running) return;
  run.start(now());
  state.doing = what;
  state.at += 1;
  wake();
}

/** Stop watching, landing whatever was still on its way. */
export function bootEnd(): void {
  if (!run.running) return;
  run.end();
  state.doing = "";
  state.at += 1;
}

/**
 * Something is ready, and here is where it goes.
 *
 * Safe on a page that has already been built: a card measured after a save
 * announces exactly as it did during the first build, and lands at once
 * because there is no sequence for it to join.
 */
export function announce(arrival: Arrival): void {
  if (run.add(arrival)) wake();
}

function wake(): void {
  if (ticking || !frame || !run.running) return;
  ticking = true;
  frame(tick);
}

function tick(): void {
  ticking = false;
  const more = run.step(now());
  // One bump per frame rather than one per landing: everything that reads the
  // sequence reads all of it, and a frame is the smallest thing worth redrawing
  // for.
  state.at += 1;
  if (more) wake();
  else state.doing = "";
}

export type { Arrival, Flight } from "./sequence.js";
export { PACE } from "./sequence.js";
