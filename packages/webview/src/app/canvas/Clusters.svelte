<!--
  The folders, drawn as boxes around the cards that live in them.

  Behind everything: a box is a place the cards are in, and one drawn over them
  would be a pane of glass across the thing the reader came to look at. It is
  told apart from a card by being fainter and by holding others, rather than by
  being drawn in a different kind of line.

  Nothing here is placed. The banding puts a folder's cards in the same run of
  canvas in every column, which is what makes a folder a rectangle at all, and
  these are the rectangles they came out as. A box with a position of its own
  would be a second opinion about where a folder is.
-->
<script lang="ts">
  import { setFolded, view } from "../state.svelte.js";

  import { pinOf, type Bar } from "./bars.js";
  import { CLUSTER_HEAD } from "./heading.js";
  import type { FolderBox } from "./placement.js";

  let {
    folders = [],
    /**
     * Which boxes draw a bar, where each sits in the stack, and what it says.
     *
     * Worked out once above and handed down rather than derived here. The same
     * answer decides how far a card's own title is pushed down the window, and
     * that is computed in the canvas — two derivations of "how many names are
     * above this" is how a file's name comes to sit on a folder's.
     *
     * A box with no entry here still draws its header, in the same markup and
     * at the same height as every other one; what it does not do is join the
     * stack held against the top of the window, and what it does not have is a
     * place in anybody's slot. That is the whole of what the reader bought by
     * folding it. Its frame is drawn either way, in the loop below that draws
     * every box: collapsing takes a header out of the stack, it does not remove
     * a folder, and a box that vanished when its bar did would be the reader
     * losing the grouping they were using to read the change.
     */
    bars = new Map<string, Bar>(),
    /**
     * What the reader can see, in canvas units.
     *
     * A folder box is routinely wider than the window — that is what makes it a
     * folder rather than a card — so panning right takes its left edge, and its
     * name with it, off the side of the screen. The same thing happens to a
     * card, and this is the same answer: the name slides along its own bar.
     */
    viewLeft = 0,
    viewRight = 0,
    /**
     * The bottom of the bar across the top, in window pixels.
     *
     * The same number the cards are given, and for the same reason: it is where
     * the drawing stops being visible, and the header has to stay under it.
     */
    chromeBottom = 0,
  }: {
    folders?: FolderBox[];
    bars?: Map<string, Bar>;
    chromeBottom?: number;
    viewLeft?: number;
    viewRight?: number;
  } = $props();

  /**
   * How far a name slides along its own header to stay in view.
   *
   * Horizontally, and stopping at the far end of the box rather than following
   * the window for ever, on the same terms as the vertical pin: a folder's name
   * never outlives the box it is about. Left alone, a reader panning through a
   * wide folder has a rule across the top of the screen and nothing saying which
   * folder it is.
   *
   * It applies to a folded box's header as much as to an open one's, which is
   * worth saying because the vertical pin does not. The two are not the same
   * question. The pin is about the stack against the top of the window, which is
   * exactly what folding is for; the slide is about a box being wider than the
   * screen, which a folded box is just as often as an open one — and a name
   * stranded off the left edge of a folder the reader is panning across is a name
   * they cannot read and a chevron they cannot press, whatever the fold did.
   */
  function slide(box: FolderBox): number {
    if (!viewLeft && !viewRight) return 0;
    const off = Math.max(0, viewLeft - box.x);
    if (off <= 0) return 0;
    const room = said[box.path] ?? 0;
    // Not laid out yet, so there is no honest answer to how much room the name
    // needs. Nought rather than a guess: a name that has not moved is merely
    // where it started, and a name allowed to slide on a width of zero would
    // travel the whole length of the box on the first frame and jump back once
    // the browser reported. `Card.svelte` refuses the same question the same
    // way for the same reason.
    if (!room) return 0;
    // Never past the point where the name would leave the box's far end: the
    // header is the folder's, and a name pinned beyond it belongs to nothing.
    return Math.min(off, Math.max(0, box.width - room));
  }

  /**
   * How much room each name actually takes, measured rather than assumed.
   *
   * This was a constant — a hundred and eighty units, standing for an icon, a
   * short name and a count — and a guess at how wide a name is, is wrong on
   * every name that is not the one it was guessed from. A folder called
   * `presentationComponents` is several times that guess, so the clamp let the
   * name go on travelling long after it should have stopped, and
   * `.cluster-head { overflow: hidden }` ate the tail without a word. The reader
   * panning across a wide folder watched its name walk off the end of its own
   * bar, which is the exact failure the sliding exists to prevent, arriving by
   * the door left open to fix it. The browser has already laid the name out and
   * knows exactly how wide it is; there is no reason to ask anybody else.
   *
   * The number bound here is a pre-transform layout width, which means it is
   * already in canvas units — the same units `box.width` and the slide are in.
   * It must not be divided by the zoom on the way past. Scaling it "for the
   * zoom" is the very fault `heading.ts` was split out to make impossible, and
   * it would look right at scale one and at no other.
   *
   * Keyed by path rather than by index because the boxes are keyed by path in
   * every loop below, and an index would rebind a measurement onto a different
   * folder the first time a rebuild reordered them.
   */
  let said: Record<string, number> = $state({});

  /**
   * How far a header slides down its own box to stay in view.
   *
   * The card's problem exactly, and the card's answer: the canvas is one
   * transformed layer, so there is no scrolling ancestor for anything to be
   * sticky inside. A folder spanning half the drawing is worse off than a long
   * file — scroll past its top and there is nothing at all saying which folder
   * the eight cards on screen belong to.
   *
   * Nought for a folded box, at every scroll position and every zoom, which is
   * the whole of what folding does. Its header stays at the top of its own frame
   * and leaves with it. That decision is `pinOf`'s and not this file's, and it is
   * a call for the same reason the number it is asked about is: written out here
   * it was a guard clause in a template that nothing could exercise, sitting in
   * front of arithmetic that looks perfectly safe to run on any box.
   *
   * The arithmetic itself is next door in `heading.ts`, because it is the part
   * of this component that two units meet in — the chrome is window pixels, a
   * header is canvas units — and every version of that fault has looked right at
   * whatever zoom it was last seen at. `media` and `media/grid` are both held
   * against the top of the window at once, and a step that is not exactly one
   * header tall in the header's own units puts one name over the other as the
   * reader zooms in and leaves them adrift as they zoom out.
   */
  function pin(box: FolderBox): number {
    return pinOf(bars, box, { chromeBottom, y: view.y, scale: view.scale });
  }

  /**
   * Everything the header for a box needs where it joins the stack, or nothing
   * where it does not.
   *
   * A lookup rather than a field on the box, because a box is derived geometry
   * handed over by the placement and this is a fact about what the reader has
   * folded. Writing one onto the other would put a piece of view state inside
   * the object the layout tests compare, which is how "nothing geometric
   * changed" stops being checkable.
   */
  function barOf(box: FolderBox): Bar | undefined {
    return bars.get(box.path);
  }

  /**
   * Which folder a bar is really about, for the tip under it.
   *
   * The deepest name written on it, and not the box's own path. A bar reading
   * `app/home` belongs to the box around `app`, but the question a reader asks
   * by hovering it is "where is the thing I am looking at", and what they are
   * looking at is `home` — answering with `app` would be the drawing replying to
   * a question the reader did not ask, and doing it only on the bars where the
   * answer was least obvious.
   *
   * A folded folder's header has nothing in the stack behind it, so the fallback
   * is what answers and it answers with that folder's own path — which is right,
   * and is why a folded header can afford to say a bare name like an open one.
   * The reader hovering a header that says `hooks` on a change with `src/hooks`
   * and `test/hooks` in it gets told which of the two it is, folded or not.
   */
  function whole(box: FolderBox): string {
    return barOf(box)?.absorbed.at(-1) ?? box.path;
  }

  /**
   * A folder's bar folded out of the stack, or brought back into it.
   *
   * Both directions go through the shared state rather than through a local
   * flag, because the host remembers this between readings and a second copy of
   * the answer here would be the one that is right until the page is reopened.
   */
  function fold(path: string, folded: boolean): void {
    setFolded(path, folded);
  }

  /**
   * The keys, taken here rather than left to the canvas.
   *
   * A native button already fires a click for Enter and for space, so this
   * looks redundant and is not. The canvas listens for keys on the document and
   * `Enter` is bound to "mark the file read" — so a reader who has tabbed to a
   * chevron and pressed Enter would collapse the folder and tick a file off at
   * the same time, and would have no reason to connect the two. That handler
   * steps aside for a press somebody has already dealt with, so dealing with it
   * is what this does: the default is refused, which both stops the press
   * reaching the canvas and stops the browser generating a second click of its
   * own, and the fold is done here instead.
   */
  function onKey(event: KeyboardEvent, path: string, folded: boolean): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    fold(path, folded);
  }

  /**
   * The folder whose name the pointer is over, if any.
   *
   * A name says the last part of a path — `media`, where three folders in the
   * drawing may end that way — so the rest of it has to be reachable. The card
   * does the same thing for the same reason, and for the same reason it draws
   * the tip itself rather than asking the browser for one: the native tooltip
   * waits about a second and any redraw under the pointer starts the wait
   * again, so on a change that rebuilds while an agent works it mostly never
   * appears at all.
   */
  let over: string | undefined = $state(undefined);

  /**
   * That folder again, but only while it is still in the drawing.
   *
   * The path is remembered rather than the box, and it is looked up again on
   * every read, because a pointer leaving is not the only way a name stops being
   * under it. An element that is removed never reports the pointer leaving, so a
   * tip anchored to a box the drawing no longer has would sit on the canvas
   * naming nothing — a rebuild that drops the box, a filter that empties it, the
   * reader asking for the grouping to go away.
   *
   * Folding used to be on that list and no longer is, which is worth recording
   * because it cost a fix of its own. A folded box was drawn with a stub in
   * place of its bar, so pressing the chevron swapped one element for another in
   * the same corner: the bar never reported the pointer leaving because the bar
   * had gone, and the stub never reported it arriving because the pointer was
   * already where the stub appeared, and the tip sat there naming a folder whose
   * bar the reader had just folded away. What was carried alongside the path to
   * survive that was a note of which of the three things the box had been
   * wearing. There is one thing now. A fold changes the chevron on a header that
   * was already there and does not replace the header, so the element under the
   * pointer is the element the pointer arrived on and it reports leaving in the
   * ordinary way.
   */
  const tip = $derived.by(() => {
    if (over === undefined) return undefined;
    return folders.find((one) => one.path === over);
  });
</script>

<!--
  The frames, under the cards.

  Nothing here is stacked, on purpose: with no z-index of its own a frame is
  painted in the order it appears, and it appears before the arrows and the
  cards do. That is the whole of what keeps the tint off the code.
-->
{#each folders as box (box.path)}
  <div
    class="cluster"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
  ></div>
{/each}

<!--
  And the names, over them.

  A second pass rather than a child of the frame, because the two want opposite
  sides of the cards and one element cannot be on both. A frame carrying a
  z-index would be a stacking context, and a header inside a stacking context
  cannot be painted above something the context as a whole is below — so the
  header's own number would mean nothing and it would sink with the frame.

  One header for every box, and that is the whole shape of this loop. A folder
  the reader has collapsed is drawn with the same header as one they have not —
  same markup, same height, same face — because what collapsing buys is a
  shorter stack against the top of the window and not a quieter drawing. There
  is no second way of saying a folder's name here any more: the branch below is
  about which chevron the header carries and whether the header may pin, and
  everything either sort of box has in common is written once.

  The bar above may still say a folded folder's name as well, where that folder
  turned out to be the whole of what the bar's own box contains. That is not the
  same name twice over in the way it would once have been: the parent's bar
  reads `app/home` across the frame that really is `app/home`, and `home`'s own
  header sits on `home`'s frame saying where `home` is. Both are true, and the
  reader has two ways back out of the fold rather than a puzzle about which of
  two shapes in one corner means what.
-->
{#each folders as box (box.path)}
  <!--
    Where this box's header stands in the stack, or nothing if it stands
    outside it.

    Present for a box whose header pins and absent for a folded one, which is
    the only difference between the two below and is `bars.ts`'s answer rather
    than this file's. Asked once, at the top, so that the header's markup cannot
    drift into asking it a second way further down.
  -->
  {@const bar = barOf(box)}
  <!--
    The label cut back into the words it was joined from.

    Split rather than kept as an array on the bar, because the bar's label is the
    one thing that decides what the reader sees and a parallel list of words
    beside it would be a second version of the same sentence, free to drift. The
    first word is the box's own name and the rest line up one for one with
    `bar.absorbed`, which is what the press below relies on.

    A folded box has no bar to read a label off, so it reads its own. That is
    the one place the box is allowed to answer this, and it is allowed because
    there is nothing else to ask: `bars.ts` decides what a bar says, and a box
    outside the stack has no bar and has never absorbed anything. The two agree
    on the word in any case — the bar's first word is the last segment of the
    path, which is exactly what `FolderBox.label` holds.
  -->
  {@const words = (bar?.label ?? box.label).split("/")}
  <!--
    A clip of the same shape as the frame, holding nothing but the header.

    It repeats the box's geometry and its rounded corners so that the header is
    cut by the shape of the folder it belongs to. The frame used to do this,
    back when the bar was inside it; what it must not do is repeat the border or
    the tint, which stayed behind with the frame — drawn twice, once on each
    side of the cards, the faint background would be laid over the code again
    and the second copy would be the one the reader is trying to read through.

    Stacked by the slot where there is one and by the box's depth where there is
    not, since a box outside the stack has no slot. Both count outwards, so
    either way a parent's header is painted over its children's, which is the
    order that matters: a parent's bar slides down over the boxes inside it as
    the reader scrolls, and a folded child's header disappearing underneath it is
    exactly right — the child's header belongs to a box the parent's bar is
    currently standing in front of.
  -->
  <div
    class="cluster-clip"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:z-index="calc(var(--z-folder) - {bar ? bar.slot : box.depth})"
  >
    <!--
      A bar across the whole box, as a card's title is across the whole card.
      A pill floating at one corner reads as a label stuck onto the drawing;
      a bar reads as the top of the thing it names, which is what it is.

      That was once said of an open box only, and a folded one was given the
      pill: a small stub in the corner, on the argument that a full-width header
      would say the fold had not happened. It does not. The fold is visible in
      the place the reader was looking when they asked for it — the stack against
      the top of the window is a header shorter — and a folded folder is still a
      folder, drawn where it is, labelled like its neighbours.

      Its height is the constant rather than a number in the stylesheet that
      happens to match it. The names are stacked one header apart, so a header
      drawn at any other size is names that overlap or names with daylight
      between them — and the two numbers sitting in two files is how they came
      to disagree in the first place. It is also the height of the room the
      banding already reserved above this box's first card, which it reserves
      whether the box is folded or not, so a folded header sits in space that was
      paid for long before the reader pressed anything: no card is covered and no
      band is asked to be taller.

      Plus one screen pixel, which is not a fudge of that number but a repair of
      a different one. Seven of these stand against the top of the window at
      once on a deeply nested change, exactly one header apart, so in the
      drawing's own units they are already flush. What shows through between
      them is the screen's grid: a header is thirty canvas units, thirty units
      is a fraction of a pixel at most zooms, and each bar is rounded to the
      grid on its own — so consecutive bars round apart and leave a hairline of
      the drawing between them, which reads as a gap in a solid stack of labels.
      The seam is measured in screen pixels, so the bleed that closes it is too:
      dividing by the zoom leaves it one pixel wide at every scale. It grows
      downwards into the pad below the bar rather than into the reservation, so
      the stacking step and the room a band sets aside are both untouched.

      And the slide down the box is `pin`, which is nought for the whole of a
      folded box's life. This is the principle in one attribute: the header is
      where the box is, and it stops being held under the chrome, and nothing
      else about it changes.
    -->
    <div
      class="cluster-head"
      style:height="calc({CLUSTER_HEAD}px + 1px / var(--zoom, 1))"
      style:transform="translateY({pin(box)}px)"
    >
      <!--
        The only part of a box that answers the pointer at all.

        Everything else is `pointer-events: none`, because a box is a place and
        not a thing to be clicked, and a folder that swallowed a drag would stop
        the reader panning across the very drawing it is drawn on. The name is a
        few characters wide, so it can take the pointer without taking the
        canvas with it.

        It is the same element whether the box is folded or not, which is what
        lets the hover tip above be a path and nothing more. Folding swaps a
        chevron inside this span; it does not take the span away and put another
        one where the pointer already is.
      -->
      <span
        class="cluster-said"
        style:transform="translateX({slide(box)}px)"
        bind:offsetWidth={said[box.path]}
        onmouseenter={() => (over = box.path)}
        onmouseleave={() => {
          if (over === box.path) over = undefined;
        }}
        role="presentation"
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path
            d="M2.2 4.2a1 1 0 0 1 1-1h2.9l1.4 1.6h5.3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
        <!--
          The header's own word for itself, which is the first word of its label.

          Taken from the bar where there is one, rather than from the box, though
          a `FolderBox` carries a label of its own that says the same thing
          today. What a bar reads is `bars.ts`'s question — the same function
          decides whether the header joins the stack at all, and whether any
          folded name is written beside this one — and two places entitled to
          answer it is how a rule that has just been changed twice comes back
          half-changed.
        -->
        <span class="cluster-name">{words[0]}</span>
        <!--
          And the folders folded into this bar, each one still its own word.

          Drawn as separate presses rather than as one string, which is what
          makes an absorbed fold reversible from up here. A bar reading
          `app/home` is two things the reader can point at, and pressing the half
          that says `home` gives `home` its place in the stack back — the gesture
          undoes itself in the place it was made, rather than sending the reader
          off to look for whatever they did it with. `home`'s own header offers
          the same way back a little lower down, and that is a convenience rather
          than a contradiction: the two presses do the same thing to the same
          folder, and the reader may press whichever they are nearer.

          Empty for a folded box, which has absorbed nothing and has no bar to
          have absorbed it with.

          The separator is its own span so that it is not part of either press.
          A slash that belonged to the segment beside it would be a pixel or two
          of "unfold" sitting between two names, hit by a reader aiming at
          neither.
        -->
        {#each bar?.absorbed ?? [] as path, at (path)}
          <span class="cluster-sep" aria-hidden="true">/</span>
          <button
            type="button"
            class="cluster-act cluster-part"
            aria-label="Expand {path}"
            onclick={() => fold(path, false)}
            onkeydown={(event) => onKey(event, path, false)}
          >
            {words[at + 1]}
          </button>
        {/each}
        <span class="cluster-count">{box.nodes.length}</span>
        <!--
          The control that takes this header out of the stack, or puts it back.

          One button and not two, reading the opposite way round on a folded box,
          because it is one control: it says what folding this folder would do
          next. Written as two branches it was two elements in the same corner
          doing inverse things, and the version of that which shipped left a
          folded folder with no control at all — the reader had removed the bar
          the chevron lived on and there was nothing anywhere that brought it
          back. A folder has to be reachable, so the way back is on the folder.

          Inside the name rather than at the end of the bar, because the name is
          the part that slides: pan across a folder wider than the window and a
          chevron anchored to the header would be left behind at the box's far
          left with the label it belongs to now several columns away. Travelling
          with the name costs nothing and means the control is wherever the
          reader is already looking.

          Only where there is a bar above this one to recover the chrome for. An
          outermost box is never out of the stack, whatever the reader has
          folded, so a chevron on one would be a control that appears to do
          nothing.
        -->
        {#if box.depth > 1}
          <button
            type="button"
            class="cluster-act cluster-fold"
            aria-label={bar
              ? `Collapse ${box.path} out of the header stack`
              : `Expand ${box.path} back into the header stack`}
            onclick={() => fold(box.path, bar !== undefined)}
            onkeydown={(event) => onKey(event, box.path, bar !== undefined)}
          >
            <!-- Up at the stack this header would leave, or down at the box it
                 would come back to. -->
            <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
              <path
                d={bar ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        {/if}
      </span>
    </div>
  </div>
{/each}

<!--
  And where that folder actually lives, while the pointer is on its name.

  Nearly the only place in the drawing a full path appears, since a header says
  one folder's name most of the time. That makes this more than a convenience: a
  header reading `hooks` on a change that touches `src/hooks` and `test/hooks` is
  two headers reading the same word, and hovering is the whole of how a reader
  tells them apart. It answers for a folded box exactly as it does for an open
  one — `pin` gives nought where the header is out of the stack, so the tip sits
  under the header where it actually is rather than under a pinned position
  nothing is holding.

  And it answers with `whole`, which is the deepest folder the bar names rather
  than the box the bar is drawn on. A reader hovering `app/home` is asking about
  `home`.

  A pass of its own because both of the layers above clip what is inside them —
  one to cut the header to the box's corners, the other because a name that is
  sliding has to be cut off at the bar's end — and a tip hanging below the bar
  is exactly the thing they would cut. There is only ever one, so this is one
  element and not a third copy of every box.
-->
{#if tip}
  <div
    class="cluster-tip"
    style:left="{tip.x + 10 + slide(tip)}px"
    style:top="{tip.y + pin(tip) + CLUSTER_HEAD}px"
  >
    {whole(tip)}
  </div>
{/if}

<style>
  /*
   * The frame, and nothing over the cards.
   *
   * It takes no z-index at all, which is the point of it. A box is a place the
   * cards are in, so the tint is the colour of the place and not a wash over
   * the thing standing in it — and a frame that stacked itself above the cards
   * laid that wash across the code, which is the one part of the drawing a
   * reader is actually trying to read. With no number of its own it is painted
   * where it appears, and it appears before the arrows and the cards do.
   */
  .cluster {
    position: absolute;
    /*
     * Solid, and quieter than a card's.
     *
     * Dotted read as provisional — a selection, or something still being
     * dragged — rather than as a container, and against a drawing of dotted
     * gap-bands and dashed marks it was one more broken line among several. A
     * box is a real thing the cards are in, so it gets a real edge, and it is
     * told apart from a card by being fainter and by holding others rather than
     * by being made of a different kind of line.
     *
     * A pixel and a half on the screen, and therefore not a pixel and a half
     * here. Everything in this layer is inside the canvas's own
     * `translate/scale`, so a length written plainly is a length in canvas units
     * that shrinks with the drawing: pulled back to look at a whole change this
     * border was a fraction of a device pixel, which a browser renders as a
     * grey smear or as nothing at all. That is precisely backwards, because the
     * zoom where the boxes matter most is the one where the reader is trying to
     * take in the shape of the change rather than read any particular file.
     * Dividing by the zoom is the page's existing answer for anything that must
     * keep its size on screen, and it is what a card's tips and titles already
     * do.
     *
     * The radius is deliberately left in canvas units and not given the same
     * treatment. It has no failure mode — at every zoom it is visible and in
     * proportion — and the cards inside these boxes round their own corners in
     * canvas units too, so a frame whose corners stopped rounding as the reader
     * zoomed in would be the one square thing in a drawing of soft ones. What is
     * fixed here is the line's weight, which breaks; not its shape, which does
     * not.
     *
     * Thirty-six per cent rather than twenty-six. The tint that used to sit
     * inside these boxes is gone — nested frames stacked their washes and fogged
     * the code in any card the reader had ticked off — so the border and the bar
     * are now the only two things saying a box is there at all, and the border
     * is the only one of those that is drawn the whole way round. A line that
     * was only just visible when it had a fill helping it is a line that is not
     * visible without one. It stays well under a card's own edge, which is a
     * full-strength status colour, so the two are still told apart at a glance.
     */
    border: calc(1.5px / var(--zoom, 1)) solid
      color-mix(in srgb, var(--text) 36%, transparent);
    border-radius: 10px;
    /*
     * The border grows inwards, which is what keeps this change from moving
     * anything.
     *
     * The rectangle is derived geometry: `boxesFor` measured it from the cards
     * the folder actually holds, and nothing drawing it is allowed to disagree.
     * With a content-box model the border would be drawn outside the width and
     * height set on this element, so the visible rectangle would be the derived
     * one plus twice the border — and now that the border's width varies with
     * the zoom, the box's own edges would creep outwards as the reader pulled
     * back. A frame that breathes against the cards it encloses is exactly the
     * complaint this whole layer exists to avoid.
     *
     * The page's reset already says this for every element. It is said again
     * here because this rule now depends on it: the reset is a default, and a
     * default that is quietly removed somewhere else would turn a border width
     * into a geometry bug that only shows at zooms nobody screenshots.
     */
    box-sizing: border-box;
    /*
     * No fill, and the fill is what had to go.
     *
     * Three per cent of the text colour is nothing on its own, but the boxes
     * nest: six frames around one card painted that wash six times over the
     * same patch of canvas, which is nearer a fifth than a twentieth. An
     * untouched card hid all of it, being opaque — but a card the reader has
     * ticked off is drawn at just under half opacity, so most of that stack
     * came through it and the code inside a deeply nested folder read as
     * fogged. The fog was worst exactly where the reader had already done the
     * work of reading, which is the last place to put a veil.
     *
     * A box says what it is with its border and its bar, both of which are
     * drawn once however deep the nesting goes.
     */
    /* Behind the cards, and out of the way of every gesture aimed at them: a
       box is a place, not a thing to be clicked. */
    pointer-events: none;
  }

  /*
   * The same rectangle again, holding only the name.
   *
   * An outer box's name sits over an inner one's: they are stacked by how deep
   * they are, so a parent's bar is drawn above its children's rather than under
   * them. Held against the top of the window they are a few pixels apart, and a
   * child's bar over its parent's leaves the outer folder's name half covered —
   * the wrong way round, since the outer name is the one about to go off screen
   * and the one a reader has the least other way of recovering.
   *
   * The band it is stacked in sits above the cards and below their names, which
   * is the order the reader needs and not one this file is free to choose; it
   * is written down in the tokens with the rest of the page's stacking.
   *
   * It repeats the border radius but neither the border nor the tint. Those
   * stayed with the frame, on the far side of the cards — drawn a second time
   * here the faint background would be laid over the code after all, and this
   * copy would be the one in the way.
   */
  .cluster-clip {
    position: absolute;
    border-radius: 10px;
    /*
     * The corners belong to the box, so the box is what cuts them.
     *
     * The header drew its own rounded top, which is right only while it is
     * sitting at the top. Slid down to stay under the bar it took its corners
     * with it, so a bar with two curves in the middle of a folder sat inside
     * square walls — the shape saying "a box begins here" in a place where
     * nothing began. Clipped here instead, the header is square, and where it
     * happens to meet a corner the corner is the one the box already has.
     */
    overflow: hidden;
    pointer-events: none;
  }

  .cluster-head {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    align-items: center;
    /*
     * A header is as tall as it says it is, rule and all.
     *
     * The height itself is set on the element, from the same constant the
     * stacking steps by. What is said here is that the border along the bottom
     * counts towards it: nothing in this page resets the box model, so without
     * this the rule is a thirty-first unit hanging below a thirty-unit bar, and
     * every name in the column sits a unit over the one above it. A unit is a
     * quarter of a screen pixel pulled well back and three of them zoomed in,
     * so it is a seam that only appears once the reader is close enough to read
     * the names it is spoiling.
     */
    box-sizing: border-box;
    padding: 0 10px;
    /* Solid, because cards pass under it as the folder scrolls. */
    /*
     * Opaque, and said twice on purpose.
     *
     * Cards pass under this bar as the folder scrolls, and a header one can
     * read code through is a header that is illegible exactly when it is
     * needed. The mix is against the card background rather than against
     * nothing, so it is solid whatever the theme makes of it.
     */
    background: var(--card-bg);
    background: color-mix(in srgb, var(--text) 10%, var(--card-bg));
    border-bottom: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
  }

  /* What actually slides. The bar stays where the box is; the words inside it
     travel, so the bar never comes away from the folder it belongs to. */
  .cluster-said {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    /* The one part of a box the pointer can reach, so that hovering the name
       can say where the folder is. Everything around it stays deaf. */
    pointer-events: auto;
  }

  /*
   * The whole path, drawn under the name it belongs to.
   *
   * Sized against the canvas's scale rather than in canvas units, like the tip
   * a card draws and like the label over a shrunken card: a tip measured in the
   * drawing's own units is illegible at exactly the zoom where a name is too
   * short to help, which is the zoom a reader asks the question at.
   *
   * Above the bars, because it is about one of them and a bar drawn over the
   * answer would be the drawing refusing the question it just invited.
   */
  .cluster-tip {
    position: absolute;
    z-index: var(--z-name);
    margin-top: calc(4px / var(--zoom, 1));
    padding: calc(3px / var(--zoom, 1)) calc(7px / var(--zoom, 1));
    border: 1px solid var(--line);
    border-radius: calc(4px / var(--zoom, 1));
    background: var(--bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: calc(11px / var(--zoom, 1));
    line-height: 1.3;
    white-space: nowrap;
    pointer-events: none;
  }

  .cluster-name { color: var(--text); }

  /* The slashes in an absorbed name, quieter than the names they join, so the
     bar reads as a path rather than as a row of equally loud words. */
  .cluster-sep {
    opacity: 0.55;
  }

  /*
   * The controls a box carries: the chevron on its header, which takes the
   * header out of the pinned stack or puts it back, and each folded name the
   * header has absorbed, which brings that folder back.
   *
   * Stripped back to the text they contain, because a button drawn as a button
   * in here would be a piece of furniture sitting in the middle of a label. The
   * background, the border and the padding all go; what is left says what it is
   * by being pressable, which the cursor announces.
   *
   * Never taller than the bar, and that is not a nicety. The bar's height is set
   * on the element from the shared constant, and `.cluster-head` hides its
   * overflow — so a child even a pixel taller is not accommodated, it is cut,
   * and what the reader sees is a chevron with its bottom sliced off rather
   * than a layout that has gone wrong somewhere. The line height is pinned for
   * the same reason: a glyph is free to ask for more room than the bar has.
   */
  .cluster-act {
    display: inline-flex;
    align-items: center;
    max-height: 16px;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    line-height: 16px;
    cursor: pointer;
    /* It is inside `.cluster-said`, which is the one part of a box that answers
       the pointer at all — but being reachable is only half of it. The viewport
       captures the pointer on the way past unless the target matches `HANDLES`
       in `camera.svelte.ts`, and a captured pointer never produces a click, so
       the class on these elements is named there too. */
    pointer-events: auto;
  }

  /* A folded folder's name, which reads as part of the path and presses as a
     way back. Coloured as a name rather than as a link: it is one of the words
     in the label, and making it look like something else would break the path
     the label is trying to be. */
  .cluster-part {
    color: var(--text);
  }

  .cluster-part:hover,
  .cluster-fold:hover {
    color: var(--text);
    opacity: 0.7;
  }

  /* The chevron, after the count, at the quiet end of the header. It is the
     least important thing in the label until it is wanted, so it is drawn at the
     weight of the muted text around it rather than competing with the name. The
     same rule folded: a way back that shouted would make every collapsed folder
     the loudest thing in the drawing, which is the opposite of what the reader
     collapsed it for. */
  .cluster-fold {
    opacity: 0.65;
  }

  .cluster-count {
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 14%, transparent);
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
  }
</style>
