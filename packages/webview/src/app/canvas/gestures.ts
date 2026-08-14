/**
 * Whose a wheel gesture is.
 *
 * A wheel goes to whatever the cursor happens to be over at that instant, which
 * is the wrong question when the cursor is moving. A pan that carries it across
 * the comment box, the map or a thread arrives somewhere else halfway through,
 * and the drawing stops dead under a hand that is still going. Nothing about
 * the gesture ended; it was simply delivered elsewhere.
 *
 * So the first event of a stream decides, and the rest belong to whoever the
 * first did. That reads the same from either side: a scroll begun over the
 * comment box goes on scrolling the box after the cursor has left it, and a pan
 * begun on the drawing goes on panning the drawing after the cursor has landed
 * on something else.
 */

/**
 * Long enough to bridge the gaps inside one flick, short enough that a
 * deliberate second gesture is a second gesture. Trackpads emit roughly every
 * frame while a finger is down, and momentum keeps arriving after it lifts.
 */
export const SAME_GESTURE = 250;

export interface WheelGesture {
  /** Whether this event belongs to the party `owns` recognised. */
  claims(event: { timeStamp: number; target: EventTarget | null }): boolean;
}

/**
 * Follows one stream of wheel events and says which of them are yours.
 *
 * `owns` is asked only about the first event of each gesture — the one that
 * begins it — and its answer stands until the stream goes quiet.
 */
export function wheelGesture(
  owns: (target: EventTarget | null) => boolean,
  gap: number = SAME_GESTURE,
): WheelGesture {
  // Never a moment ago, so the first wheel of the session opens a gesture
  // rather than joining one. Zero would mean "at page load", and a reader who
  // scrolls within a quarter second of the drawing appearing would find their
  // first gesture already belonged to nobody.
  let last = -Infinity;
  let ours = false;

  return {
    claims(event) {
      if (event.timeStamp - last > gap) ours = owns(event.target);
      last = event.timeStamp;
      return ours;
    },
  };
}
