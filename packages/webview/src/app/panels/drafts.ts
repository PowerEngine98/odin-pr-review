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
  /**
   * The code this was written against, so it can be found again.
   *
   * A draft is a line number and a body, and in a live reading the line number
   * stops being true the moment anything above it moves — an agent takes an
   * earlier remark, inserts nine lines, and this one now covers different code.
   * Nothing announces that. The reader presses submit and files a remark
   * against lines nobody looked at.
   *
   * The text is what survives the move, and the page has it: the composer opens
   * with the picked lines already in hand, for the suggestion button.
   */
  lines?: string[];
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
 * Which review this is, and in which repository.
 *
 * A pull request number is unique only within the repository it was opened in,
 * and every page this extension draws shares one store: the webview's origin is
 * the same for every reading in every repository on the machine. Filed under
 * the number alone, #272 in one repository and #272 in another read and wrote
 * the same drafts — the second showed the first one's remarks in its pending
 * list, and Submit sent them to a pull request they were never written about.
 * Usually the forge refused them for naming files it did not have; where a path
 * happened to exist in both, they went out, publicly, in the wrong place.
 *
 * So a review is named together with its repository, as the host works it out
 * (see `repository` in the view model for what that is and why).
 */
export interface Shelf {
  /** The pull request, or the pair of refs, as the host names it. */
  review: string;
  /**
   * The repository the review belongs to. Absent only for a page built from a
   * graph that never said where it came from, which has no host to submit
   * anything through and shares its store with nobody but its own kind.
   */
  repository?: string;
  /**
   * The files this change touches, and the forge conversations on it.
   *
   * Needed only to judge whether a record filed before repositories were named
   * is plausibly about this change — see `load` — and asked for only then. The
   * components call this from inside their effects, and reading every card and
   * every comment there would make a box being typed into re-read itself from
   * the store whenever a remark arrived: harmless while the store keeps up, and
   * a reset of the reader's sentence to an older one the moment it does not.
   */
  here?: () => Here;
}

/** What this change is made of, as far as telling old records apart needs. */
export interface Here {
  files: readonly string[];
  threads: readonly string[];
}

/** As much of the view model as says where this page's drafts are filed. */
export interface Filing {
  review: string;
  repository?: string;
  nodes?: readonly { path: string }[];
  comments?: readonly { id: string; local?: boolean }[];
}

/**
 * Where this page's drafts are kept, from what the page was drawn from.
 *
 * Local conversations are left out of the threads: their ids are made on this
 * machine and mean nothing outside the reading that made them, so a match on
 * one says nothing about which repository a record came from.
 */
export function shelfOf(page: Filing): Shelf {
  return {
    review: page.review,
    ...(page.repository ? { repository: page.repository } : {}),
    here: () => ({
      files: (page.nodes ?? []).map((node) => node.path),
      threads: (page.comments ?? []).filter((c) => !c.local).map((c) => c.id),
    }),
  };
}

/** The key a review is filed under now: its repository, then its name. */
export function storeKey(shelf: Shelf): string {
  return "odin.drafts@" + (shelf.repository || "?") + ":" + (shelf.review || "here");
}

/**
 * The key a review was filed under before repositories were named.
 *
 * Read and never written. A record under it does not say which repository it
 * came from, and nothing on this machine can say it for it.
 */
export function legacyKey(review: string): string {
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

/** Nothing held, which is also what an unreadable record amounts to. */
function nothing(): Filed {
  return { drafts: [], unsent: {} };
}

/** A record as it was stored, or null when there is none worth the name. */
function read(store: Store, key: string): Filed | null {
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const held = JSON.parse(raw);
    if (!held || typeof held !== "object") return null;
    return {
      drafts: Array.isArray(held.drafts) ? (held.drafts as Draft[]) : [],
      unsent:
        held.unsent && typeof held.unsent === "object"
          ? (held.unsent as Record<string, string>)
          : {},
    };
  } catch {
    // Unreadable is the same as absent.
    return null;
  }
}

/**
 * Whether a record filed without a repository is plausibly about this change.
 *
 * The number it was filed under is shared by a pull request in every
 * repository the reader works in, so the number is no evidence at all. What the
 * record says about itself is: each draft names a file, each half-written
 * comment names one in its key, and a reply names a conversation by the forge's
 * own id, which is unique across the forge. So it is shown here only if every
 * file it names is a file of this change, and it names at least one thing that
 * can be checked. A record that names nothing checkable — a summary alone —
 * stays where it is rather than being guessed at; the guess is how remarks
 * reach the wrong pull request.
 *
 * A reply to a conversation that is not here counts neither way: the
 * conversation may simply have been deleted since, and a missing id is a much
 * weaker sign than a file this change has never touched.
 */
export function plausiblyHere(filed: Filed, shelf: Shelf): boolean {
  const here = shelf.here?.();
  const files = new Set(here?.files ?? []);
  const threads = new Set(here?.threads ?? []);
  let evidence = 0;

  for (const draft of filed.drafts) {
    if (!files.has(draft.path)) return false;
    evidence++;
  }
  for (const key of Object.keys(filed.unsent)) {
    if (key.startsWith("c:")) {
      // A composer's key is its path and then its span, and a path may itself
      // hold a colon, so it is matched against the files rather than split.
      let named = false;
      for (const file of files) {
        if (key.startsWith("c:" + file + ":")) {
          named = true;
          break;
        }
      }
      if (!named) return false;
      evidence++;
    } else if (key.startsWith("t:") && threads.has(key.slice(2))) {
      evidence++;
    }
  }
  return evidence > 0;
}

/**
 * Everything held for one review.
 *
 * The record under the repository's own key, when there is one — present even
 * if empty, because an empty record is what a submitted review leaves behind,
 * and it must not be taken to mean "look elsewhere".
 *
 * Only when there is none is the old repository-less key read, so that drafts
 * written before this change stay visible where they were visible. That read
 * adopts nothing and moves nothing: the old record is never written to and
 * never removed, and it is shown only if `plausiblyHere` finds it is about this
 * change. The earlier way of handling an old record of this kind — handing it
 * to whichever reading happened to open first — walked a conversation onto a
 * pull request it did not belong to, and the same here would post remarks to
 * one.
 *
 * Once the reader does anything to what is shown, the result is filed under
 * the new key, and the new key is what is read from then on.
 */
export function load(shelf: Shelf, store: Store | null = defaultStore()): Filed {
  if (!store) return nothing();
  const own = read(store, storeKey(shelf));
  if (own) return own;
  const old = read(store, legacyKey(shelf.review));
  if (old && plausiblyHere(old, shelf)) return old;
  return nothing();
}

/**
 * Why a save did not happen, in the two ways that ask different things of the
 * reader. A full store is shared with every other review on the machine and
 * room can be made in it by finishing or discarding one; a store that is
 * missing or refused will never keep anything, whatever the reader does.
 */
export type Unsaved = "full" | "unavailable";

let listener: ((trouble: Unsaved) => void) | null = null;
let told = false;

/**
 * Who to tell when drafts stop being kept.
 *
 * Told once per page. A store that is full fails every save, and saves happen
 * on every keystroke; a warning repeated per character would bury the very
 * text it is warning about. Registering a listener starts afresh, which is also
 * how a test gets a clean page.
 */
export function onUnsaved(tell: ((trouble: Unsaved) => void) | null): void {
  listener = tell;
  told = false;
}

function unsaved(trouble: Unsaved): void {
  if (told) return;
  told = true;
  listener?.(trouble);
}

/**
 * Whether a failed write was the store being full.
 *
 * Browsers disagree on the spelling: Chromium and Safari name the exception,
 * older engines give only the legacy code, and Firefox has its own name.
 */
function isFull(error: unknown): boolean {
  const e = error as { name?: string; code?: number } | null;
  return (
    e?.name === "QuotaExceededError" ||
    e?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e?.code === 22 ||
    e?.code === 1014
  );
}

/**
 * Files what is held for a review, under its repository's key only.
 *
 * A failed write used to be swallowed on the grounds that the drafts still
 * lived for as long as the page did. They did, until the reload, when they were
 * gone with nothing having said so. The store is shared by every review in
 * every repository and each draft carries the code it was written against, so
 * a heavy reviewer can fill it; now the reader is told at the moment it
 * happens, while the drafts are still on screen and can be submitted or
 * copied.
 *
 * An empty review is removed rather than kept — except where an old
 * repository-less record exists for the same name, when an empty record is
 * written in its place. Otherwise submitting a review that had been read from
 * the old key would leave nothing under the new one, and the next load would
 * find the old record again and offer the same remarks for a second posting.
 */
export function save(
  shelf: Shelf,
  filed: Filed,
  store: Store | null = defaultStore(),
): void {
  const empty = filed.drafts.length === 0 && Object.keys(filed.unsent).length === 0;
  if (!store) {
    if (!empty) unsaved("unavailable");
    return;
  }
  try {
    if (empty) {
      if (store.getItem(legacyKey(shelf.review)) !== null) {
        store.setItem(storeKey(shelf), JSON.stringify(nothing()));
      } else {
        store.removeItem(storeKey(shelf));
      }
      return;
    }
    store.setItem(storeKey(shelf), JSON.stringify(filed));
  } catch (error) {
    // Nothing was going to be lost by failing to file nothing, so an empty
    // review that could not be written is not worth a warning.
    if (!empty) unsaved(isFull(error) ? "full" : "unavailable");
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
  shelf: Shelf,
  next: Draft[],
  store: Store | null = defaultStore(),
): Draft[] {
  save(shelf, { drafts: next, unsent: load(shelf, store).unsent }, store);
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
  shelf: Shelf,
  key: string,
  text: string,
  store: Store | null = defaultStore(),
): void {
  const filed = load(shelf, store);
  const kept = text.trim() ? text : undefined;
  // Nothing changed, nothing written. Every box files itself as it opens, empty
  // or not, and writing an unchanged record would copy an old repository-less
  // one under the new key on the strength of it merely having been looked at.
  if (filed.unsent[key] === kept) return;
  if (kept === undefined) delete filed.unsent[key];
  else filed.unsent[key] = kept;
  save(shelf, filed, store);
}

/** What was in a box that has now been sent. */
export function forget(
  shelf: Shelf,
  key: string,
  store: Store | null = defaultStore(),
): void {
  remember(shelf, key, "", store);
}

/** Sent is the one thing that is not a draft any more. */
export function clearAll(shelf: Shelf, store: Store | null = defaultStore()): void {
  save(shelf, { drafts: [], unsent: {} }, store);
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
