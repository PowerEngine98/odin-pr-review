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
 */

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
