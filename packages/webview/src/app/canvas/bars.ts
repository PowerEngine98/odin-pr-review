/**
 * Which folder bars are drawn, where each sits in the stack, and what it says.
 *
 * A folder box has a bar across its top, and the bars are held against the top
 * of the window as the reader scrolls past the cards they name — so a change
 * nested six folders deep stands six bars against the chrome and the drawing
 * begins a long way down a screen that is mostly labels. Collapsing a folder is
 * the answer: its bar leaves the stack and six bars become five. The box is
 * still drawn, and `Clusters.svelte` leaves a small stub on its frame saying
 * which folder it is, so what the reader gives up is a line of chrome and
 * nothing else.
 *
 * ## A bar reads its own folder's name, and concatenation is not coming back
 *
 * This was built the other way round first, and the record of that is here so
 * that nobody rebuilds it. A folded folder's name used to be folded into its
 * parent's bar, which then read as a path — `common` became `common/mediaGroup`
 * — on the argument that the reader had to be told where the cards went rather
 * than left to conclude they sat directly inside `common`. What it actually did
 * was put four folders' worth of name on the one bar at the top of the drawing
 * whose job is to say `src`: `src / app / profile / laborer`, read off an
 * outermost box that had never been folded and could not be. A path belongs to
 * the box it names and not to the bar of a box that merely contains it.
 *
 * So a bar says the last segment of its own path, always, whatever is folded
 * below it, and there is no rule here for joining two names together. The full
 * path has not gone anywhere: the hover tip answers with it, and that is now the
 * only place it appears, which is why it matters more than it did.
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
   * What the bar says: the last segment of its own folder's path, and nothing
   * else.
   *
   * Never a path, however much is folded below it, for the reason the module
   * doc-comment gives at length. Said as a field rather than left to the
   * component to take off the box it happens to have, so that what a bar reads
   * is decided in the one place that decides whether it is drawn at all.
   */
  label: string;
}

/** The last segment of a path, which is what a folder is called. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The bars, by the path of the box each belongs to.
 *
 * A box with no entry draws no bar. It is still a box and it is still drawn,
 * and `Clusters.svelte` puts a stub on its frame — a missing entry here is the
 * whole of how it knows to, and the whole of the way back. The folded set is not
 * consulted a second time downstream, because a box draws no bar only if it was
 * folded, which is the whole of `draws` below: asking the set again would be a
 * second answer to a question this map has already answered, free to disagree
 * with it.
 *
 * An outermost box always draws, whatever the reader has folded. There is no bar
 * above it, so folding it buys a line of chrome by leaving the whole drawing
 * unheaded — every bar below it is about some corner of the change and this is
 * the only one that says what the change is in. The component offers no chevron
 * on one for the same reason, and this says it again where a fold stored by an
 * older reading, or by a version of this that allowed it, cannot get round it.
 */
export function barsFor(
  boxes: readonly Barred[],
  folded: ReadonlySet<string>,
): Map<string, Bar> {
  const draws = (box: Barred): boolean =>
    box.depth === 1 || !folded.has(box.path);

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
     * And what it says, which is its own folder's name and is not a question.
     *
     * There was a walk here once, stepping down through the folded boxes below
     * this one and appending each name, so that a folded folder's name lived on
     * in its parent's bar. It is gone on purpose and the module doc-comment
     * above says why at the length the argument deserves. What is worth
     * repeating here, where somebody would put it back, is that the walk had no
     * answer for two folded children of one parent and had to degrade on them —
     * and that the case which sank it was not that one at all but the ordinary
     * one, a bar at the top of the drawing reading four folders deep because
     * somebody had folded four folders under it.
     */
    bars.set(box.path, { slot, label: nameOf(box.path) });
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
 * could reach it is the hover tip, which asks where a name sits in order to put
 * itself under it, and a box with no bar holds nothing under the chrome at all —
 * its name is on a stub at the top of its own frame, where the drawing has taken
 * it. So the tip was pushed down the screen by headers that were not there, by
 * exactly as many as the folder was deep. A caller that gets nothing has to
 * decide what to do about it, which is the point.
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
 * it has bars above it, and charged for the box it starts a header lower than
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

/*
 * There was a `stranded` here, and the reason it is not is worth a line.
 *
 * It named the folded folders whose names had ended up in no bar at all, which
 * while a parent could absorb a child's name was a genuinely awkward subset: a
 * folded folder usually had its name in the bar above and pressable there, and
 * only the pair of siblings the absorbing refused to choose between fell through
 * to a stub. With nothing absorbed anywhere, every folded box is in that
 * position, so the set it returned is exactly the boxes `barsFor` gave no bar —
 * a question the map already answers by a lookup, and a second function
 * answering it is a second thing to keep in step. `Clusters.svelte` asks for a
 * bar and draws a stub where there is none, in the same breath, which is also
 * what makes it impossible for a box to end up with both or neither.
 */
