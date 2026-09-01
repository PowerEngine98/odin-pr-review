/**
 * When the bridges have been worked out, so the drawing can wait for them.
 *
 * A bridge is a decoration on a road, and the road is the thing being waited
 * for: which arrows cross which cannot be known until every road is planned,
 * and planning them all is the last thing the first frame does. So the sweep
 * happens after that frame rather than inside it — the arrows go up, and a beat
 * later the ones that cross gain their hops.
 *
 * This is the signal that the beat has passed. The arrows are derived from it
 * as well as from the placement, so the second pass redraws them and nothing
 * else has to know that a second pass exists.
 */
const state = $state({ done: 0 });

/** Bumped when a sweep finishes, which is what wakes the drawing. */
export function crossed(): void {
  state.done += 1;
}

/** Read by whoever draws the roads, so a finished sweep reaches the page. */
export function bridgesAt(): number {
  return state.done;
}

/**
 * After the frame, and only once at a time.
 *
 * A frame rather than an idle callback: idle can be a long way off on a busy
 * machine, and the gap between "the arrows are there" and "the crossings are
 * marked" is meant to be one beat rather than whenever the browser feels
 * unhurried.
 */
let waiting = false;

export function afterTheFrame(run: () => void): void {
  if (waiting) return;
  waiting = true;
  const go = () => {
    waiting = false;
    run();
    crossed();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
  else setTimeout(go, 0);
}
