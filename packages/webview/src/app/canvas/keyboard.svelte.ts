import { model, notify, ui, view } from "../state.svelte.js";
import * as camera from "./camera.svelte.js";
import {
  actionFor,
  aimFor,
  cardAt,
  HEADINGS,
  readKeys,
  stepFrom,
  typing,
  waitingFor,
  type Focused,
  type Spot,
} from "./keys.js";
import { composeOnFile, drop } from "./picking.svelte.js";

/**
 * Reading a change from the keyboard.
 *
 * Most of a review is the same few actions in a loop: go to the next file, say
 * something about it, mark it read, open it when the drawing is not enough.
 * Doing that from the keyboard means never leaving the file to reach for the
 * mouse, which is the whole point of there being keys at all.
 *
 * A module rather than something a component owns, for the same reason the
 * camera is one: the actions land on the shared state, the camera and the host,
 * and none of those belong to the element the listener happens to be near. The
 * canvas mounts it because the canvas is the thing being driven — and because a
 * listener bound at module scope would be bound while the page is being
 * rendered to text by Node, where there is no document to bind it to.
 */

/** Held on the device, and absent where a webview has denied storage. */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The bar across the top, which the drawing goes under rather than beside.
 *
 * Measured rather than assumed: it stacks and wraps with how much it has to
 * say, and every number below that lands a card on the screen is relative to
 * its foot.
 */
function chromeHeight(): number {
  return document.querySelector(".chrome")?.getBoundingClientRect().height ?? 0;
}

/** The cards on the canvas, as the walk wants them. */
function spots(): Spot[] {
  return camera.shown().map((placed) => ({
    id: placed.node.id,
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
  }));
}

/** The file a card is about, which is what every action other than the walk is
    really addressed to. */
function pathOf(id: string): string | null {
  return model.current.nodes.find((node) => node.id === id)?.path ?? null;
}

/**
 * Where the reader is, in the drawing's own units.
 *
 * The middle of the viewport, worked out the same way the map works out which
 * card to mark. Deliberately the same arithmetic and deliberately not stored:
 * two answers to "which card am I on" is how the map comes to disagree with the
 * keys about where the reader is, and a reader watching the highlight stay put
 * while the drawing moves has no way of telling which of the two is lying.
 */
function middle(): { x: number; y: number } {
  const win = camera.onScreen();
  return { x: win.left + win.width / 2, y: win.top + win.height / 2 };
}

/**
 * Flies to a card and makes it the one the reader is on.
 *
 * Through the camera's own flight rather than by assigning the view, so that a
 * walk and a followed arrow move the drawing in the same way — eased, and over
 * a time that grows with the distance. A hop to the card next door is quick; a
 * jump across a change of seventy files takes long enough to see which way it
 * went, which is the difference between arriving and being teleported.
 */
function travel(card: Spot): void {
  const point = aimFor(card, camera.onScreen(), chromeHeight(), view.scale);
  // Not what the walk steps from — that is read off the geometry every time.
  // This is the mark the map falls back on once the reader pans away from the
  // card they were handed, and it should say the same thing after a walk as it
  // does after following a reference.
  ui.activeNode = card.id;
  camera.centreOn(point.x, point.y);
}

/**
 * How often a held key may take a step.
 *
 * A held arrow repeats around thirty times a second, and each repeat starting a
 * fresh flight from where the last one had got to means a reader crossing the
 * whole change in the time it takes to notice they are moving — with the
 * animation restarting every frame, so nothing on screen is ever legible. A
 * step every fifth of a second is roughly the length of the shortest flight the
 * camera will fly, so a held key walks card by card at a pace the eye can
 * follow.
 *
 * Only auto-repeats are rationed. Somebody pressing the key quickly on purpose
 * means every press, and swallowing one of those would be a key that sometimes
 * does nothing.
 */
const STRIDE = 180;
let stepped = 0;

/** Marking a file read, the way the checkbox on the card does it. */
function markRead(path: string): void {
  const on = !ui.viewed.has(path);
  // Replaced rather than added to: a plain Set inside reactive state is not
  // watched from the inside, so adding to it changes nothing anybody can see.
  const next = new Set(ui.viewed);
  if (on) next.add(path);
  else next.delete(path);
  ui.viewed = next;
  notify("viewed", { path, viewed: on });
}

function press(event: KeyboardEvent): void {
  /*
   * A press somebody has already dealt with is not a command.
   *
   * The bands inside a card open on Enter and the reviewer pill on space, both
   * of them on the element that has focus — and both bubble up here afterwards.
   * Without this, opening a fold with Enter also ticked the file off as read,
   * which is a thing a reader would discover much later and never connect to
   * the key they pressed.
   */
  if (event.defaultPrevented) return;

  if (typing(event.target as unknown as Focused | null)) {
    // Escape is not a character, so it is still worth something in a box: it
    // shuts the composer without sending what is in it. Hard-wired rather than
    // read from the bindings — whatever `clear` has been bound to, the way out
    // of a text box is escape.
    if (event.key === "Escape" && ui.composer) ui.composer = null;
    return;
  }

  /*
   * The panel is waiting for a new binding, and the next press is the answer.
   *
   * Both handlers see the press — this one first, on the document, and the
   * panel's a moment later on the window — so without this the key being bound
   * would also be obeyed on its way past, and binding "comment" to `c` would
   * open a composer as it was bound.
   *
   * Asked of the module both sides share rather than read off the page. The
   * panel is in the chrome and this is in the canvas, and for a while the only
   * thing joining them was a class name on an element — which is a contract
   * nobody can see and nothing checks.
   */
  if (waitingFor()) return;

  const action = actionFor(event, readKeys(store()));
  if (!action) return;

  if (action === "fit") {
    camera.fitNow();
    return;
  }

  if (action === "clear") {
    ui.activeNode = null;
    ui.activeEdge = null;
    ui.thread = null;
    drop();
    return;
  }

  const cards = spots();
  const at = middle();
  const here = cardAt(cards, at.x, at.y);

  const heading = HEADINGS[action];
  if (heading) {
    // Taken whether or not there is anywhere to go: an arrow key that falls
    // through to the browser scrolls the page out from under the drawing, and
    // the edge of the graph is where that is likeliest to happen.
    event.preventDefault();
    if (!here) return;
    const now = Date.now();
    if (event.repeat && now - stepped < STRIDE) return;
    const next = stepFrom(here, cards, heading.dx, heading.dy);
    if (!next) return;
    stepped = now;
    travel(next);
    return;
  }

  if (!here) return;
  const path = pathOf(here.id);
  if (!path) return;

  if (action === "read") {
    markRead(path);
    event.preventDefault();
    return;
  }

  if (action === "comment") {
    // There has to be somewhere to send it. A page opened from disk has no
    // forge behind it, and a composer there is an invitation to a dead end.
    if (!model.current.canReview) return;
    composeOnFile(here.id, path);
    event.preventDefault();
    return;
  }

  if (action === "open") {
    notify("open", { path });
    event.preventDefault();
  }
}

/**
 * Starts listening, and hands back the way to stop.
 *
 * On the document rather than on the canvas element, because the reader is not
 * required to have clicked the drawing first: a page that only answers the keys
 * once something inside it has focus is a page whose keys do not work, and the
 * reader has no way of guessing what they were supposed to press first.
 */
export function listen(): () => void {
  document.addEventListener("keydown", press);
  return () => document.removeEventListener("keydown", press);
}
