import { describe, expect, it } from "vitest";

import { breathe, SLICE } from "../src/resolve/breathe.js";

/**
 * Whether the editor gets a turn while a long piece of work is running.
 *
 * Resolving the references in a change is tens of thousands of synchronous
 * probes. Written as a plain loop it holds the extension host from the first to
 * the last — an `async` function whose body never awaits is one unbroken block
 * — and everything queued behind it waits: the progress it is reporting, the
 * messages it sends to its own page, and the editor's health check, which
 * eventually decides the window is not responding and offers to close it.
 */
describe("work that lets the editor answer for itself", () => {
  /** A loop of the shape a resolver has, with and without the yield. */
  async function grind(slices: boolean): Promise<void> {
    let since = 0;
    for (let n = 0; n < SLICE * 4; n++) {
      if (slices && ++since >= SLICE) {
        since = 0;
        await breathe();
      }
      // Something synchronous, so the loop is not optimised into nothing.
      JSON.parse(JSON.stringify({ n }));
    }
  }

  /**
   * How often something already queued gets a turn while the loop runs.
   *
   * Counted by work that re-queues itself rather than by a timer: a timer only
   * fires once a millisecond of wall clock has passed, so on a fast machine
   * four yields can all happen inside the same millisecond and the count says
   * nothing happened. What is being measured is whether the loop hands the
   * queue back at all, and that is a question about turns, not about time.
   */
  async function turnsTaken(slices: boolean): Promise<number> {
    let ran = 0;
    let queued: NodeJS.Immediate;
    const again = () => {
      ran += 1;
      queued = setImmediate(again);
    };
    queued = setImmediate(again);
    try {
      await grind(slices);
    } finally {
      clearImmediate(queued);
    }
    return ran;
  }

  it("lets something else run before it is finished", async () => {
    expect(await turnsTaken(true)).toBeGreaterThan(0);
  });

  it("does not, when the loop never yields", async () => {
    /*
     * The control, kept as a test rather than as a claim. This is what the
     * resolvers did: an await-free body, which the runtime is entitled to run
     * start to finish before anything else gets a turn.
     */
    expect(await turnsTaken(false)).toBe(0);
  });

  it("hands back on a macrotask, not a microtask", async () => {
    /*
     * `await Promise.resolve()` looks like yielding and is not: the microtask
     * queue is drained by the same block, so timers and IPC still wait. Only a
     * macrotask boundary is one the host's own work is scheduled on.
     */
    const order: string[] = [];
    setImmediate(() => order.push("queued work"));
    await Promise.resolve();
    order.push("microtask");
    // Nothing queued has run yet: draining microtasks is not yielding.
    expect(order).toEqual(["microtask"]);

    await breathe();
    order.push("after breathe");
    expect(order).toEqual(["microtask", "queued work", "after breathe"]);
  });
});
