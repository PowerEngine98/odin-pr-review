import type { Query, SidebarModel } from "./model.js";
import { filesIn } from "./tree.js";

/**
 * What the sidebar is showing, as data the components react to.
 *
 * The old renderer kept this in the document: a mark was a class on a row, the
 * progress bar was four elements the script wrote numbers into, and the filter
 * was a walk over every node toggling `display`. Each of those was a second
 * copy of a fact the page already had, kept in step by hand, and they came
 * apart in exactly the ways they were bound to — a bar that still said 3/12
 * after a message from the host had ticked a fourth box.
 *
 * Here the model is the state. A mark is a field on a file, and everything
 * drawn from it redraws because it read it.
 */

/** The bridge to the extension, absent when the page is rendered as text. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    __ODIN_SIDEBAR__?: SidebarModel;
  }
}

export const host =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

/**
 * A sidebar with nothing in it.
 *
 * Not an error: rendering as text starts here and is handed the real model a
 * moment later as a prop, and a document that woke up before the host wrote
 * its payload gets an empty picker rather than a stack trace.
 */
const EMPTY: SidebarModel = {
  loading: false,
  picker: {
    mine: [],
    everythingElse: [],
    asked: { state: "open", author: "" },
    viewer: "",
    reached: true,
  },
};

/**
 * What the host embedded, if there is a host.
 *
 * Read through a guard because this module is evaluated by Node as well as by
 * a browser — the same components are compiled a second time to render the
 * sidebar as text, for the view to show before its script has parsed. On that
 * side there is no window.
 */
function embedded(): SidebarModel {
  if (typeof window !== "undefined" && window.__ODIN_SIDEBAR__) {
    return window.__ODIN_SIDEBAR__;
  }
  return EMPTY;
}

export const model = $state<{ current: SidebarModel }>({ current: embedded() });

/** What the reader has done to the view, as opposed to what the host sent. */
export const ui = $state({
  /** A fetch is in flight. Told by the host; the page cannot know. */
  loading: embedded().loading,
  /** What the change is being narrowed to, lowercased. */
  needle: "",
});

/** Anything the extension is meant to act on. */
export function notify(type: string, payload: Record<string, unknown> = {}): void {
  host?.postMessage({ type, ...payload });
}

/**
 * Marks a file, and says so.
 *
 * The model is written first and the host told second, so the bar and the row
 * move under the reader's finger rather than after a round trip. The host
 * persists it and tells the panel, which is the half this view cannot do.
 */
export function mark(path: string, viewed: boolean): void {
  setViewed([path], viewed);
  notify("viewed", { paths: [path], viewed });
}

/** The same change arriving from elsewhere: the canvas, or another view. */
function setViewed(paths: string[], viewed: boolean): void {
  const change = model.current.change;
  if (!change) return;
  const wanted = new Set(paths);
  for (const file of filesIn(change.tree)) {
    if (wanted.has(file.path)) file.viewed = viewed;
  }
}

/** Asks the host for a different set of pull requests. */
export function ask(change: Partial<Query>): void {
  notify("asked", { ...change });
}

/**
 * Something the view would rather not forget across a redraw.
 *
 * Changing the question rebuilds the document — the host renders a new one and
 * assigns it — so a panel that shut on every press would be unusable, and a
 * box being typed into would lose the caret at the end of every word. Session
 * storage survives that; component state does not.
 *
 * Wrapped because a webview can be configured without it, and a view that
 * throws while remembering where a panel was is worse than one that forgets.
 */
export function remembered(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Nothing to do about it, and nothing worth saying.
  }
}

export function forget(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // As above.
  }
}

/**
 * Listens for what the host has to say.
 *
 * Both messages exist because the alternative is a redraw. The document is
 * rebuilt for anything structural, but a fetch starting and a file being
 * marked somewhere else are not structural, and replacing the document for
 * either would lose the reader's scroll and whatever they had typed.
 */
export function listen(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as
      | { type?: string; value?: boolean; paths?: string[]; viewed?: boolean }
      | undefined;
    if (!message || typeof message.type !== "string") return;

    if (message.type === "loading") {
      ui.loading = message.value === true;
      return;
    }
    if (message.type === "setViewed") {
      setViewed(message.paths ?? [], message.viewed === true);
    }
  });

  // A message sent while this document was still loading is dropped, so the
  // document asks rather than waiting to be told. Without it a fetch that
  // finished during a redraw left the bar running with nothing behind it.
  notify("ready");
}
