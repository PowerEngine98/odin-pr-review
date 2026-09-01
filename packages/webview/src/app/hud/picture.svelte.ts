/**
 * The picture being looked at, full size, over everything.
 *
 * Pictures arrive in the page at the size of the thing holding them: a
 * screenshot pasted into the agent console is a hundred pixels tall in a panel
 * that is four hundred wide, and a screenshot is the one kind of content where
 * that is useless — it is a picture of a screen, and every word on it is at a
 * fifth of the size it was written at. The reader's only recourse was to find
 * the file on disk.
 *
 * So one at a time, held here rather than in whichever panel it came from: the
 * viewer covers the whole window, and a component owned by a panel cannot cover
 * the panel it lives in.
 */
export interface Shown {
  src: string;
  /** What it is, for the reader and for anything reading the page aloud. */
  alt: string;
}

const state = $state<{ shown: Shown | null }>({ shown: null });

/** The picture on show, or nothing. */
export function shownPicture(): Shown | null {
  return state.shown;
}

/** Show one. Called from wherever a picture is drawn small. */
export function showPicture(src: string, alt = ""): void {
  if (!src) return;
  state.shown = { src, alt };
}

/** Put it away. */
export function hidePicture(): void {
  state.shown = null;
}
