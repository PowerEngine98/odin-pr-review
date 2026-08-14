import { describe, expect, it } from "vitest";

import { SAME_GESTURE, wheelGesture } from "../src/app/canvas/gestures.js";

/** Somewhere a wheel could be pointed. Identity is all the rule needs. */
const drawing = { where: "drawing" } as unknown as EventTarget;
const box = { where: "box" } as unknown as EventTarget;

/** A stream of wheels, a fixed number of milliseconds apart. */
function stream(gesture: ReturnType<typeof wheelGesture>, start = 1000) {
  let at = start;
  return (target: EventTarget, after = 16) => {
    at += after;
    return gesture.claims({ timeStamp: at, target });
  };
}

const onDrawing = () => wheelGesture((t) => t === drawing);

describe("who a wheel gesture belongs to", () => {
  it("keeps a pan that wanders off the drawing", () => {
    // The one that hurt: panning carries the cursor across the comment box, the
    // wheel is delivered there instead, and the drawing stops under a hand that
    // is still moving.
    const roll = stream(onDrawing());
    expect(roll(drawing)).toBe(true);
    expect(roll(box)).toBe(true);
    expect(roll(box)).toBe(true);
  });

  it("does not take a scroll that began somewhere else", () => {
    // The same promise read from the other side: a scroll begun over the box
    // goes on scrolling the box once the cursor has left it.
    const roll = stream(onDrawing());
    expect(roll(box)).toBe(false);
    expect(roll(drawing)).toBe(false);
  });

  it("asks again once the wheel has gone quiet", () => {
    const roll = stream(onDrawing());
    expect(roll(box)).toBe(false);
    expect(roll(drawing, SAME_GESTURE + 1)).toBe(true);
  });

  it("treats a pause shorter than the gap as the same gesture", () => {
    // Trackpad momentum arrives in bursts with gaps in them, and calling each
    // burst a new gesture would hand the tail of a flick to whatever the cursor
    // had drifted over.
    const roll = stream(onDrawing());
    expect(roll(drawing)).toBe(true);
    expect(roll(box, SAME_GESTURE - 1)).toBe(true);
  });

  it("claims the first wheel of the session", () => {
    // Counting from zero would mean "at page load", so a reader who scrolls
    // within a quarter second of the drawing appearing would find their first
    // gesture already belonged to nobody.
    const gesture = onDrawing();
    expect(gesture.claims({ timeStamp: 12, target: drawing })).toBe(true);
  });
});
