import { besideFile } from "../panels/thread.js";
import {
  held,
  host,
  keep,
  model,
  notify,
  rebuilding,
  settings,
  ui,
  view,
} from "../state.svelte.js";
import { aimFor, type Spot } from "./keys.js";
import { heightOf, lineAt } from "./measured.svelte.js";
import { pinHere, pinnedHere } from "./pins.js";
import { place, type Layout, type Placed } from "./placement.js";
import { arrangementFor, arrows, pathOf, type Box, type Reading } from "./wire.js";

// Re-exported because the canvas asks this module where its cards are and has
// no reason to know the arithmetic moved house.
export type { Placed } from "./placement.js";

/**
 * Where the reader has the drawing, and everything that moves it.
 *
 * A module rather than something the canvas owns, because the camera is moved
 * from all over the page — the minimap drags it, a tab refits it, a mark flies
 * to it, the host asks for it back after a rebuild — and none of those are
 * inside the canvas. The numbers themselves live in the shared view state; what
 * is here is the arithmetic and the two timers that decide when a gesture is
 * over.
 */

/**
 * Low enough that a part of a large change fits on screen. A tall card is
 * thousands of pixels; a floor of 0.15 meant "fit" still left most of a part
 * below the fold, which is the one thing fit is for.
 */
export const MIN_SCALE = 0.04;
export const MAX_SCALE = 3;

/**
 * Sharpness while zoomed.
 *
 * The canvas is a single transformed layer, and a promoted layer is drawn once
 * at the scale it was promoted at and then stretched — which is why zoomed-in
 * code looked like an enlarged screenshot rather than larger text. Promotion is
 * only worth having while the view is in motion, so it is taken for the gesture
 * and handed back once the view has settled; the browser then redraws the
 * glyphs and the edge geometry at the scale actually on screen.
 *
 * `panning` is separate because it is only the cursor: a wheel gesture moves
 * the view without anybody holding it.
 */
export const motion = $state({ moving: false, panning: false, flying: false, flight: 420 });

let settle = 0;

/**
 * Takes the layer for the duration of a gesture.
 *
 * `hold` exists for the flights: an animated move is still in motion after the
 * numbers have stopped changing, and handing the layer back mid-animation makes
 * the browser repaint every remaining frame of it.
 */
export function apply(hold = 140): void {
  view.placed = true;
  motion.moving = true;
  window.clearTimeout(settle);
  settle = window.setTimeout(rest, hold);
}

/**
 * The end of a gesture.
 *
 * The translation is landed on whole device pixels here. Half a pixel of offset
 * costs nothing in position and a visible amount in crispness, because every
 * glyph edge in the picture is then straddling two pixels instead of filling
 * one.
 */
export function rest(): void {
  const dpr = window.devicePixelRatio || 1;
  view.x = Math.round(view.x * dpr) / dpr;
  view.y = Math.round(view.y * dpr) / dpr;
  motion.moving = false;
  // The same moment is when the camera is worth writing down: once per gesture
  // rather than once per frame of one.
  rememberCamera();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* ------------------------------------------------------------ pan & zoom */

let origin: { x: number; y: number } | null = null;

/**
 * Anything the reader can act on is not the drawing they drag.
 *
 * Capturing the pointer here would redirect the rest of the gesture to the
 * viewport, and the click would never reach the mark at all — which is why the
 * threads stopped opening.
 */
const HANDLES = ".card, .card-slot, path.hit, .mark, .port";

export function beginPan(event: PointerEvent, viewport: HTMLElement): void {
  const target = event.target as Element | null;
  if (target?.closest(HANDLES)) return;
  // The reader is moving the drawing themselves, so wherever they were is no
  // longer where they want to be. A rebuild landing mid-gesture must not take
  // the view back off them.
  letGo();
  origin = { x: event.clientX - view.x, y: event.clientY - view.y };
  motion.panning = true;
  viewport.setPointerCapture(event.pointerId);
}

export function dragPan(event: PointerEvent): void {
  if (!origin) return;
  view.x = event.clientX - origin.x;
  view.y = event.clientY - origin.y;
  apply();
}

export function endPan(event: PointerEvent, viewport: HTMLElement): void {
  origin = null;
  motion.panning = false;
  // Releasing a capture nobody took throws, and pointercancel arrives for
  // gestures the browser took back before this ever saw them.
  try {
    viewport.releasePointerCapture(event.pointerId);
  } catch {
    /* nothing was captured */
  }
}

/**
 * Whether this is a machine whose pointing device already zooms.
 *
 * Asked of the platform rather than of the event, because there is no honest
 * way to ask the event: a trackpad and a wheel arrive as the same kind of
 * message, and the folklore for telling them apart — fractional deltas,
 * multiples of a hundred and twenty — is wrong often enough to be worse than
 * choosing by platform, where it is right nearly always.
 *
 * Answered once. The hardware does not change under a window, and a page
 * rendered where there is no navigator at all is a page nobody is scrolling.
 */
let apple: boolean | undefined;

function onApple(): boolean {
  if (apple === undefined) {
    const said =
      typeof navigator === "undefined"
        ? ""
        : `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
    apple = /Mac|iPad|iPhone|iPod/.test(said);
  }
  return apple;
}

export function wheel(event: WheelEvent, viewport: HTMLElement): void {
  event.preventDefault();
  letGo();

  /*
   * What a wheel means, which depends on what is under the hand.
   *
   * On a Mac the gesture is almost always a trackpad, and a trackpad already
   * has both: two fingers pan in any direction and a pinch zooms. Taking the
   * pan away there to make the wheel zoom would be removing the better of the
   * two gestures to imitate the worse one.
   *
   * Everywhere else it is almost always a mouse, which has one wheel and no
   * pinch — and this is a drawing rather than a document, so scrolling down it
   * means nothing: what a reader of a map wants is nearer or further away. A
   * canvas that panned there spent its time being scrolled off the edge of
   * itself and back, with the only way to zoom being a modifier nobody guesses.
   *
   * Either way a pinch zooms and a drag pans, so nothing that already worked
   * stops working.
   */
  const pinching = event.ctrlKey || event.metaKey;
  if (!pinching && (onApple() || event.shiftKey)) {
    // Shift is the mouse's way across on the platforms where the wheel zooms:
    // one wheel, and whichever axis it reports is the one it has.
    if (event.shiftKey) view.x -= event.deltaX || event.deltaY;
    else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
    }
    apply();
    return;
  }

  const rect = viewport.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  /*
   * How far one turn of the wheel goes.
   *
   * A pinch arrives as a stream of small deltas and reads as continuous at any
   * rate; a mouse wheel arrives as one notch of a hundred, and at the pinch's
   * rate that is a third of the picture per click — enough to lose your place
   * on every one. The notch is given a gentler constant so a click is about a
   * fifth, which is a step you can walk back.
   */
  const rate = pinching ? 320 : 520;
  const next = clamp(
    view.scale * Math.exp(-event.deltaY / rate),
    MIN_SCALE,
    MAX_SCALE,
  );

  // Keep whatever is under the cursor under the cursor.
  view.x = px - (px - view.x) * (next / view.scale);
  view.y = py - (py - view.y) * (next / view.scale);
  view.scale = next;
  apply();
}

/* ----------------------------------------------------------- positioning */

/**
 * How the reader has the drawing set up, in the shape the pure layer asks for.
 *
 * Which of the four arrangements is in force is decided by `wire.ts` and by
 * nothing here. The cards and the arrows have to agree about that, and this
 * module used to answer it a second time in its own words: two functions, the
 * same three lines, and a way for the drawing to move the cards without moving
 * what points at them.
 */
function reading(): Reading {
  return {
    unified: settings.unified,
    showTests: settings.showTests,
    showImports: settings.showImports,
    showUnchanged: settings.showUnchanged,
    showInfra: settings.showInfra,
    hideViewed: settings.hideViewed,
    part: ui.part,
    viewed: ui.viewed,
  };
}

/** The drawing as it stands, for the reading the page is currently in. */
function laid(): Layout {
  const data = model.current;
  const part = ui.part ? data.parts.find((p) => p.id === ui.part) : null;
  return place(data, arrangementFor(data, reading()), {
    inPart: part ? new Set(part.nodes) : null,
    showInfra: settings.showInfra,
    hideViewed: settings.hideViewed,
    viewed: ui.viewed,
    measured: heightOf,
  });
}

/** Every card that is on screen, placed. */
export function shown(): Placed[] {
  return laid().cards;
}

/**
 * How much canvas the drawing needs, once the cards have been measured.
 *
 * Not the model's own width and height: a part laid out on its own is a fraction
 * of the change's extent, and a card that measured taller than it was counted at
 * can reach past it.
 */
export function extent(): { width: number; height: number } {
  const { width, height } = laid();
  return { width, height };
}

/* --------------------------------------------------------------- framing */

/**
 * Frames what is actually on the canvas.
 *
 * Measured from the cards that are showing rather than from the drawing's full
 * extent: with a part open, or tests hidden, most of that extent is the space
 * the others left behind, and fitting to it puts a handful of cards in a corner
 * of the screen surrounded by nothing.
 */
function box(): { x: number; y: number; width: number; height: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const card of shown()) {
    left = Math.min(left, card.x);
    top = Math.min(top, card.y);
    right = Math.max(right, card.x + card.width);
    bottom = Math.max(bottom, card.y + card.height);
  }

  if (left === Infinity) {
    return { x: 0, y: 0, width: model.current.width, height: model.current.height };
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function fit(viewport: HTMLElement): void {
  const rect = viewport.getBoundingClientRect();
  // The header stacks into columns and wraps, so its height depends on how much
  // it has to say; measuring beats assuming.
  const bar =
    document.querySelector(".chrome") ?? document.querySelector(".toolbar");
  const top = bar ? bar.getBoundingClientRect().height + 12 : 60;
  const area = box();

  const scale = clamp(
    Math.min(
      (rect.width - 80) / area.width,
      (rect.height - top - 60) / area.height,
    ),
    MIN_SCALE,
    1,
  );
  view.scale = scale;
  view.x = (rect.width - area.width * scale) / 2 - area.x * scale;
  view.y = top + (rect.height - top - area.height * scale) / 2 - area.y * scale;
  apply();
  // The drawing is framed against this size and nobody has moved it since, so
  // growing the panel may as well grow the picture with it.
  view.framed = { width: rect.width, height: rect.height };
  view.placed = false;
}

/**
 * What a resize should do to a view the reader has already chosen.
 *
 * Dragging the panel's edge, the side bar's, or the window's used to refit the
 * drawing, which threw away whatever the reader had zoomed into: a nudge of a
 * divider cost them their place and handed back the whole graph at ten per
 * cent. A resize is a window changing size over the same picture, not a new
 * picture, so the scale is kept and the middle of the view is held still — the
 * room appears at the edges, where it was added.
 *
 * Until the view has been moved, refitting is still the kinder answer: a graph
 * opened into a sliver of a panel should grow into the room a drag gives it. A
 * hidden panel measures zero and is not a size to frame against, so it is left
 * alone; the reader's own numbers are still there when it comes back.
 */
export function reframe(viewport: HTMLElement): void {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  if (!view.placed) {
    fit(viewport);
    return;
  }
  if (view.framed) {
    view.x += (rect.width - view.framed.width) / 2;
    view.y += (rect.height - view.framed.height) / 2;
    apply();
  }
  view.framed = { width: rect.width, height: rect.height };
}

/* ------------------------------------------------------- pinning a drawing */

/**
 * A drawing dropped on the canvas, put where it was dropped.
 *
 * The point arrives in window coordinates, because that is what a pointer
 * knows, and everything pinned to the drawing is stored in the drawing's own —
 * so it stays beside the cards it was put next to however the camera moves
 * afterwards. This is the one place that conversion belongs: the camera is what
 * knows the transform.
 *
 * A size in canvas units rather than pixels, worked out from the zoom, so a
 * drawing dropped while zoomed out is not a postage stamp among the cards.
 */
export function pin(code: string, clientX: number, clientY: number): void {
  const x = Math.round((clientX - view.x) / view.scale);
  const y = Math.round((clientY - view.y) / view.scale);
  const width = Math.round(360 / view.scale);
  const height = Math.round(260 / view.scale);

  pinHere([
    ...pinnedHere(),
    {
      // Ours, and unique without a clock: two identical drawings pinned in the
      // same millisecond are still two drawings.
      id: `d${pinnedHere().length + 1}-${Math.round(x)}-${Math.round(y)}`,
      code,
      // Dropped by its middle rather than by its corner, which is where the
      // reader was actually pointing.
      x: x - Math.round(width / 2),
      y: y - Math.round(height / 4),
      width,
      height,
    },
  ]);
}

/* --------------------------------------------------------- holding a place */

/**
 * Where the reader is, said as a card rather than as coordinates.
 *
 * Coordinates only mean anything against one arrangement of the drawing. An
 * agent that adds a file, or an edit that makes a card taller, moves every card
 * below and to the right of it — so the same numbers now point at a different
 * part of the picture, and the further down the change the reader was, the
 * further out they end up. Which card they were looking at, and where on it,
 * survives all of that.
 *
 * The offset is in canvas units from the card's top-left, so a card that has
 * grown keeps the line the reader was on where it was: lines above an edit do
 * not move, and this holds to the top of the card rather than to a fraction of
 * its height.
 */
interface Held {
  id: string;
  dx: number;
  dy: number;
}

/** The cards nearest the middle of the view, and where the middle falls on each. */
function middle(): Held[] | null {
  if (!framedIn) return null;
  const rect = framedIn.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = (rect.width / 2 - view.x) / view.scale;
  const y = (rect.height / 2 - view.y) / view.scale;

  /*
   * Several cards, nearest first, rather than the one under the middle.
   *
   * The one card can be gone by the time it is asked for, and an agent is
   * exactly what makes that happen: a file it renames is a new card with a new
   * id, and one it deletes is no card at all. That left the drawing with
   * nothing to hold on to precisely in the case this exists for.
   *
   * A neighbour is a worse answer than the card itself and a far better one
   * than the whole change at ten per cent, so a few of them are kept and the
   * first that still exists is used.
   */
  const by = shown()
    .map((card) => ({
      card,
      away:
        x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height
          ? -1
          : Math.hypot(x - (card.x + card.width / 2), y - (card.y + card.height / 2)),
    }))
    .sort((a, b) => a.away - b.away)
    .slice(0, 4)
    .map(({ card }) => ({ id: card.node.id, dx: x - card.x, dy: y - card.y }));

  return by.length ? by : null;
}

/**
 * Puts the middle of the view back on the first of these cards that is still
 * there.
 *
 * The offsets are canvas units from a card's top-left, so a card that has grown
 * keeps the line the reader was on where it was — lines above an edit do not
 * move.
 */
function putBack(anchors: readonly Held[]): boolean {
  if (!framedIn) return false;
  const rect = framedIn.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const cards = shown();
  for (const held of anchors) {
    const card = cards.find((one) => one.node.id === held.id);
    if (!card) continue;
    view.x = rect.width / 2 - (card.x + held.dx) * view.scale;
    view.y = rect.height / 2 - (card.y + held.dy) * view.scale;
    apply();
    return true;
  }
  return false;
}

/**
 * The place to come back to once the drawing has been rebuilt under the reader.
 *
 * Taken before the new model is applied, because it has to be read against the
 * arrangement the reader was actually looking at.
 *
 * Only for a view they chose. A drawing still sitting where it was fitted is
 * not somewhere anybody has been put, and re-fitting it is right.
 */
let holding: Held[] | null = null;
let holdingUntil = 0;
let following: number[] = [];

/**
 * When to look again after a rebuild.
 *
 * A rebuild lands in passes: the rows arrive, the browser draws the cards, and
 * only then can anything measure how tall they really are — and the cards move
 * on each of those. So the view is put back a few times over the couple of
 * seconds it takes to settle, and the last one is what the reader keeps.
 *
 * On a timer rather than by watching the placements. Watching them is a cycle:
 * which cards a page draws depends on where the camera is, their measured
 * heights depend on which were drawn, and the placements depend on those
 * heights — so anything that reads the placements and moves the camera feeds
 * itself. That took the page down entirely, effects exhausted, before a single
 * wheel event had been handled.
 */
const AGAIN = [0, 120, 320, 700, 1200, 2000, 3200];

export function holdPlace(): void {
  if (!view.placed) return;
  holding = middle();
  if (!holding) return;
  /*
   * A deadline, because the settling ends and the reader carries on. Five
   * seconds rather than two: a change of seventy files measures for longer
   * than a change of three, and a hold that expires halfway through leaves
   * them wherever the last unmeasured pass put them.
   */
  holdingUntil = Date.now() + 5000;

  for (const timer of following) window.clearTimeout(timer);
  following = AGAIN.map((wait) => window.setTimeout(keepPlace, wait));
}

/** Applies the hold, if there is one and the reader has not moved since. */
export function keepPlace(): void {
  if (!holding) return;
  if (Date.now() > holdingUntil) {
    letGo();
    return;
  }
  putBack(holding);
}

/**
 * The reader moving the view themselves, which ends any hold.
 *
 * Otherwise a rebuild landing mid-gesture would take the drawing back off them
 * — the one thing worse than losing your place is being moved while you look.
 */
export function letGo(): void {
  holding = null;
  for (const timer of following) window.clearTimeout(timer);
  following = [];
}

/* ------------------------------------------------------------ persistence */

/**
 * Where the reader was, across a rebuilt page.
 *
 * A graph of the working tree is redrawn whenever the working tree moves, and a
 * redraw used to be a new document: same change, same layout, and the reader
 * back at ten per cent looking at the whole picture instead of the two cards
 * they were reading. The camera is the part worth carrying over — it is the
 * only thing on the page that is theirs rather than the change's.
 *
 * Kept against the pair of refs, so opening a different review does not inherit
 * a camera framed on a drawing that is not there any more. Read afresh each
 * time because the model is replaced wholesale by a rebuild.
 */
function key(): string {
  return `odin.camera:${model.current.review || ""}`;
}

interface SavedCamera {
  key: string;
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  /**
   * The cards the middle of the view was on, nearest first, for when the
   * numbers no longer fit. More than one because the nearest can be gone: an
   * agent that renames a file leaves a card with a new id, and one it deletes
   * leaves no card at all.
   */
  on?: Held[];
}

export function rememberCamera(): void {
  if (!host || !view.placed) return;
  // Under its own name in the shared slot. Written whole, it replaced whatever
  // else was in there — including the note that says which reading this frame
  // is — and was replaced by it in turn.
  const on = middle();
  keep({
    camera: {
      key: key(),
      x: view.x,
      y: view.y,
      scale: view.scale,
      width: model.current.width,
      height: model.current.height,
      ...(on ? { on } : {}),
    } satisfies SavedCamera,
  });
}

/**
 * Puts the camera back, if the last page left one for this review.
 *
 * A drawing that has changed size is the ordinary case here, not the exception:
 * an agent editing files is what provokes most rebuilds, and adding a file or
 * making a card taller moves everything below and to the right of it. The saved
 * coordinates then point at a different part of the picture — the further into
 * the change the reader was, the further out they land — which is what "the
 * camera jumped somewhere else" was.
 *
 * So the numbers are used when the shape is the same, and the card the reader
 * was on is used when it is not. Only fitting when there is no card to go back
 * to: dropping somebody into the middle of a picture they have not seen is the
 * thing fitting is there to prevent.
 *
 * Returns whether anything was restored.
 */
export function restoreCamera(viewport: HTMLElement): boolean {
  if (!host) return false;
  const saved = held<Partial<SavedCamera>>("camera") ?? null;
  if (!saved || saved.key !== key()) return false;
  if (typeof saved.scale !== "number" || !(saved.scale > 0)) return false;

  const moved =
    saved.width !== model.current.width || saved.height !== model.current.height;

  // The scale is the reader's own and survives a change of shape.
  view.scale = saved.scale;

  /*
   * A shape that has changed is put back by card; one that has not, by number.
   *
   * And when neither the card nor its neighbours are there any more — a part
   * closed, a file renamed out from under all four — the reader keeps their own
   * coordinates rather than being refitted. They may be a few hundred pixels
   * out; a refit puts them at four per cent looking at a change they have
   * already read half of, which is not a smaller error but a different order of
   * one.
   */
  if (!(moved && saved.on && putBack(saved.on))) {
    view.x = saved.x ?? 0;
    view.y = saved.y ?? 0;
    apply();
  }
  // Framed against this viewport, so a later resize moves the picture rather
  // than refitting it — the same reading fit leaves behind.
  const rect = viewport.getBoundingClientRect();
  if (rect.width && rect.height) {
    view.framed = { width: rect.width, height: rect.height };
  }
  return true;
}

/**
 * The reader's own framing if this page is a redraw of one they were already
 * reading; the whole change if it is not.
 */
/**
 * The viewport the drawing is currently framed in.
 *
 * Every camera move needs one to measure against, and the canvas has it — but
 * the canvas is not the only thing that moves the camera. The settings menu
 * offers "fit the drawing", the keyboard has a key for it, and neither of them
 * is anywhere near the element. Held here rather than threaded through half
 * the component tree so that asking to be framed does not require having a
 * reference to the frame.
 *
 * Null until a canvas mounts, and on the server, where there is no frame to
 * measure and nothing asking to be fitted into one.
 */
// Reactive, and it has to be. Anything deriving from the camera's viewport —
// the map's window over the change, most of all — reads this. As a plain
// binding the read happened once, before a canvas had mounted, and answered
// null forever: the map computed a window of zero size, decided it had nothing
// to draw, and never reconsidered.
let framedIn = $state<HTMLElement | null>(null);

export function start(viewport: HTMLElement): void {
  framedIn = viewport;
  // The page is about to be rebuilt under the reader, over and over, for as
  // long as they leave this open: every save and every file an agent writes.
  rebuilding.before = holdPlace;

  /*
   * A canvas that mounts again is not a page that opened again.
   *
   * This runs whenever the element is remade, which a rebuilt model does — and
   * the camera is a module, so the reader's own numbers are still sitting right
   * here in memory. Reading them back off the frame's stored copy replaced a
   * live answer with a written-down one, and any distance between the two is a
   * jump the reader did not ask for. Where they are is where they are; all this
   * has to do is follow the cards, which have just moved.
   */
  if (view.placed) {
    keepPlace();
    return;
  }

  if (!restoreCamera(viewport)) fit(viewport);
}

/**
 * The bar across the top, which the drawing goes under rather than beside.
 *
 * Measured rather than assumed: it stacks and wraps with how much it has to
 * say, and every landing below is worked out from where its foot falls.
 */
function chromeHeight(): number {
  return document.querySelector(".chrome")?.getBoundingClientRect().height ?? 0;
}

/**
 * Flies the camera to a point in the drawing, at a scale.
 *
 * A move the reader did not make by hand is animated rather than cut to: a cut
 * leaves them at an unfamiliar place with no idea which way they came, and the
 * whole value of the arrow they pressed was that it said which way.
 *
 * The scale is an argument rather than a field this reads, because the two
 * gestures that land here disagree about it and both are right — see `centreOn`
 * and `showFile`. Nothing outside this module passes one.
 */
function fly(x: number, y: number, scale: number): void {
  if (!framedIn) return;
  // Being sent somewhere is a move as much as dragging is: the place the reader
  // was is not the place they asked for.
  letGo();
  const rect = framedIn.getBoundingClientRect();
  land(rect.width / 2 - x * scale, middleOf(rect, y, scale), scale);
}

/**
 * Where a point has to be put for the reader to be looking at it.
 *
 * The chrome covers the top of the viewport, so the middle of the *visible*
 * canvas is lower than the middle of the element. Landing on the geometric
 * centre puts the line the reader was sent to behind the bar.
 */
function middleOf(rect: { height: number }, y: number, scale: number): number {
  const top = chromeHeight();
  return top + (rect.height - top) / 2 - y * scale;
}

/**
 * The flight itself, once somewhere to land has been decided.
 *
 * Separate from `fly` because centring is not the only way to arrive. A reader
 * sent to a remark is being shown a line *and* the conversation about it, and
 * that conversation is a box of its own on the left of the window: the file has
 * to stand where it leaves room rather than in the middle. Both arrivals are the
 * same journey, and the journey is what is here.
 */
function land(toX: number, toY: number, scale: number): void {
  /*
   * How long the flight takes, from how far it goes.
   *
   * A fixed duration is wrong at both ends: a hop to the card next door
   * crawls, and a flight across a change of seventy files is over before the
   * eye has picked up what moved. Scaling by the distance actually travelled
   * on screen keeps the apparent speed roughly constant, which is what makes a
   * move readable — the reader follows the drawing rather than being teleported
   * and having to re-find themselves.
   *
   * Bounded at both ends anyway. Below the floor the animation is shorter than
   * the reader's reaction and reads as a jump; above the ceiling they are
   * waiting for a camera.
   */
  const far = Math.hypot(toX - view.x, toY - view.y);
  const hold = Math.round(Math.min(760, Math.max(240, far * 0.45)));

  motion.flight = hold;
  motion.flying = true;
  view.x = toX;
  view.y = toY;
  view.scale = scale;
  apply(hold);

  // Handed back when the transition is over, not before: a layer released
  // mid-flight makes the browser repaint every remaining frame of it, which is
  // exactly the stutter this is meant to avoid.
  window.clearTimeout(landing);
  landing = window.setTimeout(() => (motion.flying = false), hold);
}

let landing = 0;

/**
 * Flies to a point without touching the zoom.
 *
 * The zoom is left exactly as it was. Framing the destination as well would be
 * answering a question nobody asked — the reader was reading at the size they
 * were reading at, and arriving at a different one means re-finding their
 * bearings on top of re-finding their place. Every caller here is following a
 * reference, which is a move *within* a reading rather than the start of one.
 */
export function centreOn(x: number, y: number): void {
  fly(x, y, view.scale);
}

/** Frames the whole drawing, for anything that cannot reach the viewport. */
export function fitNow(): void {
  if (framedIn) fit(framedIn);
}

/**
 * What the reader can see, in the drawing's own units.
 *
 * The map draws this as the window over the change, and it is the one thing
 * the map cannot work out for itself: it knows the shape of the drawing and
 * the camera, but not how large a hole it is being looked at through.
 */
export function onScreen(): { left: number; top: number; width: number; height: number } {
  if (!framedIn) return { left: 0, top: 0, width: 0, height: 0 };
  const rect = framedIn.getBoundingClientRect();
  return {
    left: -view.x / view.scale,
    top: -view.y / view.scale,
    width: rect.width / view.scale,
    height: rect.height / view.scale,
  };
}

/* ------------------------------------------------ what the file list asks */

/**
 * How few device pixels a character can be and still be a character.
 *
 * The cards decide this for themselves — under about three across, the strokes
 * of a glyph and the gaps between them fall inside one pixel and the browser
 * averages them into a smear, so past that point a card stops building rows and
 * draws its shape instead. The number is restated here rather than imported
 * because it lives inside a component, where it is instance scope and not
 * something a module can ask for; if the cards ever move their floor, this
 * moves with them or the camera starts landing on the smear.
 */
const GLYPH = 3;

/**
 * The zoom at which this page's code is worth arriving at.
 *
 * Derived from the character width the layout engine measured, which is the
 * thing that has to shrink past legibility, rather than typed in: change the
 * font and the answer follows instead of going stale.
 *
 * A whole device pixel past the floor rather than on it. The floor is where the
 * question stops being "can this be read" and becomes "is there anything here
 * to read at all", and a landing exactly on it is one rounding — one wheel
 * notch — from the cards dropping back to their shapes, which is the state the
 * reader pressed the row to leave. One pixel of glyph beyond it is the smallest
 * step that is unambiguously past, and it is still far less zoom than framing
 * the file at full size would impose on somebody who was reading the change at
 * a distance on purpose.
 */
export function readingScale(): number {
  const width = model.current.charWidth;
  // Nothing measured: an empty page, or one built before the engine reported
  // its metrics. The answer this page's own metrics give, so a model that
  // cannot say is treated to the ordinary landing rather than a second policy.
  if (!(width > 0)) return 0.54;
  return clamp((GLYPH + 1) / width, MIN_SCALE, MAX_SCALE);
}

/**
 * The zoom to arrive at, for a reader who asked to be taken somewhere.
 *
 * Never smaller than the one they are already at: somebody reading at full size
 * who presses a row wants that row, not to be pulled back out of the file they
 * are in. Both of the list's gestures land through this, so neither can end up
 * with a different idea of what "readable" means than the other.
 */
function arriveAt(): number {
  return clamp(Math.max(view.scale, readingScale()), MIN_SCALE, MAX_SCALE);
}

/**
 * Flies to a file's card, at a size its code can be read at.
 *
 * The gesture from the file list, and the one place the camera reframes the
 * reader on purpose. Pressing a file's row means "I am going to read this
 * one", and arriving over it at four per cent — the zoom a whole change is
 * fitted at — satisfies the letter of the request and none of it. So the scale
 * is part of the flight here, expressed as its own function rather than as an
 * argument to `centreOn`: the difference is not a parameter but a different
 * intention, and an optional one on the shared flight would let any caller
 * following an arrow reframe the reader by accident.
 *
 * Never zooms out. Somebody already reading at full size asked to be taken to
 * another file, not to be pulled back from the one they are in.
 *
 * The landing is `aimFor`'s, which is the keyboard walk's rule: a tall card is
 * pinned just under the chrome rather than centred, because a file is read from
 * its first line down and a card centred on its middle opens halfway through
 * itself. One rule, in one place, so the two gestures cannot drift apart.
 *
 * Answers with the card it flew to, for whoever marks where the reader is.
 */
export function showFile(path: string): string | null {
  if (!framedIn) return null;
  const card = shown().find((placed) => placed.node.path === path);
  // A file the drawing is not currently showing — filtered away, or in another
  // part. There is nothing to fly to, and inventing a destination from the
  // model would fly to where the card would have been if nothing were filtered.
  if (!card) return null;

  const scale = arriveAt();
  const spot: Spot = {
    id: card.node.id,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
  };
  // The window as it will be once the flight has landed, not as it is now: the
  // rule is about how much of the card fits on screen, and that is a different
  // amount at the scale being arrived at than at the one being left. Not called
  // `window`, because a module that shadows the global one is a module where
  // every later reference to the real one silently means something else.
  const rect = framedIn.getBoundingClientRect();
  const win = { left: 0, top: 0, width: rect.width / scale, height: rect.height / scale };

  const point = aimFor(spot, win, chromeHeight(), scale);
  fly(point.x, point.y, scale);
  return card.node.id;
}

/**
 * Flies to one reference, named by where it lands rather than by an edge.
 *
 * The host says a path, a line and a side, because that is what a row in the
 * file list knows and what an editor would be opened at. The point to fly to is
 * taken from the arrows as they are currently placed — the same objects the
 * canvas drew and the same ones a click on the canvas travels to — rather than
 * recomputed from the model, whose coordinates are the layout engine's estimate
 * for the whole change and not where these cards ended up.
 *
 * Both ends are searched, and arrivals first. The list offers the references a
 * file makes, so the usual answer is the far end of an outgoing arrow; asking
 * after a line that only something else points *at* is the same request read
 * from the other side, and refusing it would be a row that does nothing.
 *
 * Lifted to a reading scale on the way, on the same terms as `showFile` and for
 * the same reason, which is where this parts company with pressing the arrow
 * itself. An arrow on the canvas is followed from inside a reading: the reader
 * is at the size they chose, and the far end of the arrow is more of what they
 * are already looking at. A row in the file list is pressed from outside one —
 * they are being handed a line by name, and handing it over at the zoom the
 * whole change is fitted at delivers a grey rectangle where the line was, since
 * a card that far out has no rows in it to arrive at. Never zooms out, so a
 * reader already in close is not pulled back.
 */
export function showLine(
  path: string,
  line: number,
  side: "base" | "head",
  /**
   * Whether this flight may take its aim again once it has landed.
   *
   * True for the reader's own press and false for the flight that press books;
   * a correction that could book another is a camera that never settles, and a
   * card which somehow still has no rows to point at would be the one to prove
   * it.
   */
  again = true,
): { nodeId: string; edgeId: string | null } | null {
  const scale = arriveAt();
  const cards = laid().cards;
  const boxes: Record<string, Box> = Object.fromEntries(
    cards.map((placed) => [placed.node.id, placed]),
  );
  const drawn = arrows({ model: model.current, reading: reading(), boxes, lineAt });
  const here = (id: string, at: number, on: "base" | "head"): boolean =>
    at === line && on === side && pathOf(model.current.nodes, id) === path;

  /*
   * A card too far out to draw its code has no rows to aim at.
   *
   * Past the legibility floor a card stops building rows and draws its shape,
   * so nothing can say where a line is and the arrows fall back to the middle
   * of the card — which is the right answer for an arrow and the wrong one for
   * a reader who named a line. The rows come into existence only once the card
   * has been drawn at the scale being flown to, so the aim is taken a second
   * time when the flight lands. Once, and only from the flight that could not
   * see the row: the correction is a short hop within a card that is already on
   * screen, and it reads as the file settling on the line rather than as a
   * second journey.
   */
  const settleOn = (nodeId: string): void => {
    if (!again || lineAt(nodeId, side, line, false) != null) return;
    window.clearTimeout(reaim);
    reaim = window.setTimeout(() => showLine(path, line, side, false), motion.flight + 40);
  };

  for (const arrow of drawn) {
    if (here(arrow.edge.to, arrow.edge.toLine, arrow.edge.toSide)) {
      fly(arrow.wire.to.x, arrow.wire.to.y, scale);
      settleOn(arrow.edge.to);
      return { nodeId: arrow.edge.to, edgeId: arrow.edge.id };
    }
  }
  for (const arrow of drawn) {
    if (here(arrow.edge.from, arrow.edge.fromLine, arrow.edge.fromSide)) {
      fly(arrow.wire.from.x, arrow.wire.from.y, scale);
      settleOn(arrow.edge.from);
      return { nodeId: arrow.edge.from, edgeId: arrow.edge.id };
    }
  }

  /*
   * No arrow for it: the reader has filtered that kind of reference away, or
   * both ends are not on the canvas together. The line is still a real line on
   * a real card, and the row it sits on is the honest place to land — asked of
   * the cards, which is what knows whether the row is folded into a band or
   * held below the height cap and what stands in for it if it is.
   */
  const card = cards.find((placed) => placed.node.path === path);
  if (!card) return null;
  const row = lineAt(card.node.id, side, line, false);
  fly(card.x + card.width / 2, card.y + (row ?? card.height / 2), scale);
  settleOn(card.node.id);
  return { nodeId: card.node.id, edgeId: null };
}

/** The correction booked by a flight that could not see the row it was for. */
let reaim = 0;

/**
 * The zoom a remark is read at.
 *
 * Full size, and set rather than lifted to. A remark is about words — the ones
 * on the line and the ones in the answer beside it — and both are prose at a
 * fixed size in a box that does not scale with the drawing. Arriving at the zoom
 * a whole change is fitted at shows a green rectangle where the words were;
 * arriving at three times life size shows four of them next to a panel of full
 * paragraphs. The one place in this module that will zoom a reader *out*, and on
 * purpose: unlike a file, a conversation has a size of its own that the code has
 * to be brought into agreement with.
 */
const REMARK_SCALE = 1;

/**
 * Takes the reader to a remark, and leaves the conversation room to open in.
 *
 * The gesture from the list of threads, which is the one place a reader asks for
 * a line they cannot currently see — quite possibly on a card at the other end
 * of the change. Pressing an entry used to open the conversation where its mark
 * happened to be standing, which for a mark that was off screen was nowhere at
 * all: the box floated at the edge of the window with no visible relationship to
 * the code it was quoting.
 *
 * Two things are being framed, not one. The line goes in the middle of the
 * visible canvas, as every other flight puts what it was sent to; and the file
 * is stood far enough right that the panel has its own room to the left, which
 * is `besideFile`'s arithmetic and the reason this cannot simply centre on a
 * point. Everything the box is going to want is worked out before it is asked
 * for, so it never has to open over the line it is about.
 *
 * The conversation itself is opened by the marks, which are the only thing that
 * knows where a mark has ended up once the flight has landed. This moves the
 * camera and says which card it moved to; nothing more.
 */
export function showRemark(
  path: string,
  line: number,
  side: "base" | "head",
  wholeFile = false,
  /** Whether this flight may take its aim again once it has landed — see below. */
  again = true,
): string | null {
  if (!framedIn) return null;
  let card = shown().find((placed) => placed.node.path === path);

  /*
   * A conversation the current tab is not showing.
   *
   * The parts are a way of looking at the change — this cluster now, that one
   * next — and not a filing system its remarks belong to. Somebody pressing a
   * question in a log, or a row in the list of threads, is asking for that
   * conversation; answering "not from this tab" is answering a question they
   * did not ask, and it fails silently, which is worse: the press does nothing
   * at all and there is nothing on screen to say why.
   *
   * So the tab gives way to the conversation. Only when the file is in the
   * change at all, and only as far as the whole of it: this opens the drawing
   * up rather than choosing some other part on the reader's behalf.
   */
  if (!card && ui.part && model.current.nodes.some((node) => node.path === path)) {
    ui.part = null;
    // The list beside the canvas follows the canvas. Left unsaid, it would go
    // on showing the five files of a part the drawing has just left.
    notify("part", { paths: null });
    card = shown().find((placed) => placed.node.path === path);
  }

  // Still nothing: filtered away by a switch the reader set — tests hidden, a
  // file ticked off — or not in this change at all. There is no card, so there
  // is no mark and nothing to open, and no honest place to fly to either.
  if (!card) return null;

  const scale = clamp(REMARK_SCALE, MIN_SCALE, MAX_SCALE);
  const rect = framedIn.getBoundingClientRect();
  const row = lineAt(card.node.id, side, line, wholeFile);
  land(
    besideFile(card, rect.width, scale),
    middleOf(rect, card.y + (row ?? card.height / 2), scale),
    scale,
  );

  /*
   * A card too far out to draw its code has no rows to aim at.
   *
   * The same correction `showLine` books, and needed more often here: the list
   * of threads is most useful from a distance, which is exactly the zoom at
   * which a card has given up on rows and drawn its shape. The rows come into
   * existence once the card has been drawn at the scale being flown to, so the
   * aim is taken a second time when the flight lands — once, from the flight
   * that could not see the row, or a camera that corrects itself would have
   * something to correct forever.
   */
  if (again && row == null) {
    window.clearTimeout(reaim);
    reaim = window.setTimeout(
      () => showRemark(path, line, side, wholeFile, false),
      motion.flight + 40,
    );
  }
  return card.node.id;
}
