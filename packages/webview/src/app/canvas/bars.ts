/**
 * Which folder bars are drawn, where each sits in the stack, and what it says.
 *
 * A folder box has a bar across its top, and the bars are held against the top
 * of the window as the reader scrolls past the cards they name — so a change
 * nested six folders deep stands six bars against the chrome and the drawing
 * begins a long way down a screen that is mostly labels. Collapsing a folder is
 * the answer: its bar leaves the stack and six bars become five.
 *
 * ## And that is the whole of what collapsing does
 *
 * Said as the reader said it: collapsing only serves to decrease the sticky
 * stack on the visible window, and a header should be visible where it belongs
 * while it has not yet joined that stack. So a folded box is drawn with the same
 * header an open one has, at the top of its own frame, in the same markup at the
 * same height — and the one thing it never does is slide down to hold itself
 * under the chrome. An open header does that only once the reader has scrolled
 * past the box's own top; a folded one never does it at all.
 *
 * What this module decides, then, is which headers may join the stack and how
 * far down it each of them sits. A box with no entry in the map below draws its
 * header exactly where its frame begins and is counted in nobody's slot, which
 * is what makes the bars beneath it come up by one.
 *
 * This used to be a different arrangement, and the difference is worth recording
 * because it read as a smaller change than it was. A folded box was given a
 * little pressable stub on its frame instead of a header — the same corner, a
 * different and smaller thing — on the argument that a full-width bar would say
 * the fold had not happened. It says no such thing. The reader can see perfectly
 * well that the stack against the top of the window is a header shorter, which
 * is the thing they asked for, and what the stub bought in exchange was a second
 * way of drawing a folder's name that had to be styled, hovered, measured and
 * tested alongside the first. The header is what belongs on a box, so a folded
 * box gets a header.
 *
 * ## When a bar says two folders' names, which turned out to be about scroll
 *
 * A folded folder's name is written into the bar of the nearest ancestor that
 * pins, for exactly as long as the folded folder's own header cannot be seen —
 * and not otherwise.
 *
 * So there are two states and the reader moves between them by scrolling.
 * `home`, folded inside an `app` that holds nothing else: while `home`'s header
 * is still down the page where `home`'s box begins, `app`'s bar reads `app` and
 * `home`'s header reads `home`, each naming its own frame and neither repeating
 * the other. Scroll on, and there comes a point where `home`'s header would have
 * had to start sliding down to stay under the chrome — where an open header
 * pins. A folded one does not pin, so from that point the name would simply pass
 * behind the bar and be gone. That is the moment `app`'s bar starts reading `app
 * / home`. Scroll back up and it reverts: `app` again, with `home`'s own header
 * reappearing at the top of `home`'s box.
 *
 * Said as the reader said it: once we would stack `home`, as it is collapsed and
 * the only sibling at sight, we absorb `home` in that moment — but going back,
 * the header returns from `app / home` to `app`, and `home`'s header appears
 * again.
 *
 * This is what collapsing is for, stated exactly rather than approximately.
 * `home` costs no line of chrome at any scroll position, which is the saving the
 * reader pressed the chevron for. And `home` is named at every scroll position:
 * by its own header while that header can be read, and by its ancestor's bar for
 * precisely the stretch when it cannot. Neither name is ever a second copy of the
 * other, because the two are never on screen at once.
 *
 * ### Which threshold, and why it must be borrowed rather than written
 *
 * "The header would have pinned" is not a rough stand-in for "the header has
 * gone off the top". It is the stack's own decision, and it is asked of the stack
 * rather than restated here: `pinHead` is the function that decides an open
 * header must slide, and a folded box is handed to it with the slot it would
 * have occupied had it drawn a bar, and a positive answer is the whole of the
 * test. Two spellings of one threshold is how a label comes to disagree with the
 * stack it is describing — the bar would say `app / home` while `home`'s header
 * was still plainly visible a few lines below it, or say `app` with nothing
 * anywhere naming the folder — and the disagreement would be a fraction of a
 * header wide, so it would be invisible at one zoom and obvious at another.
 * `heading.ts` owns that arithmetic and is not touched.
 *
 * The slot it would have occupied is the same count the drawn bars use, which is
 * why there is one function for it below. Folding a box does not change how many
 * of its ancestors draw, so the number is well defined for a box that has no bar.
 *
 * ### The three earlier answers, because every one of them is arrived at again
 *
 * It was built first so that a folded folder's name went into its parent's bar
 * unconditionally, which then read as a path — `common` became
 * `common/mediaGroup` — on the argument that the reader had to be told where the
 * cards went rather than left to conclude they sat directly inside `common`.
 * What that did on a real change was put four folders' worth of name on the one
 * bar at the top of the drawing whose job is to say `src`: `src / app / profile
 * / laborer`, read off an outermost box that had never been folded and could not
 * be. It was then taken out altogether, and a bar said the last segment of its
 * own path and nothing else, whatever was folded below it.
 *
 * Neither is quite it, and the reason is worth saying precisely, because "a bar
 * names its own box" sounds like a principle and is really only a symptom. What
 * was actually wrong with `src / app / profile / laborer` is that it was a false
 * statement about the frame it was drawn on. That box held `laborer`'s cards and
 * it held others besides — a card sitting directly in `src`, a second folder
 * beside `app` — and none of those are anywhere in that path, so the bar named a
 * thread through the box and presented it as a name for the whole box. A reader
 * who takes the label at its word looks for `profile` inside `app` and finds
 * four other things there too.
 *
 * The same concatenation is not a lie at all when nothing else is in the frame.
 * If `app` holds exactly one box, `home`, and `home` holds every card `app`
 * holds, then everything inside that frame is inside `app/home`, and `app/home`
 * is simply what the frame is — two words for one rectangle rather than one word
 * for a rectangle and another for a corner of it. So the third answer was that
 * rule: a parent absorbs a folded child's name only while the child is the sole
 * occupant of the parent as the drawing currently stands, and the walk stops at
 * the first step where it is not. That condition survives unchanged and is still
 * both halves of a conjunction below.
 *
 * What the third answer got wrong was smaller and only visible on a real page. It
 * absorbed whether or not the folded header could be seen, so the reader sitting
 * at the top of `app` was shown `app / home` on one bar and `home` on the header
 * three lines beneath it, and reported exactly that — the same folder named twice
 * over, a few pixels apart, when they had asked for less rather than more. The
 * name only needs carrying up to the stack while it cannot be read where it
 * belongs, which is the condition this module now applies.
 *
 * "As the drawing currently stands" means the boxes that were built, which is
 * after the reader's filters and after the part on screen — `FolderBox.nodes`
 * holds the cards that survived, which is why the count of them is what answers
 * the sole-occupancy half. That half does not depend on the viewport and must
 * not: which folder may be absorbed is a fact about the change, and only whether
 * it is absorbed yet is a fact about where the reader is.
 *
 * The full path is still the hover tip's answer, and the tip answers with the
 * deepest name on the bar rather than the box's own, since the deepest name is
 * what a reader hovering `app/home` is asking about.
 *
 * ### A folded folder is reachable at every scroll position, and that is the rule
 *
 * This is the failure the feature has already sprung once, when two folded
 * siblings under a parent that could absorb neither left two folders with no bar,
 * no segment and nothing anywhere that undid the gesture which removed them. The
 * two states above are exhaustive on purpose: while the header can be seen it
 * carries a chevron that unfolds the folder, and while it cannot the segment in
 * the ancestor's bar is a press that unfolds the same folder. There is no third
 * state, and the threshold that separates them is a single comparison rather than
 * two conditions that could both come out false.
 *
 * ## This now reads geometry, and still never writes it
 *
 * The box is still drawn. Every card is where it was, every box edge is where
 * it was, and `bandsFor` still reserves a pad and a header for every box that
 * opens at a band whether or not that box's bar is drawn. What is saved is
 * chrome — the height of the pinned stack, in window pixels — and not canvas
 * height. A reader who pressed a chevron to recover thirty pixels of label and
 * watched the entire picture re-flow underneath them would have been given a
 * much worse thing than the one they asked for, and would never press it again.
 *
 * What has changed is that a box's `y` and `height` are now read here, because a
 * label that depends on where the reader has scrolled to cannot be worked out
 * without them. Read is the whole of it. Nothing in this module returns a
 * geometry it was handed, altered — `headOf` passes two numbers straight through
 * and the walk below only compares them — and that restriction is the thing to
 * keep, because moving a box is the one thing collapsing must never do.
 *
 * That is also why this is a module of its own rather than an argument to
 * `place()`. Threading the folded set through the placement would re-run the
 * whole layout on every press, which is exactly the machinery that moves cards.
 * Here it cannot: this reads four fields off a box and answers a question about
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

import { pinHead, type Headed, type Held } from "./heading.js";

/**
 * Enough of a folder box to say where the bar across its top is drawn.
 *
 * `headOf` reads these two numbers and hands them straight on without touching
 * them, because the thing it is deciding is the third number beside them. What
 * is forbidden is a function in this module that *changes* a `y` or a `height`,
 * since moving a box is the one thing collapsing must never do, and that remains
 * forbidden however much of the geometry is read.
 */
export interface Framed {
  /** The folder, as a path. */
  path: string;
  /** The top of the box, in canvas units. */
  y: number;
  /** How tall it is, in canvas units. */
  height: number;
}

/**
 * Enough of a folder box to say whose bar is whose, and what it may say.
 *
 * Deliberately not `FolderBox` itself, and still deliberately so now that the
 * frame is part of it. The original argument was that everything about where a
 * box is drawn is irrelevant here, and a function that could see the geometry is
 * a function that could be tempted to adjust it. The first half of that has
 * stopped being true — a label that changes with the scroll has to know where the
 * box is before it can know whether the reader has gone past it — and the second
 * half has not stopped being true at all, which is why this is still the
 * narrowest thing that answers the question rather than the box the placement
 * built. There is no width here and no `x`, because nothing about a label is
 * horizontal; there is no list of card ids, only a count.
 */
export interface Barred extends Framed {
  /** How many boxes enclose it, counting itself. One for an outermost box. */
  depth: number;
  /**
   * The cards in it, and only how many of them there are.
   *
   * Absorbing a folded child's name into its parent's bar is allowed exactly
   * while the child holds everything the parent holds, so what is needed here is
   * the comparison of two counts. A child's cards are a subset of its parent's
   * by construction — a box is the cards under a path — so equal counts is the
   * same statement as "the parent has nothing of its own outside the child", and
   * it is the cheap way to say it.
   *
   * Typed as the length alone rather than as the ids, which a `string[]`
   * satisfies without anybody having to convert one. It is the same argument the
   * rest of this interface makes: this module decides what a label reads, so it
   * is handed the least that can answer that, and a list of ids sitting here
   * would be an invitation to start deciding something about particular cards.
   */
  nodes: { readonly length: number };
}

/** Enough of a folder box to say which cards have its bar above them. */
export interface Filled {
  /** The folder, as a path. */
  path: string;
  /** The cards inside it, by id, at whatever depth they sit. */
  nodes: readonly string[];
}

/**
 * A header that joins the pinned stack, and what the reader ends up reading on
 * it.
 *
 * "Bar" throughout this module means a header that pins, which is the only sort
 * there was when it was written. Every box has a header; only the ones with an
 * entry here are held against the top of the window.
 */
export interface Bar {
  /**
   * How many bars enclose this one, counting itself, and therefore how far
   * below the chrome it is held when the stack is against the top of the
   * window. One for a bar with nothing above it.
   *
   * The twin of `depth` and not the same number: it counts only the bars that
   * are actually drawn, so folding a middle folder moves every bar below it up
   * by one without any box having moved at all.
   *
   * It does not depend on the scroll, unlike the label beside it. Where a bar
   * sits in the stack is a fact about what is folded; what it says is a fact
   * about what the reader can currently see. Keeping the two apart is what lets
   * the whole of `headOf`, `pinOf` and `barsAbove` below carry on being
   * arithmetic about folding with no view in them at all.
   */
  slot: number;
  /**
   * What the bar says: its own folder's name, and then the name of every folded
   * folder whose own header has gone behind the stack and which turned out to be
   * the whole of what this box contains.
   *
   * A single name on nearly every bar, because nearly every box holds more than
   * one thing. A path — `app/home` — only where the walk below could say the
   * path is a true name for the entire frame *and* `home`'s own header is no
   * longer readable where it belongs, which the module doc-comment argues at the
   * length the argument deserves.
   *
   * So this changes as the reader scrolls, and that is the one thing about it
   * that is genuinely surprising. It is not a label moving under somebody's eye:
   * the extra segment appears at the moment the name it duplicates disappears
   * behind the chrome, so what the reader sees is one name being handed upwards
   * rather than a second name arriving. Said as a field rather than left to the
   * component to take off the box it happens to have, so that what a bar reads
   * is decided in the one place that decides whether it is drawn at all.
   */
  label: string;
  /**
   * The folders folded into that label, nearest first.
   *
   * Full paths and not names, because this is what makes an absorbed fold
   * reversible: the label is drawn as separate pressable segments and a press
   * has to say which folder to unfold, which a bare name cannot — a change with
   * `src/hooks` and `test/hooks` in it has two folders called `hooks`.
   *
   * Empty on a bar that absorbed nothing, which is most of them at most scroll
   * positions. What is in here is load-bearing for reachability and is the
   * second of exactly two ways a folded folder is ever named: while its own
   * header can be read it carries a chevron of its own, and while it cannot its
   * name is a segment up here. The two states are separated by a single
   * comparison, so there is no arrangement in which a folder is in neither.
   *
   * The last of them is also the deepest, which is what the hover tip shows: a
   * bar reading `app/home` is asked "where is this" and the honest answer is
   * where `home` is, not where `app` is.
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
 * A box with no entry is a box whose header never joins the stack. It is still a
 * box, it is still drawn, and it still carries a header across its own top
 * saying its own name — what it does not do is hold that header against the top
 * of the window, and what it does not have is a place in anybody's slot. The
 * folded set is not consulted a second time downstream, because a box is missing
 * from this map only if it was folded, which is the whole of `draws` below:
 * asking the set again would be a second answer to a question this map has
 * already answered, free to disagree with it.
 *
 * An outermost box always draws, whatever the reader has folded. There is no bar
 * above it, so folding it buys a line of chrome by leaving the whole drawing
 * unheaded — every bar below it is about some corner of the change and this is
 * the only one that says what the change is in. The component offers no chevron
 * on one for the same reason, and this says it again where a fold stored by an
 * older reading, or by a version of this that allowed it, cannot get round it.
 *
 * `held` is where the reader is, and it is required rather than optional on
 * purpose. It only affects the labels — every slot, every entry in the map and
 * therefore every number the arithmetic downstream is fed is the same whatever
 * is passed — so an optional view would be a parameter that could be left off
 * with no test failing and no error thrown, and the only symptom would be a
 * folded folder whose name never went anywhere as the reader scrolled past it.
 * That is precisely the class of fault this feature keeps producing, so the
 * caller is made to say where the reader is.
 */
export function barsFor(
  boxes: readonly Barred[],
  folded: ReadonlySet<string>,
  held: Held,
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
        other.depth === box.depth + 1 && other.path.startsWith(`${box.path}/`),
    );

  /*
   * How far down the stack a box's header sits, or would sit.
   *
   * Counted over the boxes that draw rather than over all of them, which is the
   * entire saving: fold the middle of a three-deep nest and the innermost bar is
   * handed slot two instead of slot three, so it is held one header higher
   * against the chrome. Its box has not moved by a unit.
   *
   * Asked of folded boxes too, which is why it is a function rather than a loop
   * inline below. A folded box has no slot in the sense of occupying one, but it
   * has a perfectly well defined answer to "which line would you be held on" —
   * folding a box does not change how many of its ancestors draw — and that line
   * is what decides whether its own header has gone behind the stack.
   */
  const slotOf = (box: Barred): number => {
    let slot = 1;
    for (const other of boxes) {
      if (box.path.startsWith(`${other.path}/`) && draws(other)) slot += 1;
    }
    return slot;
  };

  /*
   * Whether a box's header can no longer be read where it belongs.
   *
   * The stack's own threshold, asked of the stack. `pinHead` is what decides an
   * open header must start sliding down its box to stay under the chrome; a
   * positive answer for a folded box is the statement that an open header in
   * this position would be sliding, which is exactly the position in which a
   * folded one — which never slides — has passed behind the bar above it and
   * stopped being a name the reader can see or press.
   *
   * Written out here instead as some comparison of a box's top against
   * `chromeBottom`, it would be a second opinion about a line the stack already
   * has an opinion about, and the two would differ by the fraction of a header
   * that the rounding inside `headLine` accounts for. A label that flipped a few
   * pixels early would put `app / home` on a bar while `home` was still legible
   * underneath it; a label that flipped a few pixels late would leave a stretch
   * with the folder named nowhere. Both are invisible at one zoom.
   */
  const behindTheStack = (box: Barred): boolean =>
    pinHead(held, { y: box.y, height: box.height, depth: slotOf(box) }) > 0;

  const bars = new Map<string, Bar>();

  for (const box of boxes) {
    if (!draws(box)) continue;

    const slot = slotOf(box);

    /*
     * And what it says, walked down through the folded folders that are the
     * whole of what this box turns out to contain and whose own headers have
     * gone behind the stack.
     *
     * Three conditions per step and the walk stops the moment any fails. The
     * first is that there is exactly one box inside this one and it draws no
     * bar: more than one and there is no single name to append, none and there
     * is nothing below to say anything about, and one that draws its own bar is
     * already saying its name for itself a header lower. The second is that the
     * child holds every card the parent holds, which is what makes the label a
     * true statement about the frame rather than a true statement about a thread
     * running through it — absorb `home` into `app` while `app` also holds a
     * card of its own and the bar across the whole rectangle reads `app/home`
     * over cards that are in neither, which is the `src / app / profile /
     * laborer` failure with fewer words in it.
     *
     * The third is the new one and it is the reader's complaint: the child's own
     * header must have gone behind the stack. While it has not, the child is
     * saying its own name on its own frame perfectly legibly a few lines down the
     * page, and a segment up here is the same word twice a few pixels apart on a
     * drawing the reader collapsed a folder to quieten.
     *
     * There is nothing here that has to choose between two children, which the
     * first version of this needed a degradation rule for and had to have proved
     * deterministic over every order the boxes might arrive in. Two children is
     * not an ambiguity to resolve now; it is a frame with two things in it, and
     * the rule above declines it for the same reason it declines a stray card.
     */
    const absorbed: string[] = [];
    const parts = [nameOf(box.path)];
    let at = box;
    for (;;) {
      const inside = childrenOf(at);
      if (inside.length !== 1) break;
      const only = inside[0]!;
      if (draws(only)) break;
      if (only.nodes.length !== at.nodes.length) break;
      if (!behindTheStack(only)) break;
      at = only;
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
 * box.depth` here, which read as caution and was a bug: a box that does not join
 * the stack holds nothing under the chrome at all, since its header stays at the
 * top of its own frame, so anything worked out from a depth here is an offset
 * for a position nothing is in. It was the hover tip that reached it, and the tip
 * was pushed down the screen by headers that were not there, by exactly as many
 * as the folder was deep. A caller that gets nothing has to decide what to do
 * about it, which is the point — and `pinOf` below is that decision, made once.
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
 * How far a box's header slides down its own frame to stay under the chrome,
 * which for a folded box is not at all.
 *
 * This is the principle itself, in one number. A header is drawn at the top of
 * the box it names, and while the reader scrolls past that box an open header
 * follows the chrome down so that something on screen still says which folder
 * these cards are in. Folding takes that away and takes away nothing else: the
 * header stays where the box is, and when the box has scrolled by, it goes with
 * it. Nought here is the whole of what the reader bought.
 *
 * It is also the moment the name goes up to the bar above, where the folder is
 * that bar's sole occupant — `barsFor` asks `pinHead` the same question about
 * the same box to decide that, so the two cannot come apart. What is nought here
 * is exactly what is absorbed there.
 *
 * It is a function in this module rather than four lines in the component for
 * the reason the two above it are, and it is the strongest case of the three.
 * Written inline it read `const head = headOf(bars, box); if (!head) return 0;`
 * — a guard clause, in a `.svelte` file, in a repository that mounts no
 * components — and deleting a guard clause because the fallback below it looks
 * harmless is the single easiest way for a folded header to start pinning again.
 * Here the claim "a folded header never joins the stack" is a thing a test can
 * hold at three zooms, which is what it took to catch this fault the last time.
 *
 * The arithmetic is still `heading.ts`'s and is not touched. What is decided
 * here is only whether to ask it.
 */
export function pinOf(
  bars: ReadonlyMap<string, Bar>,
  box: Framed,
  held: Held,
): number {
  const head = headOf(bars, box);
  if (!head) return 0;
  return pinHead(held, head);
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
 * Unaffected by the scroll, which is worth saying because the labels next door
 * are not. Absorbing a name into a bar does not add a bar, so no card's title
 * moves when the reader crosses the threshold that changes what a bar says.
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
