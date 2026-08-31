import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  actionFor,
  aimFor,
  cardAt,
  readKeys,
  stepFrom,
  typing,
  type Spot,
  type Store,
} from "../src/app/canvas/keys.js";

const spot = (id: string, x: number, y: number, width = 100, height = 100): Spot => ({
  id,
  x,
  y,
  width,
  height,
});

const held = (value: string | null): Store => ({ getItem: () => value });

describe("the bindings", () => {
  it("answers with the defaults when nothing has been chosen", () => {
    const keys = readKeys(null);
    expect(keys.fit).toBe("h");
    expect(keys.right).toBe("ArrowRight");
  });

  it("takes the reader's own choice over the default", () => {
    const keys = readKeys(held(JSON.stringify({ fit: "z" })));
    expect(keys.fit).toBe("z");
    // Untouched actions keep theirs rather than disappearing with the file.
    expect(keys.comment).toBe("c");
  });

  it("ignores anything in the file that is not a binding", () => {
    // The file is on a disk a reviewer can edit. An action bound to a number is
    // a handler comparing a string to a number for the rest of the session, and
    // an action nobody has heard of is a key that does nothing and cannot be
    // rebound.
    const keys = readKeys(held(JSON.stringify({ fit: 7, launch: "L" })));
    expect(keys.fit).toBe("h");
    expect(keys.launch).toBeUndefined();
  });

  it("treats an unreadable file as no file", () => {
    expect(readKeys(held("{not json"))).toEqual(readKeys(null));
  });

  it("finds the action a press means", () => {
    const keys = readKeys(null);
    expect(actionFor({ key: "h" }, keys)).toBe("fit");
    expect(actionFor({ key: "q" }, keys)).toBeNull();
  });

  it("refuses a press carrying a modifier", () => {
    // `c` is the comment key, so a plain match would take the copy shortcut away
    // from the whole page and open a composer instead.
    const keys = readKeys(null);
    expect(actionFor({ key: "c", metaKey: true }, keys)).toBeNull();
    expect(actionFor({ key: "c", ctrlKey: true }, keys)).toBeNull();
    expect(actionFor({ key: "c" }, keys)).toBe("comment");
  });
});

describe("a press that belongs to the text", () => {
  it("leaves every kind of writing box alone", () => {
    expect(typing({ tagName: "INPUT" })).toBe(true);
    expect(typing({ tagName: "TEXTAREA" })).toBe(true);
    expect(typing({ tagName: "SELECT" })).toBe(true);
    expect(typing({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not mistake the drawing for one", () => {
    expect(typing({ tagName: "DIV" })).toBe(false);
    expect(typing({ tagName: "BUTTON" })).toBe(false);
    expect(typing(null)).toBe(false);
  });
});

describe("the card the reader is on", () => {
  const cards = [spot("a", 0, 0), spot("b", 400, 0), spot("c", 0, 400)];

  it("is the one under the middle of the view", () => {
    expect(cardAt(cards, 50, 50)?.id).toBe("a");
    expect(cardAt(cards, 450, 20)?.id).toBe("b");
  });

  it("is the nearest one when the view is parked between files", () => {
    // The walk still has to start somewhere. The map deliberately marks nothing
    // here; this is a different question with a different right answer.
    expect(cardAt(cards, 380, 50)?.id).toBe("b");
    expect(cardAt(cards, 220, 50)?.id).toBe("a");
  });

  it("is nothing at all when there are no cards", () => {
    expect(cardAt([], 0, 0)).toBeNull();
  });
});

describe("walking between cards", () => {
  it("goes to the card drawn in that direction", () => {
    const cards = [spot("a", 0, 0), spot("b", 400, 0), spot("c", 0, 400)];
    expect(stepFrom(cards[0]!, cards, 1, 0)?.id).toBe("b");
    expect(stepFrom(cards[0]!, cards, 0, 1)?.id).toBe("c");
    expect(stepFrom(cards[1]!, cards, -1, 0)?.id).toBe("a");
    expect(stepFrom(cards[2]!, cards, 0, -1)?.id).toBe("a");
  });

  it("prefers the file beside it to one slightly across and a long way off", () => {
    // The failure this guards against: pressing right and being flown to the
    // bottom of the change because that card happened to be four pixels to the
    // right of this one.
    const near = spot("near", 400, 0);
    const far = spot("far", 404, 3000);
    const cards = [spot("here", 0, 0), near, far];
    expect(stepFrom(cards[0]!, cards, 1, 0)?.id).toBe("near");
  });

  it("ignores geometry rather than list order", () => {
    // The card to the right is the one drawn to the right, not the next entry
    // in the model's array — which is where the old walk went wrong.
    const cards = [spot("first", 900, 0), spot("second", 300, 0), spot("third", 600, 0)];
    expect(stepFrom(cards[1]!, cards, 1, 0)?.id).toBe("third");
    expect(stepFrom(cards[2]!, cards, 1, 0)?.id).toBe("first");
  });

  it("stops at the edge of the drawing", () => {
    const cards = [spot("a", 0, 0), spot("b", 400, 0)];
    expect(stepFrom(cards[1]!, cards, 1, 0)).toBeNull();
  });

  it("never steps onto the card it is leaving", () => {
    const cards = [spot("only", 0, 0)];
    expect(stepFrom(cards[0]!, cards, 1, 0)).toBeNull();
  });

  it("counts a card level with this one as nowhere to go", () => {
    // Directly below and asked for right: its centre is no further right than
    // this one's, so there is nothing to the right and the drawing ends here.
    const cards = [spot("a", 0, 0), spot("under", 0, 400)];
    expect(stepFrom(cards[0]!, cards, 1, 0)).toBeNull();
  });
});

describe("where the camera is sent", () => {
  // A viewport 1000 wide and 800 tall at full size, with a 60px bar over it.
  const win = { left: 0, top: 0, width: 1000, height: 800 };

  /**
   * What the map will call the middle once the camera has arrived. The camera
   * lands the point it is given in the middle of the *visible* canvas, which is
   * half the bar's height below the middle of the element the map measures.
   */
  const marked = (aim: { x: number; y: number }, chrome: number, scale: number) => ({
    x: aim.x,
    y: aim.y - chrome / (2 * scale),
  });

  it("centres a card small enough to be centred", () => {
    const card = spot("a", 100, 100, 200, 200);
    expect(marked(aimFor(card, win, 60, 1), 60, 1)).toEqual({ x: 200, y: 200 });
  });

  it("opens a tall file at its top rather than half way down it", () => {
    // A file is read from its first line, and centring a card three screens
    // tall opens it in the middle of itself with its beginning above the bar.
    const card = spot("tall", 0, 1000, 200, 3000);
    const aim = aimFor(card, win, 60, 1);
    const centre = marked(aim, 60, 1);
    // The top of the card lands just under the bar.
    const topOnScreen = win.height / 2 - (centre.y - card.y);
    expect(topOnScreen).toBeCloseTo(76);
  });

  it("puts the destination under the middle either way, so the map follows", () => {
    // The one thing that must hold for every card: if the point the map reads
    // is not inside the card, the drawing moves and the highlight does not.
    const cards = [
      spot("small", 0, 0, 50, 40),
      spot("wide", -300, 500, 2000, 120),
      spot("tall", 0, 1000, 200, 3000),
      spot("huge", 0, 5000, 4000, 9000),
    ];
    for (const scale of [1, 0.5, 0.12]) {
      for (const card of cards) {
        const room = { left: 0, top: 0, width: 1000 / scale, height: 800 / scale };
        const centre = marked(aimFor(card, room, 60, scale), 60, scale);
        expect(centre.x).toBeGreaterThanOrEqual(card.x);
        expect(centre.x).toBeLessThanOrEqual(card.x + card.width);
        expect(centre.y).toBeGreaterThanOrEqual(card.y);
        expect(centre.y).toBeLessThanOrEqual(card.y + card.height);
      }
    }
  });

  it("never leaves the top of a card behind the bar", () => {
    for (const scale of [1, 0.5, 0.12]) {
      const room = { left: 0, top: 0, width: 1000 / scale, height: 800 / scale };
      for (const height of [40, 300, 1600, 9000]) {
        const card = spot("c", 0, 0, 200, height);
        const centre = marked(aimFor(card, room, 60, scale), 60, scale);
        const topOnScreen = 800 / 2 - (centre.y - card.y) * scale;
        expect(topOnScreen).toBeGreaterThanOrEqual(60);
      }
    }
  });
});

/**
 * What the wheel does over the drawing.
 *
 * A drawing and a document want opposite things from it: scrolling down a page
 * means "further on", scrolling down a map means nothing at all — what a reader
 * of a map wants is nearer or further away. A canvas that panned on the wheel
 * spent its time being scrolled off the edge of itself and back.
 */
describe("the wheel over the canvas", () => {
  const camera = readFileSync(
    new URL("../src/app/canvas/camera.svelte.ts", import.meta.url),
    "utf8",
  );
  const wheel = camera.slice(
    camera.indexOf("export function wheel("),
    camera.indexOf("/* ------", camera.indexOf("export function wheel(")),
  );

  it("zooms, rather than panning down the page", () => {
    // No plain-wheel branch that moves the view: whatever is not a shift is a
    // zoom, pinch included.
    expect(wheel).not.toMatch(/view\.y -= event\.deltaY/);
    expect(wheel).toMatch(/view\.scale \* Math\.exp\(-event\.deltaY \/ rate\)/);
  });

  it("keeps what is under the cursor under the cursor", () => {
    expect(wheel).toMatch(/view\.x = px - \(px - view\.x\) \* \(next \/ view\.scale\)/);
  });

  it("still pans across for a mouse that cannot drag", () => {
    expect(wheel).toMatch(/event\.shiftKey[\s\S]{0,400}?view\.x -= event\.deltaX \|\| event\.deltaY/);
  });

  it("takes a notch more gently than a pinch", () => {
    // A pinch arrives as a stream of small deltas; a wheel arrives as one notch
    // of a hundred, and at the pinch's rate that is a third of the picture per
    // click.
    expect(wheel).toMatch(/event\.ctrlKey \|\| event\.metaKey \? 320 : 520/);
  });
});
