import { describe, expect, it } from "vitest";

import { markSize, reachOf, SEEN_SIZE, seenSize } from "../src/app/marks/marks.js";
import {
  besideFile,
  EDGE,
  GAP,
  leftOf,
  NARROWEST,
  roomFor,
  topOf,
  WIDEST,
  widthOf,
} from "../src/app/panels/thread.js";

/**
 * Being taken to a remark from the list of threads.
 *
 * The flight itself needs a browser; what it is made of is arithmetic, and this
 * is the part of it that has to hold. A conversation is a fixed box over the
 * canvas and the line it quotes is under that canvas, so the two are in a fight
 * for the same pixels unless the camera settles it before either is drawn. The
 * whole design is one sum: the file is stood far enough to the right that
 * everything to its left — the window's margin, the box, the gap, the mark —
 * fits in the space that leaves.
 *
 * Every rectangle below is in screen coordinates, which is where the fight is.
 * The canvas is scaled and the panel is not, so a card's own units are no help
 * in answering whether a box covers a line.
 */

/** The reader's window, and the bar across the top of it. */
const VIEWPORT = { width: 1728, height: 857 };
const CHROME = 80;

/** The zoom a remark is arrived at: full size, where prose is prose. */
const SCALE = 1;

/** Where the camera puts what it was sent to: the middle of the *visible* canvas. */
function middleOf(y: number, scale: number): number {
  return CHROME + (VIEWPORT.height - CHROME) / 2 - y * scale;
}

interface Card {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The three rectangles the reader ends up looking at, after a flight to a line.
 *
 * Assembled here the way the running page assembles them — the camera lands the
 * drawing, the marks place a face beside the row, and the box hangs off the mark
 * — so that a change to any one of the three shows up as an overlap rather than
 * as three tests that each still pass on their own.
 */
function landing(card: Card, row: number, viewport = VIEWPORT.width) {
  const x = besideFile(card, viewport, SCALE);
  const y = middleOf(card.y + row, SCALE);

  const size = markSize(SCALE);
  const file = {
    left: x + card.x * SCALE,
    right: x + (card.x + card.width) * SCALE,
    top: y + card.y * SCALE,
  };
  const line = {
    left: file.left,
    right: file.right,
    top: y + (card.y + row) * SCALE - 9,
    bottom: y + (card.y + row) * SCALE + 9,
  };
  const mark = {
    left: file.left - size - reachOf(size),
    top: (line.top + line.bottom) / 2 - size / 2,
    size,
  };

  const width = widthOf(mark.left);
  const panel = {
    left: leftOf(mark.left, width),
    right: leftOf(mark.left, width) + width,
    top: topOf(mark.top, 420, CHROME + EDGE, VIEWPORT.height),
  };

  return { file, line, mark, panel, width };
}

describe("making room for a conversation before it opens", () => {
  it("counts everything that has to fit to the left of the file", () => {
    // The window's margin, the widest the box gets, the gap after it, the mark
    // with the room its pointer needs, and air between the two. A remark landed
    // at full size, so this is the number that matters.
    expect(roomFor(1)).toBe(EDGE + WIDEST + GAP + 28 + reachOf(28) + 40);
    expect(roomFor(1)).toBe(535);
  });

  it("leaves the file centred when centring already leaves the room", () => {
    // A narrow card in a wide window: the middle of the screen is further right
    // than the conversation needs, and pushing it further would be moving the
    // reader's file for no reason.
    const card = { x: 4000, y: 0, width: 400, height: 600 };
    expect(besideFile(card, VIEWPORT.width, SCALE) + card.x).toBe(
      VIEWPORT.width / 2 - card.width / 2,
    );
  });

  it("pushes a file that centring would leave over the conversation", () => {
    // A wide card centred has its left edge at 264, which is inside the box.
    // The rule is the further right of the two, so the file is parked at the
    // room the box wants instead.
    const card = { x: 4000, y: 0, width: 1200, height: 600 };
    const centred = VIEWPORT.width / 2 - card.width / 2;
    expect(centred).toBeLessThan(roomFor(SCALE));
    expect(besideFile(card, VIEWPORT.width, SCALE) + card.x).toBe(roomFor(SCALE));
  });

  it("will not push the code out of the window to make the room", () => {
    // On a window too narrow for both, the file keeps its foothold on the right
    // and the box gives way — a conversation with nothing on screen to be about
    // is worse than a narrow one.
    const card = { x: 0, y: 0, width: 1200, height: 600 };
    const narrow = 700;
    expect(besideFile(card, narrow, SCALE)).toBe(narrow - 260);
  });
});

describe("where the reader is left standing", () => {
  const card = { x: 6000, y: 4000, width: 400, height: 3000 };

  it("puts the line on screen and the box beside it, not over it", () => {
    const { line, panel, file } = landing(card, 1500);

    // The commented row is on the screen and clear of the bar.
    expect(line.top).toBeGreaterThan(CHROME);
    expect(line.bottom).toBeLessThan(VIEWPORT.height);
    // And the box that discusses it is entirely to its left.
    expect(panel.right).toBeLessThan(line.left);
    expect(panel.left).toBeGreaterThanOrEqual(EDGE);
    // With the mark between the two, pointing from one at the other.
    expect(file.left - panel.right).toBeGreaterThan(markSize(SCALE));
  });

  it("keeps the box off the code however wide the window is", () => {
    // The box shrinks into whatever room is left rather than climbing onto the
    // file, so the clearance survives windows the room was never meant for.
    for (const width of [2560, 1728, 1280, 1024, 900, 800, 700]) {
      const { line, panel } = landing(card, 1500, width);
      expect(panel.right).toBeLessThan(line.left);
      expect(panel.right - panel.left).toBeGreaterThanOrEqual(NARROWEST);
    }
  });

  it("hangs the box off the mark and never in the chrome", () => {
    // A line near the top of the window would put a long conversation behind
    // the bar; it is held under it instead.
    expect(topOf(10, 420, CHROME + EDGE, VIEWPORT.height)).toBe(CHROME + EDGE);
    // And one near the bottom is lifted rather than run off the screen.
    expect(topOf(800, 420, CHROME + EDGE, VIEWPORT.height)).toBe(
      VIEWPORT.height - 420 - EDGE,
    );
  });
});

/**
 * A conversation on a file the reader has finished with.
 *
 * Still on the drawing — where a file was discussed is worth knowing, and going
 * back to one is a thing people do — but standing back from the ones still
 * waiting. At the zoom a whole change is taken in at there are more faces than
 * files, and every one of them was drawn at full strength whether it wanted an
 * answer or not.
 */
describe("a mark on a file already read", () => {
  it("is drawn smaller than one still waiting", () => {
    expect(seenSize(60, true)).toBeLessThan(seenSize(60, false));
    expect(seenSize(60, true)).toBe(Math.round(60 * SEEN_SIZE));
  });

  it("leaves an unread one exactly as it was", () => {
    expect(seenSize(markSize(2), false)).toBe(markSize(2));
  });

  it("never shrinks below something a reader can press", () => {
    // The mark is a target as well as a picture. A conversation that cannot be
    // reopened is worse than one drawn too large.
    expect(seenSize(markSize(0.1), true)).toBeGreaterThanOrEqual(18);
    expect(seenSize(4, true)).toBeGreaterThanOrEqual(18);
  });

  it("shrinks rather than vanishing", () => {
    // Vanishing is what hiding read files is for, and that takes the card too.
    expect(SEEN_SIZE).toBeGreaterThan(0.4);
    expect(SEEN_SIZE).toBeLessThan(1);
  });
});
