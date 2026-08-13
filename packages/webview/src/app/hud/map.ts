import type { NodeView } from "../model.js";

/** The map is a square, whatever shape the change is. */
export const MAP_SIZE = 150;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How the drawing was folded into the square, so a point can be unfolded again. */
export interface MapFit {
  x: number;
  y: number;
  scale: number;
  padX: number;
  padY: number;
}

/** What the reader can see, in the drawing's own units. */
export interface Window {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The smallest box holding every card still on the canvas.
 *
 * Cards the reader has filtered away are left out rather than counted as
 * empty space: a map framed on hidden files is mostly margin, and the shape it
 * draws is of a change that is not on screen.
 */
export function bounds(nodes: readonly NodeView[], fallback: Box): Box {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const node of nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }

  if (left === Infinity) return fallback;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The part of that the bar across the top is not sitting on.
 *
 * The camera measures the viewport, which runs the full height of the page and
 * has the chrome laid over its first eighty pixels. Everything the map does
 * with the window is therefore wrong by that strip: the frame claimed a band of
 * the drawing the reader cannot see, the neighbourhood was centred a little
 * above where they are looking, and a press on the map landed the point under
 * the bar rather than in the middle of the picture. Taken off once, here, so
 * the three cannot drift apart.
 *
 * How tall the bar is has to come from whoever can see the page — it stacks and
 * wraps with how much it has to say — and nothing is taken off when the answer
 * is nought, which is what a page rendered in Node with no document reports.
 */
export function uncovered(window: Window, covered: number): Window {
  const hidden = Math.min(Math.max(covered, 0), window.height);
  return {
    left: window.left,
    top: window.top + hidden,
    width: window.width,
    height: window.height - hidden,
  };
}

/**
 * What the map should be a map of.
 *
 * The whole change while the reader can see most of it, and a window around
 * them once they cannot. Zoomed into one file, a map of everything draws the
 * view as a speck: true, and no use for the question being asked of it — which
 * is what is next to me. The window is three times what is on screen, so the
 * frame stays a third of the map and the neighbours are the rest.
 */
export function region(all: Box, window: Window): Box {
  if (!all.width || !all.height) return all;

  const want = Math.max(window.width, window.height) * 3;
  if (want >= Math.max(all.width, all.height)) return all;

  // Centred on the view, then pushed back inside the drawing so the map is
  // never mostly empty at an edge.
  const midX = window.left + window.width / 2;
  const midY = window.top + window.height / 2;

  // A square window, so the square map is not letterboxed while zoomed in.
  // Each axis is held inside the drawing on its own: a change is often far
  // taller than it is wide, and the window can fit across it while being a
  // slice of it downwards.
  const width = Math.min(want, all.width);
  const height = Math.min(want, all.height);

  return {
    x: Math.min(Math.max(midX - width / 2, all.x), all.x + all.width - width),
    y: Math.min(Math.max(midY - height / 2, all.y), all.y + all.height - height),
    width,
    height,
  };
}

/**
 * How that region folds into the square.
 *
 * Centred rather than pinned to a corner, so a tall change is a ribbon down
 * the middle of the map instead of a ribbon against one edge.
 */
export function fitMap(box: Box): MapFit {
  const scale = Math.min(MAP_SIZE / box.width, MAP_SIZE / box.height);
  return {
    x: box.x,
    y: box.y,
    scale,
    padX: (MAP_SIZE - box.width * scale) / 2,
    padY: (MAP_SIZE - box.height * scale) / 2,
  };
}

/**
 * A card's rectangle in the map's units.
 *
 * Left as fractions. The whole map is a hundred and fifty pixels across, so
 * rounding a card to whole ones moved it by up to half a pixel — a quarter of
 * the gap between neighbouring cards at the scales this draws at, and in a
 * direction that depended on where in the square the card happened to fall.
 * The same two files then sat at different distances apart depending on how the
 * drawing was framed, which is the one thing a map may not do: it is read to
 * judge where things are, and a reader cannot tell a crowded corner from a
 * rounding error. The browser is left to deal with the fraction.
 */
export function placeNode(node: NodeView, fit: MapFit): Box {
  const drawn = { width: node.width * fit.scale, height: node.height * fit.scale };

  // At this size a card is a few pixels; a file that rounds away is a file the
  // reader cannot see is there.
  const width = Math.max(2, drawn.width);
  const height = Math.max(2, drawn.height);

  return {
    // Grown from the middle. Taken from the corner, the floor moved every card
    // small enough to need it down and to the right — by most of its own size
    // at the scales where it applies, which is a card's worth of displacement
    // handed to exactly the files that are hardest to make out.
    x: fit.padX + (node.x - fit.x) * fit.scale - (width - drawn.width) / 2,
    y: fit.padY + (node.y - fit.y) * fit.scale - (height - drawn.height) / 2,
    width,
    height,
  };
}

/**
 * The frame showing what is on screen, in the map's units.
 *
 * Held inside the square, and never smaller than something worth aiming at:
 * zoomed into one file the window is a fraction of a pixel of the drawing, and
 * a frame drawn to scale disappears exactly when the reader most needs to know
 * where they are.
 */
export function placeWindow(window: Window, fit: MapFit): Box {
  const FLOOR = 10;

  let x = fit.padX + (window.left - fit.x) * fit.scale;
  let y = fit.padY + (window.top - fit.y) * fit.scale;
  let right = x + window.width * fit.scale;
  let bottom = y + window.height * fit.scale;

  x = Math.max(0, Math.min(x, MAP_SIZE - FLOOR));
  y = Math.max(0, Math.min(y, MAP_SIZE - FLOOR));
  right = Math.min(MAP_SIZE, Math.max(right, x + FLOOR));
  bottom = Math.min(MAP_SIZE, Math.max(bottom, y + FLOOR));

  // Unrounded, for the same reason the cards are: a frame snapped to whole map
  // pixels and cards that are not sit a fraction apart, and the frame is read
  // against those cards to say which of them is on screen.
  return { x, y, width: right - x, height: bottom - y };
}

/** Where a press on the map lands, in the drawing's units. */
export function pointAt(offsetX: number, offsetY: number, fit: MapFit): { x: number; y: number } {
  return {
    x: fit.x + (offsetX - fit.padX) / fit.scale,
    y: fit.y + (offsetY - fit.padY) / fit.scale,
  };
}
