/**
 * What a key press means, and the arithmetic behind walking the drawing.
 *
 * Nothing here touches a document, a window or the camera. The walk is the part
 * that was wrong in the old renderer and the part worth checking at a desk: it
 * reads as "the next card to the right" and it is really a cost function over
 * every card on the canvas, and a cost function that prefers the wrong card is
 * indistinguishable from a broken key. The module that binds the listener does
 * the reading and the moving, in a few lines with nothing in them to get wrong.
 *
 * It is also why this file is plain TypeScript rather than a rune module. The
 * shared state and the camera are both reactive, and importing either would
 * drag a whole page's worth of runes into a test that wants to ask which card
 * is to the right of which.
 */

/*
 * The table itself is not here. It used to be, and the settings panel used to
 * hold a second copy of it, because the panel has to name every action in order
 * to draw a row per action — two declarations of which key does what, agreeing
 * only because someone had typed them to agree. It now lives in
 * `../shared/bindings.js`, which is neither the canvas nor the chrome and which
 * both may import. Passed straight back out again so that everything acting on
 * a press still has one place to import from: what a press means and where the
 * press takes the reader are one subject to the module that handles them.
 */
export {
  ACTIONS,
  defaults,
  KEYS_KEY,
  readKeys,
  waitFor,
  waitingFor,
  type Action,
  type Store,
} from "../shared/bindings.js";

/**
 * Which action a press means, or nothing.
 *
 * A press carrying a modifier means nothing here whatever it is bound to. The
 * bindings are single keys, so `ctrl+c` matching the comment key would take the
 * copy shortcut away from the whole page — and the reader would find out by
 * pressing it over a card and watching a composer open instead.
 */
export function actionFor(
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  keys: Record<string, string>,
): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  for (const id of Object.keys(keys)) {
    if (keys[id] === event.key) return id;
  }
  return null;
}

/** Anything with a text cursor in it, as much of one as this needs to know. */
export interface Focused {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * Whether the press belongs to something being written in.
 *
 * The old page checked for an input and a textarea, which was enough for the
 * page it was written against. This one has a comment composer, a review
 * summary and a filter box, and the editor in the composer may yet grow a rich
 * field — so a contenteditable counts too. Getting this wrong is not a subtle
 * bug: `c` is bound, and a reviewer typing the word "correct" into a composer
 * would have the second letter open another composer over the one they are
 * using.
 */
export function typing(target: Focused | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A card as the walk needs it: an id and a rectangle in the drawing's units. */
export interface Spot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the reader can see, in the drawing's units. */
export interface Window {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The card the reader is looking at.
 *
 * Taken from the middle of the view rather than from anything clicked: the
 * keyboard has no cursor, and after arriving somewhere the file being read is
 * whatever the view was moved to. A card covering the centre wins outright.
 *
 * Failing that, the nearest one to the centre — which is where this parts
 * company with the map's highlight, deliberately. The map is answering "where
 * am I", and guessing at a neighbour would make its mark jump about as the
 * reader pans across open canvas. The walk is answering "where do I go from
 * here", and a reader parked in the gap between two files still means to press
 * an arrow key. The guess is never stored: the step that follows moves the
 * camera onto a real card, and from that moment both questions have the same
 * answer again.
 */
export function cardAt(cards: readonly Spot[], x: number, y: number): Spot | null {
  let best: Spot | null = null;
  let nearest = Infinity;

  for (const card of cards) {
    if (x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height) {
      return card;
    }
    const dx = Math.max(card.x - x, 0, x - (card.x + card.width));
    const dy = Math.max(card.y - y, 0, y - (card.y + card.height));
    const distance = Math.hypot(dx, dy);
    if (distance < nearest) {
      nearest = distance;
      best = card;
    }
  }

  return best;
}

/**
 * The nearest card in one direction, or nothing if the drawing ends there.
 *
 * Geometry rather than list order, because the reader is pressing the key at a
 * picture: the card to the right of this one is the one drawn to the right of
 * it, and the next entry in the model's array is wherever the layout engine
 * happened to put it. Walking the array meant a right arrow that jumped
 * backwards across the canvas as often as not.
 *
 * Distance to the side of the direction asked for counts double against
 * distance along it, so pressing right takes the next file to the right rather
 * than one slightly right and a long way down.
 */
export function stepFrom(
  from: Spot,
  cards: readonly Spot[],
  dx: number,
  dy: number,
): Spot | null {
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;

  let best: Spot | null = null;
  let score = Infinity;

  for (const card of cards) {
    if (card.id === from.id) continue;
    const toX = card.x + card.width / 2;
    const toY = card.y + card.height / 2;

    const along = (toX - fromX) * dx + (toY - fromY) * dy;
    // Behind, or level with, the card being left. A step has to go somewhere.
    if (along <= 0) continue;

    const aside = Math.abs((toX - fromX) * dy) + Math.abs((toY - fromY) * dx);
    const cost = along + aside * 2;
    if (cost < score) {
      score = cost;
      best = card;
    }
  }

  return best;
}

/** Which way each of the four walking keys goes. */
export const HEADINGS: Record<string, { dx: number; dy: number }> = {
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
};

/**
 * Where to send the camera so that a card is the card the reader is on.
 *
 * Two things have to come out of one number here, and they pull in opposite
 * directions.
 *
 * The first is the map. Its highlight is worked out from the geometric middle
 * of the viewport — not from anything this sets — so a walk that failed to put
 * the destination under that point would move the drawing while the map went on
 * insisting the reader was where they started. So the point returned is aimed
 * at the middle, offset by half the chrome's height: the camera lands what it
 * is given in the middle of the *visible* canvas, which is lower than the
 * middle of the element by exactly that much.
 *
 * The second is the file. A file is read from its first line down, and a tall
 * card centred on its middle opens halfway through itself with its beginning
 * above the bar — which is what the old renderer's `showFromTop` existed to
 * avoid. So a card taller than the view is aimed at its top instead, landing
 * just under the chrome.
 *
 * The two meet exactly. Where the card is short enough to be centred, centring
 * it leaves its top below the bar; where it is tall enough to be pinned to the
 * top, the middle of the viewport still falls inside it. There is no card for
 * which one rule can be satisfied and the other cannot.
 */
export function aimFor(
  card: Spot,
  win: Window,
  chrome: number,
  scale: number,
): { x: number; y: number } {
  // Everything below is in the drawing's units; the chrome is measured in
  // screen pixels, which is a different thing at every zoom but one.
  const half = win.height / 2;
  const lid = (chrome + 16) / scale;

  const middle = card.y + card.height / 2;
  const fromTop = card.y + half - lid;

  return {
    x: card.x + card.width / 2,
    y: Math.min(middle, fromTop) + chrome / (2 * scale),
  };
}
