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

  import { headOf, type Bar } from "./bars.js";
  import { CLUSTER_HEAD, pinHead } from "./heading.js";
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
     * A box with no entry draws no bar, and its name is then either a segment of
     * the bar above it or a stub on its own frame. Its frame is still drawn
     * whichever it is, in the loop below that draws every box: collapsing takes
     * a bar out of the stack, it does not remove a folder, and a box that
     * vanished when its bar did would be the reader losing the grouping they
     * were using to read the change.
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
   * Which folder a bar is really about, for the tip under it.
   *
   * The deepest name written on it, and not the box's own path. A bar reading
   * `app/home` belongs to the box around `app`, but the question a reader asks
   * by hovering it is "where is the thing I am looking at", and what they are
   * looking at is `home` — answering with `app` would be the drawing replying to
   * a question the reader did not ask, and doing it only on the bars where the
   * answer was least obvious.
   *
   * A folded folder's stub has no bar behind it, so the fallback is what answers
   * and it answers with that folder's own path — which is right, and is the
   * reason the stub can afford to say a bare name. The reader hovering a stub
   * that says `hooks` on a change with `src/hooks` and `test/hooks` in it gets
   * told which of the two it is, exactly as they would from a bar.
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
   * What a box is currently wearing, which is what the pointer was actually on.
   *
   * Three states and not two, now that a folded box may have its name in the bar
   * above it instead of on a frame of its own: a bar, a stub, or nothing at all
   * because the bar above is saying its name for it.
   */
  type Wearing = "bar" | "stub" | "nothing";

  function wearing(box: FolderBox): Wearing {
    if (bars.has(box.path)) return "bar";
    return "stub";
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
  let over: { path: string; on: Wearing } | undefined = $state(undefined);

  /**
   * That folder again, but only while it is still wearing what was hovered.
   *
   * The path is remembered rather than the box, and it is looked up again on
   * every read, because a pointer leaving is not the only way a name stops
   * being under it. An element that is removed never reports the pointer
   * leaving, so a tip anchored to a box the drawing no longer has would sit on
   * the canvas naming nothing — a rebuild that drops the box, a filter that
   * empties it, the reader asking for the grouping to go away.
   *
   * Folding is on that list too, and remembering which of the three the reader
   * was pointing at is the whole of why. Asking merely whether the folder is
   * still drawn would usually say yes, because folding a box does not remove it
   * — but the reader was on one particular element and folding swaps that
   * element for a different one in the same corner. The bar never reports the
   * pointer leaving because the bar has gone, and whatever replaces it never
   * reports the pointer arriving because the pointer was already where it is, so
   * the tip sat there naming a folder whose bar the reader had just folded away.
   * The third state matters for the same reason one step along: unfold a
   * sibling and a box that was wearing a stub is suddenly wearing nothing, its
   * name having moved up into a parent's bar that has stopped absorbing it.
   */
  const tip = $derived.by(() => {
    if (over === undefined) return undefined;
    const box = folders.find((one) => one.path === over.path);
    if (!box) return undefined;
    return wearing(box) === over.on ? box : undefined;
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

  And only for the boxes that draw one. A folder the reader has collapsed says
  its name somewhere else — as a segment of the bar above it, where that bar
  absorbed it, and otherwise on a stub of its own, which is the second branch
  below. A bar of its own here as well would be the stack no shorter, which is
  the whole feature undone. The frame above is drawn for every box regardless, so
  the grouping the reader is reading the change by stays exactly where it was.

  Which of the two a folded box gets is `bars.ts`'s answer and is asked here in
  one breath, because the reader has to be able to open the folder again and
  there has to be exactly one place they can do it. Two would say a folder's name
  twice in the same corner of the drawing; none would leave a folder with no name
  anywhere and no control that brings it back, which this feature has already
  done to somebody once.
-->
{#each folders as box (box.path)}
  {@const bar = barOf(box)}
  {#if bar}
  <!--
    The label cut back into the words it was joined from.

    Split rather than kept as an array on the bar, because the bar's label is the
    one thing that decides what the reader sees and a parallel list of words
    beside it would be a second version of the same sentence, free to drift. The
    first word is the box's own name and the rest line up one for one with
    `bar.absorbed`, which is what the press below relies on.
  -->
  {@const words = bar.label.split("/")}
  <!--
    A clip of the same shape as the frame, holding nothing but the bar.

    It repeats the box's geometry and its rounded corners so that the header is
    cut by the shape of the folder it belongs to. The frame used to do this,
    back when the bar was inside it; what it must not do is repeat the border or
    the tint, which stayed behind with the frame — drawn twice, once on each
    side of the cards, the faint background would be laid over the code again
    and the second copy would be the one the reader is trying to read through.
  -->
  <div
    class="cluster-clip"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:z-index="calc(var(--z-folder) - {bar.slot})"
  >
    <!--
      A bar across the whole box, as a card's title is across the whole card.
      A pill floating at one corner reads as a label stuck onto the drawing;
      a bar reads as the top of the thing it names, which is what it is.

      Its height is the constant rather than a number in the stylesheet that
      happens to match it. The names are stacked one header apart, so a header
      drawn at any other size is names that overlap or names with daylight
      between them — and the two numbers sitting in two files is how they came
      to disagree in the first place.

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
      -->
      <span
        class="cluster-said"
        style:transform="translateX({slide(box)}px)"
        bind:offsetWidth={said[box.path]}
        onmouseenter={() => (over = { path: box.path, on: "bar" })}
        onmouseleave={() => {
          if (over?.path === box.path) over = undefined;
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
          The bar's own word for itself, which is the first word of its label.

          Taken from the bar rather than from the box, though a `FolderBox`
          carries a label of its own that says the same thing today. What a bar
          reads is `bars.ts`'s question — the same function decides whether the
          bar is drawn at all, and whether any folded name joins this one — and
          two places entitled to answer it is how a rule that has just been
          changed twice comes back half-changed.
        -->
        <span class="cluster-name">{words[0]}</span>
        <!--
          And the folders folded into this bar, each one still its own word.

          Drawn as separate presses rather than as one string, which is what
          makes an absorbed fold reversible without a second control anywhere. A
          bar reading `app/home` is two things the reader can point at, and
          pressing the half that says `home` gives `home` its bar back — the
          gesture undoes itself in the place it was made, rather than sending the
          reader off to look for whatever they did it with. A folded folder whose
          name is not up here has a stub on its own frame instead, and no folder
          ever has both.

          The separator is its own span so that it is not part of either press.
          A slash that belonged to the segment beside it would be a pixel or two
          of "unfold" sitting between two names, hit by a reader aiming at
          neither.
        -->
        {#each bar.absorbed as path, at (path)}
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
          The control that takes this bar out of the stack.

          Inside the name rather than at the end of the bar, because the name is
          the part that slides: pan across a folder wider than the window and a
          chevron anchored to the bar would be left behind at the box's far left
          with the label it belongs to now several columns away. Travelling with
          the name costs nothing and means the control is wherever the reader is
          already looking.

          Only where there is a bar above this one to recover the chrome for. An
          outermost box always draws its bar, whatever the reader has folded, so
          a chevron on one would be a control that appears to do nothing.
        -->
        {#if box.depth > 1}
          <button
            type="button"
            class="cluster-act cluster-fold"
            aria-label="Collapse {box.path} out of the header stack"
            onclick={() => fold(box.path, true)}
            onkeydown={(event) => onKey(event, box.path, true)}
          >
            <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
              <path
                d="M4 10l4-4 4 4"
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
  {:else}
  <!--
    The same clip again, holding a stub instead of a bar.

    The condition is the one thing here worth being careful about. A folded box
    whose name went up into the bar above it is pressable there and must not also
    carry a stub, or the reader is looking at the same folder named twice in two
    shapes a few pixels apart and has to guess which press means what. A folded
    box whose name went nowhere must carry one, or the folder has no name in the
    drawing at all and no control that opens it again — which is the hole this
    feature has already left somebody in, and the reason `stranded` works the
    question out once in `bars.ts` against the walk that decides it rather than
    being re-derived here from the folded set.

    The clip and not the frame, for the reason the frame gives above: a frame
    carries no z-index so that its edge is painted under the cards, and a
    control painted under the cards is a control behind the thing the reader
    would have to click through to reach it. Stacked by the box's depth rather
    than by a slot, since a box with no bar has no slot — which puts it under
    its parent's bar, the right way round for the two or three units where a
    deep box's top meets a shallow one's bar.
  -->
  <div
    class="cluster-clip"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:z-index="calc(var(--z-folder) - {box.depth})"
  >
    <!--
      It lives in the room the header would have had, and costs nothing for it.

      `bandsFor` reserves a pad and a header above the first card of every box
      that opens at a band, and it goes on reserving them whether or not that
      box's bar is drawn — that reservation is what makes folding move nothing.
      A folded box therefore has a header's worth of empty canvas across its
      top that nobody is using, and this sits in the middle of it. So the stub
      is drawn in space that was already paid for: no card is covered, no band
      is asked to be taller, and the height it is held to is the shared constant
      rather than a number here that happens to agree with it.

      It slides with the pan on the same terms the names do, measured into the
      same record. A box has either a bar or a stub and never both, so the two
      cannot collide over one key — and a stub left behind at the far left of a
      folder wider than the window is a way back the reader cannot see, which is
      the complaint this whole branch exists to answer.
    -->
    <button
      type="button"
      class="cluster-act cluster-stub"
      aria-label="Expand {box.path}"
      style:top="calc(({CLUSTER_HEAD}px - 16px) / 2)"
      style:transform="translateX({slide(box)}px)"
      bind:offsetWidth={said[box.path]}
      onclick={() => fold(box.path, false)}
      onkeydown={(event) => onKey(event, box.path, false)}
      onmouseenter={() => (over = { path: box.path, on: "stub" })}
      onmouseleave={() => {
        if (over?.path === box.path) over = undefined;
      }}
    >
      <!-- Downwards, against the chevron that folded it, which points up at the
           stack this bar left. -->
      <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
        <path
          d="M4 6l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="cluster-name">{box.label}</span>
      <span class="cluster-count">{box.nodes.length}</span>
    </button>
  </div>
  {/if}
{/each}

<!--
  And where that folder actually lives, while the pointer is on its name.

  Nearly the only place in the drawing a full path appears, since a bar says one
  folder's name most of the time and a stub always does. That makes this more
  than a convenience: a bar reading `hooks` on a change that touches `src/hooks`
  and `test/hooks` is two bars reading the same word, and hovering is the whole
  of how a reader tells them apart. It answers for a box with a stub exactly as
  it does for a box with a bar — `pin` gives nought where there is no bar, so the
  tip sits under the stub rather than under a header that is not there.

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
   * The controls a box carries: the chevron in a bar that collapses it, each
   * folded name it has absorbed that brings a folder back, and the stub on a
   * folded box's frame that does the same where no bar absorbed it.
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

  /*
   * The stub on a folded folder's frame: the name, and the way back.
   *
   * Drawn as a pill and not as a bar, which is the whole distinction it has to
   * carry. A second full-width bar here would say the fold had not happened —
   * the reader folded a folder to be rid of a name held against the top of the
   * window and would be looking at the same name in the same shape, a few
   * pixels lower. A pill is plainly a marker left behind on a box rather
   * than the box's heading, it scrolls away with the box instead of pinning
   * itself under the chrome, and it occupies the strip of canvas the header's
   * reservation had already set aside above the folder's first card.
   *
   * It repeats the font rather than inheriting it, because `.cluster-act` says
   * `font: inherit` and this one is not inside `.cluster-head` — there is no
   * bar for it to be inside. Inheriting there would give it the page's body
   * face at the page's body size, which at a wide zoom is a paragraph sitting
   * across the top of a folder.
   *
   * Sixteen units tall like everything else in a bar, and that is not a
   * nicety either. The room above the first card is exactly one header's worth
   * and this sits inside it; a stub that grew past `CLUSTER_HEAD` would be
   * cut by the clip around it, and what the reader would see is a name with
   * its underside sliced off rather than a layout that had gone wrong.
   */
  .cluster-stub {
    position: absolute;
    left: 10px;
    gap: 5px;
    padding: 0 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 16%, var(--card-bg));
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    white-space: nowrap;
  }

  .cluster-stub:hover {
    background: color-mix(in srgb, var(--text) 24%, var(--card-bg));
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

  /* The chevron, after the count, at the quiet end of the bar. It is the least
     important thing in the label until it is wanted, so it is drawn at the
     weight of the muted text around it rather than competing with the name. */
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
