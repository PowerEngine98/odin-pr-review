/**
 * Words typed but not yet sent, and where they live between page loads.
 *
 * Closing a box is not the same as discarding what is in it. A reviewer who
 * shuts a composer to look at the code again, or a thread to check another
 * file, has not changed their mind about the sentence they were half way
 * through — and a webview is rebuilt for any number of reasons that have
 * nothing to do with them: switching diff modes, reloading the window, the
 * extension being updated underneath. Losing the sentence to any of those is
 * the kind of small betrayal that teaches people to draft somewhere else
 * first.
 *
 * Nothing here is reactive. It is the filing cabinet, not the desk: the
 * components hold what is currently being written, and this says what that is
 * called and where it is kept, so both can be tested without a page.
 */

/** One remark written here and not yet sent to the forge. */
export interface Draft {
  path: string;
  /** Absent for a remark about the file itself, which has no line to sit on. */
  line?: number;
  /**
   * Carried only for a real span: the forge rejects a start equal to the end,
   * and a one-line comment is not a span.
   */
  startLine?: number;
  side: string;
  body: string;
}

/** What a composer is open against — enough to say what its draft is about. */
export interface Where {
  path: string;
  side: string;
  line?: number;
  startLine?: number;
}

/**
 * Everything held for one review.
 *
 * `drafts` are finished remarks waiting on a verdict; `unsent` is the text
 * still in a box, filed under the box it is in. The two are kept together
 * because they are lost together — a review that is submitted has no more of
 * either.
 */
export interface Filed {
  drafts: Draft[];
  unsent: Record<string, string>;
}

/** As much of `localStorage` as any of this needs, so a test can pass a fake. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The summary of the whole review, which belongs to no line and no thread. */
export const SUMMARY_KEY = "review";

/**
 * A page opened in a browser has a store; one opened somewhere stranger may
 * not, and a review is not worth interrupting over where the notes are kept.
 */
function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Which review this is, as the host names it: a pull request number, or the
 * pair of refs being compared. Two reviews open on one machine must not read
 * each other's half-written sentences, and the host has already made the name
 * that tells them apart.
 */
export function storeKey(review: string): string {
  return "odin.drafts:" + (review || "here");
}

/** What a half-written comment is filed under: the span it is about. */
export function composerKey(where: Where): string {
  // A remark about the file has no line to key on, and one draft per file is
  // the right number of them.
  if (where.line === undefined) return "c:" + where.path + ":file";
  return (
    "c:" + where.path + ":" + where.side + ":" +
    (where.startLine || where.line) + "-" + where.line
  );
}

/** A half-written reply is filed under the conversation it answers. */
export function threadKey(id: string): string {
  return "t:" + id;
}

export function load(review: string, store: Store | null = defaultStore()): Filed {
  if (!store) return { drafts: [], unsent: {} };
  try {
    const held = JSON.parse(store.getItem(storeKey(review)) || "{}");
    return {
      drafts: Array.isArray(held?.drafts) ? (held.drafts as Draft[]) : [],
      unsent:
        held?.unsent && typeof held.unsent === "object"
          ? (held.unsent as Record<string, string>)
          : {},
    };
  } catch {
    // Unreadable is the same as absent.
    return { drafts: [], unsent: {} };
  }
}

export function save(
  review: string,
  filed: Filed,
  store: Store | null = defaultStore(),
): void {
  if (!store) return;
  try {
    if (filed.drafts.length === 0 && Object.keys(filed.unsent).length === 0) {
      store.removeItem(storeKey(review));
      return;
    }
    store.setItem(storeKey(review), JSON.stringify(filed));
  } catch {
    // A full or disabled store is not worth interrupting a review over; the
    // drafts still live for as long as the page does.
  }
}

/**
 * Replaces the pending remarks, keeping whatever is still being typed.
 *
 * Returns the list it was given so a caller can assign the result straight
 * back into state: filing and showing are the same moment, and a version that
 * only wrote to disk left the panel a beat behind the composer that fed it.
 */
export function fileDrafts(
  review: string,
  next: Draft[],
  store: Store | null = defaultStore(),
): Draft[] {
  save(review, { drafts: next, unsent: load(review, store).unsent }, store);
  return next;
}

/**
 * Holds the text of one box.
 *
 * Written on every keystroke rather than on a timer: the event this is
 * guarding against is the page going away without warning, and a timer that
 * had not fired yet is exactly as good as no timer at all.
 */
export function remember(
  review: string,
  key: string,
  text: string,
  store: Store | null = defaultStore(),
): void {
  const filed = load(review, store);
  if (text.trim()) filed.unsent[key] = text;
  else delete filed.unsent[key];
  save(review, filed, store);
}

/** What was in a box that has now been sent. */
export function forget(
  review: string,
  key: string,
  store: Store | null = defaultStore(),
): void {
  remember(review, key, "", store);
}

/** Sent is the one thing that is not a draft any more. */
export function clearAll(review: string, store: Store | null = defaultStore()): void {
  save(review, { drafts: [], unsent: {} }, store);
}

/**
 * Where a pending remark is, said the way a reader would say it.
 *
 * A remark about the file says so rather than showing a line it does not have,
 * and a one-line remark is a number rather than a range of one.
 */
export function whereOf(draft: Draft): string {
  if (draft.line === undefined) return "whole file";
  if (draft.startLine !== undefined && draft.startLine < draft.line) {
    return draft.startLine + "–" + draft.line;
  }
  return String(draft.line);
}
