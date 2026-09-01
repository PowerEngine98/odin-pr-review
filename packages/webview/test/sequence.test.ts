import { describe, expect, it } from "vitest";

import { GIVE_UP, PACE, QUIET, Sequence, type Arrival } from "../src/app/hud/sequence.js";

/**
 * A drawing that assembles itself while the reader watches.
 *
 * What a large change used to show while it was being built was a covered
 * window with a percentage on it — the same picture whether the tool was
 * reading a diff, resolving a reference or painting a row. This is the same
 * seconds spent saying what is actually happening: each file and each tab
 * leaves the middle of the window as it becomes ready and lands where it
 * belongs.
 *
 * The rule underneath all of it: the sequence is a way of watching the page
 * arrive, never a gate the page has to get through.
 */

function arrival(id: string, kind: "node" | "tab" = "node"): Arrival {
  return { id, kind, x: 100, y: 200, width: 300, height: 180, tone: "green" };
}

describe("watching a drawing arrive", () => {
  it("shows everything at once when nothing is being watched", () => {
    // A page that is not building is a page whose cards are simply drawn.
    const run = new Sequence();
    expect(run.landed("n:1")).toBe(true);
    expect(run.add(arrival("n:1"))).toBe(false);
  });

  it("holds a thing back only until its square has landed", () => {
    const run = new Sequence();
    run.start(0);
    run.add(arrival("n:1"));
    expect(run.landed("n:1")).toBe(false);

    run.step(0);
    expect(run.flying).toHaveLength(1);
    expect(run.landed("n:1")).toBe(false);

    run.step(PACE.node.flight);
    expect(run.landed("n:1")).toBe(true);
    expect(run.flying).toHaveLength(0);
  });

  it("lets cards go in handfuls and tabs one at a time", () => {
    /*
     * There are two hundred cards and a handful of tabs. A reader watching the
     * cards one at a time would be watching for a minute; a tab is the shape of
     * the change rather than a file in it, and is worth reading as it lands.
     */
    const cards = new Sequence();
    cards.start(0);
    for (let at = 0; at < 20; at++) cards.add(arrival(`n:${at}`));
    cards.step(0);
    expect(cards.flying).toHaveLength(PACE.node.batch);

    const tabs = new Sequence();
    tabs.start(0);
    for (let at = 0; at < 5; at++) tabs.add(arrival(`t:${at}`, "tab"));
    tabs.step(0);
    expect(tabs.flying).toHaveLength(1);
  });

  it("does not sweep a tab out at the cards' pace", () => {
    // The batch is a burst of one kind. A tab caught in the middle of one would
    // arrive at a card's speed, which is the one thing that distinguishes them.
    const run = new Sequence();
    run.start(0);
    run.add(arrival("n:1"));
    run.add(arrival("n:2"));
    run.add(arrival("t:1", "tab"));
    run.step(0);
    expect(run.flying.map((one) => one.id)).toEqual(["n:1", "n:2"]);
  });

  it("waits between batches", () => {
    const run = new Sequence();
    run.start(0);
    for (let at = 0; at < 20; at++) run.add(arrival(`n:${at}`));
    run.step(0);
    run.step(1);
    expect(run.flying).toHaveLength(PACE.node.batch);
    run.step(PACE.node.apart);
    expect(run.flying).toHaveLength(PACE.node.batch * 2);
  });

  it("says the same thing twice as one arrival", () => {
    const run = new Sequence();
    run.start(0);
    expect(run.add(arrival("n:1"))).toBe(true);
    expect(run.add(arrival("n:1"))).toBe(false);
    run.step(0);
    expect(run.flying).toHaveLength(1);
  });

  it("ends on a gap, once something has actually arrived", () => {
    const run = new Sequence();
    run.start(0);
    run.add(arrival("n:1"));
    run.step(0);
    run.step(PACE.node.flight);
    expect(run.running).toBe(true);

    expect(run.step(PACE.node.flight + QUIET)).toBe(false);
    expect(run.running).toBe(false);
  });

  it("does not end before anything has arrived", () => {
    // A page whose model has not turned up yet would otherwise finish the
    // sequence before it began, and the first card would appear with no
    // ceremony at all.
    const run = new Sequence();
    run.start(0);
    expect(run.step(QUIET * 3)).toBe(true);
    expect(run.running).toBe(true);
  });

  it("gives up on a build that never finishes", () => {
    const run = new Sequence();
    run.start(0);
    expect(run.step(GIVE_UP)).toBe(false);
    expect(run.running).toBe(false);
  });

  it("lands everything still queued when it ends", () => {
    /*
     * The whole point. A card that is ready must never be held back by an
     * animation about it, so ending the sequence — for any reason — puts every
     * outstanding thing on the drawing at once.
     */
    const run = new Sequence();
    run.start(0);
    run.add(arrival("n:1"));
    run.add(arrival("n:2"));
    run.step(0);
    run.end();

    expect(run.landed("n:1")).toBe(true);
    expect(run.landed("n:2")).toBe(true);
    expect(run.flying).toHaveLength(0);
  });

  it("shows a thing it has never heard of", () => {
    /*
     * The safety property, and it was learned the hard way: the first version
     * held back whatever had not landed, a bug emptied the queue on the way
     * past, and two hundred cards stayed invisible for as long as the page was
     * open. Only a square that is actually queued or in the air hides anything.
     */
    const run = new Sequence();
    run.start(0);
    run.add(arrival("n:1"));
    run.step(0);
    expect(run.landed("n:1")).toBe(false);
    expect(run.landed("n:2")).toBe(true);
  });

  it("keeps what was announced when the clock is replaced", () => {
    /*
     * The page starts watching before there is a window to time it against, so
     * the real clock arrives after the first announcements. Starting again
     * instead of re-timing loses them — which is the bug above, from the other
     * end.
     */
    const run = new Sequence();
    run.start(0);
    run.add(arrival("n:1"));
    run.rebase(5_000);

    run.step(5_000);
    expect(run.flying).toHaveLength(1);
    run.step(5_000 + PACE.node.flight);
    expect(run.landed("n:1")).toBe(true);
  });

  it("does not give up early on a clock that started elsewhere", () => {
    // Twenty seconds after zero is now, on a page that has been open a while.
    const run = new Sequence();
    run.start(0);
    run.rebase(40_000);
    run.add(arrival("n:1"));
    expect(run.step(40_000)).toBe(true);
    expect(run.running).toBe(true);
  });
});
