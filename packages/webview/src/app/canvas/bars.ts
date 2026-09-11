/**
 * Which folder bars are drawn, where each sits in the stack, and what it says.
 *
 * A folder box has a bar across its top, and the bars are held against the top
 * of the window as the reader scrolls past the cards they name — so a change
 * nested six folders deep stands six bars against the chrome and the drawing
 * begins a long way down a screen that is mostly labels. Collapsing a folder is
 * the answer: its own bar goes away and its name is folded into its parent's,
 * which then reads as a path. Six bars become five, and `common` becomes
 * `common/mediaGroup`.
 *
 * ## Nothing here is geometry, and that is the whole point
 *
 * The box is still drawn. Every card is where it was, every box edge is where
 * it was, and `bandsFor` still reserves a pad and a header for every box that
 * opens at a band whether or not that box's bar is drawn. What is saved is
 * chrome — the height of the pinned stack, in window pixels — and not canvas
 * height. A reader who pressed a chevron to recover thirty pixels of label and
 * watched the entire picture re-flow underneath them would have been given a
 * much worse thing than the one they asked for, and would never press it again.
 *
 * That is also why this is a module of its own rather than an argument to
 * `place()`. Threading the folded set through the placement would re-run the
 * whole layout on every press, which is exactly the machinery that moves cards.
 * Here it cannot: this reads two fields off a box and answers a question about
 * labels.
 *
 * ## Why a second number, and not a smaller `depth`
 *
 * The obvious implementation is to recompute `FolderBox.depth` with the folded
 * boxes left out, since depth is what the stacking steps by. It is also a
 * silent disaster. `depth` means "how many boxes enclose this one, counting
 * itself", and `placement.ts` leans on that meaning in a dozen places — it
 * finds a box's parent with `other.depth === box.depth - 1` and its children
 * with `other.depth === box.depth + 1`, it sorts outermost-first by it twice,
 * and it charges each box a corridor of `under - box.depth` levels. Give a
 * parent and a child equal depths and the parent stops finding the child, so
 * the child is never held inside the parent's edge and is drawn out through it.
 * Nothing throws. The boxes simply come out wrong, on somebody else's
 * repository, in a way that reads as a rendering bug rather than as a number
 * that was quietly redefined under the code that depends on it.
 *
 * So `depth` is left alone and this is a different quantity with a different
 * name. `depth` counts boxes; `slot` counts bars. They agree exactly when
 * nothing is folded, which is the ordinary case and the reason the confusion is
 * so easy to make.
 *
 * ## What the arithmetic downstream does with it
 *
 * Nothing it did not already do. `heading.ts` is handed `slot` where it used to
 * be handed `depth`, and a count of the bars above a card where it used to be
 * handed a count of the boxes around it. Its formulas are untouched, on
 * purpose: the conversion between the bar's window pixels and a header's canvas
 * units is the part of this feature that has been got wrong before and it is
 * now measured at several zooms, so the way to keep it right is to feed it a
 * different number rather than to teach it a new sum.
 *
 * ## Which is why the feeding is done here and not in the component
 *
 * Feeding it a different number is a decision, and a decision written inline in
 * a `.svelte` file is a decision nothing can test. That was demonstrated rather
 * than assumed: with the choice spelled out in `Clusters.svelte` as `depth:
 * bars.get(box.path)?.slot ?? box.depth`, replacing it with `depth: box.depth` —
 * handing the arithmetic the old number, which is the single most likely
 * regression this feature has — left every one of the twelve tests beside it
 * passing. The tests exercised the modules and the components were the part
 * nobody was holding. `headOf` and `barsAbove` below are that decision lifted
 * out whole, so that the component is left with a call and no arithmetic and no
 * choice, and so that feeding a depth where a slot belongs is a thing a test can
 * see. It is the argument `heading.ts` makes for its own existence, made once
 * more a layer up.
 */

import type { Headed } from "./heading.js";

/**
 * Enough of a folder box to say whose bar is whose.
 *
 * Two fields, and deliberately not `FolderBox` itself. Everything about where a
 * box is drawn is irrelevant here, and a function that could see the geometry
 * is a function that could be tempted to adjust it — which is the one thing
 * collapsing must never do.
 */
export interface Barred {
  /** The folder, as a path — `src/components/media`. Never empty. */
  path: string;
  /** How many boxes enclose it, counting itself. One for an outermost box. */
  depth: number;
}

/**
 * Enough of a folder box to say where the bar across its top is drawn.
 *
 * The geometry the doc-comment above says is irrelevant here, and it still is:
 * `headOf` reads these two numbers and hands them straight on without touching
 * them, because the thing it is deciding is the third number beside them. What
 * is forbidden is a function in this module that *changes* a `y` or a `height`,
 * since moving a box is the one thing collapsing must never do, and that remains
 * forbidden.
 */
export interface Framed {
  /** The folder, as a path. */
  path: string;
  /** The top of the box, in canvas units. */
  y: number;
  /** How tall it is, in canvas units. */
  height: number;
}

/** Enough of a folder box to say which cards have its bar above them. */
export interface Filled {
  /** The folder, as a path. */
  path: string;
  /** The cards inside it, by id, at whatever depth they sit. */
  nodes: readonly string[];
}

/** A bar that is drawn, and what the reader ends up reading on it. */
export interface Bar {
  /**
   * How many bars enclose this one, counting itself, and therefore how far
   * below the chrome it is held when the stack is against the top of the
   * window. One for a bar with nothing above it.
   *
   * The twin of `depth` and not the same number: it counts only the bars that
   * are actually drawn, so folding a middle folder moves every bar below it up
   * by one without any box having moved at all.
   */
  slot: number;
  /**
   * What the bar says, with any folded folders below it folded in.
   *
   * A path rather than a name once anything has been absorbed — `common`
   * becomes `common/mediaGroup` — because the folded folder still exists, still
   * has a box drawn around it, and the reader needs to be told where its cards
   * went rather than left to conclude they are directly inside the parent.
   */
  label: string;
  /**
   * The folders folded into that label, nearest first.
   *
   * Full paths and not names, because this is what makes the fold reversible:
   * the label is drawn as separate pressable segments and a press has to say
   * which folder to unfold, which a bare name cannot — a change with
   * `src/hooks` and `test/hooks` in it has two folders called `hooks`.
   *
   * The last of them is also the deepest, which is what the hover tip shows: a
   * bar reading `common/mediaGroup` is asked "where is this" and the honest
   * answer is where `mediaGroup` is, not where `common` is.
   */
  absorbed: string[];
}

/** The last segment of a path, which is what a folder is called. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The bars, by the path of the box each belongs to.
 *
 * A box with no entry draws no bar. It is still a box and it is still drawn;
 * its name has gone into its parent's bar, or — in the one case below where it
 * cannot — into nothing at all.
 *
 * An outermost box always draws, whatever the reader has folded, because there
 * is no bar above it for its name to be folded into. Folding it would delete
 * the name rather than move it, and the reader would be looking at an unnamed
 * frame with no way of discovering what it was.
 */
export function barsFor(
  boxes: readonly Barred[],
  folded: ReadonlySet<string>,
): Map<string, Bar> {
  const draws = (box: Barred): boolean =>
    box.depth === 1 || !folded.has(box.path);

  /*
   * The boxes directly inside one, which is a question about boxes and not
   * about folders.
   *
   * A box's depth is one more than the number of boxes enclosing it, so a box
   * enclosed by this one and no deeper is a direct child — the same relation
   * `placement.ts` uses to find a box's brood, read the same way, because the
   * two disagreeing about who is inside whom is how a label comes to name a
   * folder that is not there.
   *
   * The levels in between that were never drawn do not appear and must not: a
   * path may run five folders deep and be drawn as two boxes, and a label that
   * walked path segments rather than boxes would announce folders the reader
   * cannot see and has no box to look for.
   */
  const childrenOf = (box: Barred): Barred[] =>
    boxes.filter(
      (other) =>
        other.depth === box.depth + 1 &&
        other.path.startsWith(`${box.path}/`),
    );

  const bars = new Map<string, Bar>();

  for (const box of boxes) {
    if (!draws(box)) continue;

    /*
     * How far down the stack this bar sits, counted in bars above it.
     *
     * Counted over the boxes that draw rather than over all of them, which is
     * the entire saving: fold the middle of a three-deep nest and the innermost
     * bar is handed slot two instead of slot three, so it is held one header
     * higher against the chrome. Its box has not moved by a unit.
     */
    let slot = 1;
    for (const other of boxes) {
      if (box.path.startsWith(`${other.path}/`) && draws(other)) slot += 1;
    }

    /*
     * And what it says, walked down through whatever has been folded into it.
     *
     * One step per folded folder, appending each name, so `a` with `b` and `c`
     * folded beneath it reads `a/b/c`. The walk follows boxes rather than path
     * segments for the reason above, and it stops the moment the next step is
     * ambiguous.
     *
     * That ambiguity is the interesting case. Two folded children cannot both
     * be folded into one parent bar: there is one bar and two names, and any
     * rule for picking between them — the first in the array, the shortest, the
     * one that sorts first — is a rule the reader cannot see. Worse, the first
     * in the array is not a rule at all but an accident of how the boxes were
     * built, so the bar would read `common/mediaGroup` on one repository and
     * `common/util` on another with the same shape, and neither would be wrong
     * in a way anybody could report. So the walk degrades instead: on the first
     * step with more than one folded child it stops and appends nothing, the
     * parent reads its own name alone, and the two folded boxes keep their
     * frames and their cards and say nothing. Deterministic whatever order the
     * boxes arrive in, which is the property being bought.
     */
    const absorbed: string[] = [];
    const parts = [nameOf(box.path)];
    let at = box;
    for (;;) {
      const hidden = childrenOf(at).filter((child) => !draws(child));
      if (hidden.length !== 1) break;
      at = hidden[0]!;
      absorbed.push(at.path);
      parts.push(nameOf(at.path));
    }

    bars.set(box.path, { slot, label: parts.join("/"), absorbed });
  }

  return bars;
}

/**
 * Where this box's name is held under the bar, or nothing where it draws none.
 *
 * The whole of this function is the third field, and the third field is the
 * whole of what collapsing changes downstream. `depth` counts the boxes around
 * this one; the pinned stack is made of the bars that are drawn, and a folded
 * folder contributes a box to the first and no bar to the second. Handed a
 * `depth` here, a bar sitting below a folded one is held a header lower than the
 * bar it actually sits under, so a strip of the drawing shows through a stack
 * that is meant to be solid and the thirty pixels the reader folded the folder
 * to recover are not recovered at all.
 *
 * `Headed`'s field is called `depth` because that is what it was always fed and
 * renaming it would reach into arithmetic that is deliberately not being
 * touched. That name is exactly why this belongs in a function rather than in an
 * object literal in a template: a field called `depth` sitting beside a `box`
 * that has a `depth` is an invitation, and somebody will accept it.
 *
 * Nothing rather than a fallback where no bar is drawn. There used to be a `??
 * box.depth` here, which read as caution and was a bug: the only caller that
 * could reach it is the hover tip, which asks where a name sits in order to
 * put itself under it, and a box with no name has none — so the tip was pushed
 * down the screen by headers that were not there, by exactly as many as the
 * folder was deep. A caller that gets nothing has to decide what to do about it,
 * which is the point.
 */
export function headOf(
  bars: ReadonlyMap<string, Bar>,
  box: Framed,
): Headed | undefined {
  const bar = bars.get(box.path);
  if (!bar) return undefined;
  return { y: box.y, height: box.height, depth: bar.slot };
}

/**
 * How many bars stand above each card, by the card's id.
 *
 * What a card's own title has to clear before it may start. Not how deep its
 * path is — the levels that hold one thing each are never drawn as boxes, and
 * counting path segments pushed every title down past headers that are not on
 * screen. Nor how many boxes hold it, which was the same number right up until a
 * bar could be folded away: a card inside a folded folder has one box more than
 * it has names above it, and charged for the box it starts a header lower than
 * anything it needs to clear, leaving a strip of nothing between the stack and
 * the file's name.
 *
 * Counted over the boxes that hold the card rather than over its path, and only
 * over the ones that draw, which is the same rule `headOf` applies one card
 * higher up. The two have to agree exactly: a card begins under the last bar
 * above it, so two opinions about how many bars that is put a file's name on a
 * folder's.
 *
 * A card with no entry has no bar above it at all, which is not the same as not
 * having been asked, so the caller reads a missing entry as nought.
 */
export function barsAbove(
  boxes: readonly Filled[],
  bars: ReadonlyMap<string, Bar>,
): Map<string, number> {
  const over = new Map<string, number>();
  for (const box of boxes) {
    if (!bars.has(box.path)) continue;
    for (const id of box.nodes) over.set(id, (over.get(id) ?? 0) + 1);
  }
  return over;
}

/**
 * The folded folders whose names now appear nowhere at all.
 *
 * Ordinarily a folded folder has not lost its name, it has lent it to the bar
 * above — `common` reads `common/mediaGroup`, and the `mediaGroup` half of that
 * is pressable, so the fold undoes itself where it was made. The exception is
 * the case `barsFor` degrades on. Two folded children of one parent cannot both
 * be folded into one bar, so the parent says its own name and absorbs neither,
 * and at that moment two folders have no bar, no segment in anybody else's bar,
 * and no mention in the hover tip — which answers with the parent's path. The
 * reader who folded the second of the two siblings has not shortened the stack
 * by one more name; they have deleted two names from the drawing with a gesture
 * that undid nothing and offered no way back.
 *
 * So they are named here, and `Clusters.svelte` draws a stub on each one's own
 * frame. The frame is still drawn for every box, folded or not, which is what
 * makes there be somewhere to put it.
 *
 * The folded set is not an argument, because it cannot disagree with the bars
 * and would be a second chance to. A box draws no bar only if it was folded —
 * that is the whole of `draws` — so a missing bar already says folded, and
 * asking the set again is asking a question the map has answered.
 */
export function stranded(
  boxes: readonly Barred[],
  bars: ReadonlyMap<string, Bar>,
): Set<string> {
  const spoken = new Set<string>();
  for (const bar of bars.values()) {
    for (const path of bar.absorbed) spoken.add(path);
  }
  const lost = new Set<string>();
  for (const box of boxes) {
    if (!bars.has(box.path) && !spoken.has(box.path)) lost.add(box.path);
  }
  return lost;
}
