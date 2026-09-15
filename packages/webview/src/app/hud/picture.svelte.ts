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
 *
 * A drawing an agent made is the same complaint word for word. A mermaid graph
 * of how a change hangs together is a picture of a screenful of boxes, drawn
 * inside a console four hundred pixels wide, and a reader could get a proper
 * look at one only by dragging it out onto the canvas and keeping it — which is
 * a decision about the review, not a way of reading something. Pressing it now
 * opens it here, exactly as pressing a screenshot does, and dragging still pins
 * it.
 *
 * One field for both, because there is one viewer and it can only be showing
 * one thing: opening a drawing puts away the picture that was up, and the other
 * way round.
 */
export interface Shown {
  src: string;
  /** What it is, for the reader and for anything reading the page aloud. */
  alt: string;
}

/** A drawing on show: the mermaid source, which is what a drawing is here. */
export interface Drawing {
  code: string;
}

const state = $state<{ shown: Shown | null; drawn: Drawing | null }>({
  shown: null,
  drawn: null,
});

/** The picture on show, or nothing. */
export function shownPicture(): Shown | null {
  return state.shown;
}

/** The drawing on show, or nothing. */
export function shownDrawing(): Drawing | null {
  return state.drawn;
}

/** Show one. Called from wherever a picture is drawn small. */
export function showPicture(src: string, alt = ""): void {
  if (!src) return;
  state.drawn = null;
  state.shown = { src, alt };
}

/** The same, for a drawing. Called from wherever a diagram is drawn small. */
export function showDrawing(code: string): void {
  if (!code) return;
  state.shown = null;
  state.drawn = { code };
}

/** Put it away, whichever of the two it was. */
export function hidePicture(): void {
  state.shown = null;
  state.drawn = null;
}
