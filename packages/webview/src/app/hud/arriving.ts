import { announce } from "./boot.svelte.js";

/**
 * Says that this element has become ready, and where on the screen it is.
 *
 * Put on the thing itself rather than announced from wherever it was created,
 * because "ready" means "in the document at its own size" and the element is
 * the only thing that knows that. It measures once, on the way in.
 *
 * A no-op when nothing is being watched, which is the usual case: a card
 * mounted after a save announces exactly as it did during the first build and
 * lands on the spot, because there is no sequence for it to join.
 */
export function arriving(
  element: HTMLElement,
  what: { id: string; kind: "node" | "tab"; tone: string },
) {
  const say = (one: { id: string; kind: "node" | "tab"; tone: string }) => {
    const box = element.getBoundingClientRect();
    // A thing with no size is a thing that is not really here yet — a card in
    // a collapsed part, a tab being replaced. Announcing it would fly a square
    // to a point and deliver nothing.
    if (box.width < 1 || box.height < 1) return;
    announce({
      id: one.id,
      kind: one.kind,
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      tone: one.tone,
    });
  };

  say(what);

  return {
    update(next: { id: string; kind: "node" | "tab"; tone: string }) {
      // The same slot holding a different file is a different arrival. The
      // same file that has merely moved is not: it already arrived.
      if (next.id !== what.id) say(next);
      what = next;
    },
  };
}
