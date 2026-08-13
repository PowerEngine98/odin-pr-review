import { motion, onScreen } from "./camera.svelte.js";

/**
 * Which cards are close enough to the reader to be worth drawing in full.
 *
 * The other half of the old renderer's `virtualise`. It slept a card for two
 * reasons and only one of them came across the port: a card too small to read,
 * and a card too far away to be looked at. The second is the one that matters
 * on a large change, where the reader is always looking at a few files out of
 * seventy and the rest are rendering every row of themselves off the edge of
 * the window.
 */

/**
 * A screen and a half of slack in every direction.
 *
 * The original's number, and it is not a guess: a card has to be awake and
 * measured before the reader can see it, or they watch rows appear as they pan.
 * Padding by more than a screen means a card is already drawn by the time its
 * edge arrives, and the arrows that land on it have had somewhere real to aim
 * since well before that.
 */
const PAD = 1.5;

export interface Region {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The last region worked out while the camera was still.
 *
 * Kept so the value below can hand back the same object during a gesture. Two
 * cards asking the same question get the same answer either way; what this
 * protects is the identity of that answer, which is what decides whether every
 * card on the page recomputes.
 */
let held: Region | null = null;

/**
 * Where the reader is, in the drawing's own units, answered once per gesture.
 *
 * Deliberately not a plain function of the camera. `view` changes on every
 * frame of every drag, and a value derived straight from it would be a new
 * answer sixty times a second — so every card would re-decide whether it is
 * near, which is the work this exists to avoid. While the camera is moving this
 * reads only `motion` and returns what it last worked out, so it has no
 * dependency on the camera at all until the gesture ends. Svelte tracks what a
 * derivation actually reads, so the early return is the mechanism and not
 * merely an optimisation.
 *
 * A screen and a half of padding is what makes that safe: the region is stale
 * for the length of one gesture, and it was drawn large enough to cover one.
 */
const region = $derived.by((): Region | null => {
  if (motion.moving && held) return held;

  // No viewport has been measured — the server, or the first frame. There is no
  // region yet, and nothing is far away until there is.
  const seen = onScreen();
  if (seen.width <= 0 || seen.height <= 0) return null;

  held = {
    left: seen.left - seen.width * PAD,
    top: seen.top - seen.height * PAD,
    right: seen.left + seen.width * (1 + PAD),
    bottom: seen.top + seen.height * (1 + PAD),
  };
  return held;
});

/** Whether a card is close enough to the window to be drawn in full. */
export function near(node: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  const at = region;
  // Before anything has been measured every card is near, so a page that has
  // not been laid out yet renders what it has rather than a field of blocks
  // that would have to be replaced a frame later.
  if (!at) return true;
  return (
    node.x + node.width > at.left &&
    node.x < at.right &&
    node.y + node.height > at.top &&
    node.y < at.bottom
  );
}
