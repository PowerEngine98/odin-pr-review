/**
 * The keys, what they do, and where the reader's own choices are kept.
 *
 * Here rather than beside either of the two things that need it, because both
 * of them do and neither owns the other. The canvas acts on a press; the
 * settings panel draws a row per action, names it, and lets the reader bind it
 * to something else. For a while each held its own copy of the table and they
 * were joined only through `odin.keys` in local storage — which is to say they
 * were joined by whoever remembered to edit both. This page has already paid
 * for that arrangement once: the arrow geometry in `wire.ts` was written in the
 * markup and again in the script that redrew it, and the two drifted until a
 * dot sat two pixels further out in one of them than the other. A binding that
 * drifts is worse to find than a dot, because the panel goes on saying `c` in
 * confident letters while the canvas obeys something else, and the reader has
 * no way to tell which of the two is lying.
 *
 * Plain TypeScript, no runes and no DOM. The canvas side is already plain so
 * that a test can ask which card is to the right of which without dragging a
 * page's worth of reactive state in behind it, and a shared module that broke
 * that would have bought agreement at the price of the thing it was protecting.
 */

/** One thing the keyboard can do, and the key it does it with out of the box. */
export interface Action {
  id: string;
  says: string;
  key: string;
}

/**
 * The nine bindings.
 *
 * Every default is a bare key. A press with a modifier on it belongs to the
 * editor around this page, and taking `ctrl+f` away from a reviewer who meant
 * to search is worse than having no binding at all.
 */
export const ACTIONS: readonly Action[] = [
  { id: "fit", says: "Fit the drawing", key: "h" },
  { id: "open", says: "Open the file in the editor", key: "F" },
  { id: "read", says: "Mark the file read", key: "Enter" },
  { id: "comment", says: "Comment on the file", key: "c" },
  { id: "right", says: "Next file to the right", key: "ArrowRight" },
  { id: "left", says: "Next file to the left", key: "ArrowLeft" },
  { id: "down", says: "Next file below", key: "ArrowDown" },
  { id: "up", says: "Next file above", key: "ArrowUp" },
  { id: "clear", says: "Clear the selection", key: "Escape" },
];

/**
 * Where the reader's choices are kept on the device.
 *
 * A preference that resets every reload is not a preference, and a review is
 * one sitting. Under one key so that clearing it restores the defaults whole,
 * and spelled here so that the side which writes the file and the side which
 * reads it cannot come to disagree about its name — the failure that would
 * cause looks exactly like rebinding silently not working.
 */
export const KEYS_KEY = "odin.keys";

/** As much of `localStorage` as this needs, so a test can pass a fake. */
export interface Store {
  getItem(key: string): string | null;
}

/** The bindings as they ship, fresh each time so a caller may edit its own. */
export function defaults(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const action of ACTIONS) out[action.id] = action.key;
  return out;
}

/**
 * The reader's bindings, or the defaults where they have not made a choice.
 *
 * Read afresh on every press rather than once at start-up. The panel that edits
 * these is a different component and it writes whenever a binding changes; a
 * handler that had read the file when the page opened would go on obeying the
 * old key until the next reload, which is the one moment a reader is certain to
 * be watching for the new one.
 *
 * Anything unrecognised is dropped rather than trusted. This file is on a disk
 * a reviewer can edit and a page they can run scripts in, and an action bound
 * to a number is a handler that compares a string to a number forever.
 */
export function readKeys(store: Store | null): Record<string, string> {
  const out = defaults();
  if (!store) return out;
  try {
    const saved = JSON.parse(store.getItem(KEYS_KEY) ?? "{}") as Record<string, unknown>;
    for (const id of Object.keys(saved)) {
      if (out[id] !== undefined && typeof saved[id] === "string") {
        out[id] = saved[id] as string;
      }
    }
  } catch {
    /* an unreadable binding file is the defaults, not an error */
  }
  return out;
}

/**
 * The action whose new key the panel is listening for, or nothing.
 *
 * Both sides see the press that answers: the canvas listens on the document and
 * the panel on the window, so the canvas gets it first. Without somewhere to ask
 * about this, binding "comment" to `c` would open a composer on the way past —
 * the reader would be told the binding worked and shown a box they did not want,
 * in that order.
 *
 * It lives beside the table rather than inside the panel because it is the
 * panel's answer to a question the canvas has to ask. The canvas asked it of the
 * DOM for a while, by looking for a lit key cap; that made a class name in a
 * stylesheet into an interface between two modules, so renaming the cap would
 * have quietly restored the bug. A plain variable can at least be found by
 * searching for it.
 */
let waiting: string | null = null;

/** Said by the panel: this action is listening, or none is any more. */
export function waitFor(action: string | null): void {
  waiting = action;
}

/** Asked by anything that acts on presses, before it acts on one. */
export function waitingFor(): string | null {
  return waiting;
}
