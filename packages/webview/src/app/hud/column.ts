/**
 * How a column of agent consoles divides the room it has.
 *
 * Two agents working at once is the ordinary case — one reading, one writing —
 * and the column they share is whatever the panels above it have left. Divided
 * badly, that is a log with a paragraph in it and a log with eleven pixels: the
 * second agent present, unreadable, and easy to mistake for a rendering fault.
 *
 * So it is divided in two steps. How many can be open at once without any of
 * them being a sliver, and how tall each of those may be — the second is the
 * half that was missing at first, and without it nothing stopped the topmost
 * console from taking the height its own log wanted and leaving the rest with
 * what remained.
 */

export interface Share {
  /** How many of them are open, counting from the top. */
  showing: number;
  /** The tallest each open one may be. */
  each: number;
}

export interface Room {
  /** Nothing worth calling a log. Below this a console is folded instead. */
  least: number;
  /** What a folded console costs: its bar, and nothing else. */
  bar: number;
  /** The gap the column leaves between one console and the next. */
  between: number;
}

/**
 * The column, divided.
 *
 * The first console stays open whatever happens: a column of nothing but bars
 * is a page with no log on it, which is not what anybody opened. Everything
 * below it folds until what is left divides into readable heights.
 */
export function shareOut(room: number, consoles: number, sizes: Room): Share {
  if (consoles <= 0) return { showing: 0, each: 0 };

  const gaps = Math.max(0, consoles - 1) * sizes.between;
  let showing = consoles;
  while (showing > 1) {
    const each = (room - gaps - (consoles - showing) * sizes.bar) / showing;
    if (each >= sizes.least) break;
    showing -= 1;
  }

  const each = Math.floor((room - gaps - (consoles - showing) * sizes.bar) / showing);
  // Never below the floor, even when the window is too short for one: a console
  // shorter than this is the thing being avoided, and a window that small has
  // the scrolling column to fall back on.
  return { showing, each: Math.max(sizes.least, each) };
}
