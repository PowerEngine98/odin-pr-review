/**
 * How big a drawing is, and how big the box pinned to the canvas has to be.
 *
 * Split out of the components for the reason `heading.ts` gives at length: this
 * is the part with the units in it, and the units are where every version of
 * this has gone wrong. A diagram is measured in the panel, which is chrome and
 * is drawn in window pixels, and then it is put down inside the one transformed
 * layer — `translate(view.x, view.y) scale(view.scale)` — where everything is
 * in canvas units. The two agree at scale one and nowhere else, and scale one
 * is what a screenshot of a page that has just opened always shows.
 *
 * ## A pinned drawing is in canvas units, and scales
 *
 * The box is `position: absolute` inside the transformed layer, so its `left`,
 * `top`, `width` and `height` are canvas units, and everything laid out inside
 * it — the SVG mermaid produced, at whatever size mermaid decided it was — is
 * laid out in those same units before the layer's scale is applied to the lot.
 *
 * That is the whole of the first fault. The size was worked out as `360 /
 * view.scale`, which is a length in window pixels converted into canvas units:
 * it makes the *box* a constant size on the screen whatever the zoom, while the
 * drawing inside it goes on being laid out at its own size. Zoomed out, a
 * reader got a box several times too large with a small picture adrift in the
 * corner of it; zoomed in, a box too small for the drawing, which then scrolled
 * inside it. Neither number was the diagram's. Both came from the wrong end of
 * the conversion.
 *
 * So the size a drawing is pinned at is the size the drawing actually is, in
 * the units the drawing is laid out in, and the zoom is not in the arithmetic
 * at all. A pinned diagram then grows and shrinks with the cards it was put
 * beside, which is what "pinned to the change" was always supposed to mean.
 *
 * ## Which leaves the measurement, and it is taken on the screen
 *
 * A drawing's own size comes off the `viewBox` mermaid writes, because that is
 * the one number on the SVG that is the drawing's and not the box's: the
 * element's own width is whatever the container allowed it — the panel is
 * narrow and the rule there is `max-width: 100%`, so a wide diagram measured
 * that way reports the panel's width and the pinned copy inherits a size that
 * belongs to a completely different piece of furniture.
 */

/** What a drawing measures, in the units its own SVG is laid out in. */
export interface Drawn {
  width: number;
  height: number;
}

/** Where a pinned drawing sits and how big it is, all in canvas units. */
export interface PinBox extends Drawn {
  x: number;
  y: number;
}

/**
 * What the box around a drawing costs, in canvas units.
 *
 * Read off the styles the two components are actually drawn with, so the room
 * asked for is the room the drawing ends up with. Across: the pin's own border,
 * the body's padding, and the padding and border of the diagram inside it.
 * Down: the same again, plus the bar that the pin is dragged by and the
 * margin the diagram carries above and below itself.
 *
 * A pixel or two out either way is not a fault worth chasing — the SVG is held
 * to `max-width: 100%`, so a box a hair too small shrinks the picture by a hair
 * rather than cutting anything off. What matters is that the bar is paid for at
 * all: left out, every pinned drawing is a title bar's worth too short and the
 * bottom row of it is under the edge.
 */
export const PIN_CHROME: Drawn = { width: 24, height: 63 };

/**
 * What a drawing is given when nothing could measure it.
 *
 * A diagram that has not drawn yet — the renderer still downloading, the source
 * one mermaid will not parse — has no size of its own to take, and a reader who
 * drags one onto the change still has to land with something. These are canvas
 * units now rather than window pixels divided by the zoom, so the fallback is a
 * box the size of a small card instead of a number that meant one thing at one
 * zoom.
 */
export const PIN_UNMEASURED: Drawn = { width: 360, height: 260 };

/**
 * The smallest a pinned drawing may be, which is the floor the grip enforces.
 *
 * Kept the same as the resize handle's so that a box cannot be dropped smaller
 * than it can be dragged back to — a one-line diagram measures about nothing,
 * and a box of about nothing has no bar left to take hold of.
 */
export const PIN_LEAST: Drawn = { width: 160, height: 120 };

/**
 * The drawing's own size, from the `viewBox` mermaid wrote on it.
 *
 * Four numbers, of which the last two are the ones the layout came to. Anything
 * else — no attribute, a malformed one, a zero — is no answer rather than a
 * wrong one, and the caller falls back.
 */
export function sizeFromViewBox(viewBox: string | null | undefined): Drawn | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [, , width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * A size written down for the journey across a drag, and read back.
 *
 * It travels beside the source on the transfer rather than being measured at
 * the far end, because at the far end there is nothing to measure: what is
 * dropped is a few lines of mermaid, and the drawing they become does not exist
 * until something has drawn it. The panel has one on the screen at that moment
 * and can simply say how big it is.
 *
 * Plain text, because that is all a data transfer carries, and shaped so that
 * anything else a reader might drag onto the canvas reads back as nothing.
 */
export function saySize(drawn: Drawn | null | undefined): string {
  if (!drawn) return "";
  return `${Math.round(drawn.width)}x${Math.round(drawn.height)}`;
}

/** The other half: what was said, or nothing at all if it was not ours. */
export function readSize(said: string | null | undefined): Drawn | null {
  if (!said) return null;
  const found = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(said.trim());
  if (!found) return null;
  const width = Number(found[1]);
  const height = Number(found[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * Where a drawing dropped at a point on the canvas goes, and how big it is.
 *
 * The point is already in canvas units — converting it is the camera's job,
 * since the camera is what knows the transform — and so is the size, which is
 * the drawing's own. Nothing here divides by the zoom, and that is the fix: the
 * two quantities being added are finally in the same units.
 *
 * Dropped by its middle across and a quarter of the way down, which is roughly
 * where a reader thinks they are holding a thing they have dragged, rather than
 * by its top-left corner, which is where the pointer is not.
 */
export function pinBox(
  at: { x: number; y: number },
  drawn: Drawn | null | undefined,
): PinBox {
  const size = drawn ?? PIN_UNMEASURED;
  const width = Math.round(Math.max(PIN_LEAST.width, size.width + PIN_CHROME.width));
  const height = Math.round(
    Math.max(PIN_LEAST.height, size.height + PIN_CHROME.height),
  );
  return {
    x: Math.round(at.x - width / 2),
    y: Math.round(at.y - height / 4),
    width,
    height,
  };
}

/**
 * How much the layer an element sits in is scaling it by.
 *
 * The one number that tells a component inside the canvas that it is not being
 * measured in its own units. `getBoundingClientRect` reports what is on the
 * screen — every transform between the element and the window is already in it
 * — while `offsetWidth` reports what was laid out, which is the canvas unit. The
 * ratio of the two is the whole transform stack above, whoever applied it.
 *
 * It is worked out this way rather than read off the camera because the thing
 * that needs it is a panel component that happens to have been mounted inside
 * the canvas, and a component should not have to know which of its ancestors
 * are scaled in order to measure text correctly.
 *
 * One when there is nothing to divide — an element with no width yet, a page
 * with no layout — because one is the answer that changes nothing.
 */
export function zoomOf(onScreen: number, laidOut: number): number {
  if (!(onScreen > 0) || !(laidOut > 0)) return 1;
  const ratio = onScreen / laidOut;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  // Whole pixels go into `offsetWidth` and fractions come out of the rect, so
  // an unscaled element reports a ratio a hair either side of one. Treating
  // that as a zoom would counter-transform every diagram in the page for
  // nothing.
  return Math.abs(ratio - 1) < 0.005 ? 1 : ratio;
}

/**
 * How far a pointer may wander before a press stops being a press.
 *
 * A diagram answers to both gestures: dragged, it is pinned to the change;
 * pressed, it opens full size. They begin identically, so the only thing that
 * tells them apart is whether the pointer went anywhere, and a hand on a
 * trackpad moves a pixel or two while clicking. Four is comfortably above that
 * and well below any movement a person means as a drag.
 */
export const PRESS_SLOP = 4;

/** Whether a pointer that went from one place to another was a drag. */
export function wandered(
  from: { x: number; y: number },
  to: { x: number; y: number },
  slop: number = PRESS_SLOP,
): boolean {
  return Math.abs(to.x - from.x) > slop || Math.abs(to.y - from.y) > slop;
}
