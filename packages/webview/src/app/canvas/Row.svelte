<!--
  One row of a card: a line of the file, a line either side of the change, or a
  band standing in for the part of the file the card is not showing.

  Both readings live here rather than in two components. A row is one thing the
  reader can point at — it has one identity, one line number, one arrow landing
  on it — and splitting it in two by how it happens to be drawn would mean two
  places to change every time that identity grows a field.
-->
<script lang="ts">
  import type { Side } from "../marks/marks.js";
  import type { Mark } from "./deltas.js";
  import { commentOn, endAt, endsOf, holds, holdsBand, lineOn, type End } from "./picking.js";
  import { gesture } from "./picking.svelte.js";
  import { boxesOn, markKey, type SymbolBox, type SymbolMark } from "./symbols.js";
  import Row from "./Row.svelte";
  import {
    bandRows,
    pairRows,
    runs,
    pairKey,
    rowKey,
    type CodeRow,
    type RowPair,
    type RowView,
  } from "./rows.js";

  let {
    /** The row itself, when the card is read as one stream. */
    row = undefined,
    /** The two sides of the row, when the card is read as two panes. */
    pair = undefined,
    /** A file that exists on one side only, so one numbering and one pane. */
    single = false,
    /**
     * The card this row belongs to, so it can tell whether the open pick is
     * about it. A pick is one range on one card, and a row that only knew its
     * own line number would light up on every file that happened to have one.
     */
    nodeId = "",
    /**
     * Whether a remark can start here at all: there is a forge to send it to
     * and the reader has not marked this file read. Decided once by the card
     * rather than by each of its several hundred rows.
     */
    canComment = false,
    /**
     * The words on this card an arrow is about, keyed `side:line`. Worked out
     * once by the card from the edges it is an end of, because every row would
     * otherwise walk the whole list of them to find the nothing that is usually
     * there.
     */
    marks = undefined,
    /** Past the height the layout engine gave this card. */
    beyondCap = false,
    /** This row is one of the lines a band stands in for. */
    inGap = false,
    /** That band is open. */
    gapOpen = false,
    /** The card has been asked to show everything it is holding back. */
    revealed = false,
    /**
     * This line has just changed under the reader, and how.
     *
     * Only ever set on a live reading, and only for as long as the animation
     * runs: it is how somebody watching an agent work sees which lines it
     * touched, on a card too long to spot the difference in.
     */
    flash = undefined,
  }: {
    row?: RowView;
    pair?: RowPair;
    single?: boolean;
    nodeId?: string;
    canComment?: boolean;
    marks?: Map<string, SymbolMark[]>;
    beyondCap?: boolean;
    inGap?: boolean;
    gapOpen?: boolean;
    revealed?: boolean;
    flash?: Mark | undefined;
  } = $props();

  /** The band this row is, whichever reading asked for it. */
  const band = $derived(
    pair ? pair.band : row && row.kind === "gap" ? row : undefined,
  );

  // A band the reader opened by hand, as opposed to one the card's own unfold
  // is holding open. Kept apart so that folding the card again — a question
  // about the lines it is holding back — does not undo a band they chose to
  // read.
  let opened = $state(false);
  const open = $derived(band ? opened || revealed : gapOpen);

  /** The lines behind this band, in whichever reading the card is being read. */
  const behind = $derived(
    !band ? [] : pair ? pairRows(bandRows(band)) : bandRows(band),
  );

  function toggle() {
    if (band?.rows) opened = !opened;
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  }

  const line = (side: RowView | undefined): CodeRow | undefined =>
    side && side.kind !== "gap" ? side : undefined;

  const inDiff = (side: RowView | undefined): boolean =>
    line(side)?.inDiff === true;

  const NO_NEWLINE = "No newline at end of file";

  /**
   * Which of this row's gutters the pointer is on, if either.
   *
   * Kept by the row rather than in one place for the whole page. A single
   * hovered line held centrally would wake every row in the change each time
   * the pointer crossed a boundary, and a change of any size carries a couple
   * of thousand of them; here two rows react and the rest never hear about it.
   *
   * Named by where the rail is rather than by which line it shows, because a
   * file that exists on one side only puts the same number in both gutters and
   * they are still two different things to press.
   *
   * It starts empty, so nothing is rendered until a browser has moved a pointer
   * over the row — which is what keeps this out of the server's way.
   */
  let rail = $state<"left" | "right" | null>(null);

  function onRail(event: PointerEvent): void {
    const on = (event.target as Element | null)?.closest?.("[data-rail]");
    rail = on?.getAttribute("data-rail") === "right" ? "right" : on ? "left" : null;
  }

  /**
   * The pointer leaving a rail, which is not the same as leaving the row.
   *
   * Clearing on every departure meant the button put itself away the instant it
   * appeared: showing it moves an element under a pointer that was over the
   * number, the browser reports that as leaving the number, and taking the
   * button away then reports arriving at the number again — a flicker that ran
   * for as long as the pointer stayed still. Moves inside the row are settled
   * by the arrival instead, which always follows the departure, and only
   * leaving the row for good puts the button away.
   */
  function offRail(event: PointerEvent): void {
    const here = event.currentTarget as Element;
    const to = event.relatedTarget as Node | null;
    if (!to || !here.contains(to)) rail = null;
  }

  /**
   * The rail the button belongs to, and no rail at all once a drag has begun.
   *
   * The card captures the pointer for the length of the gesture, so the rows it
   * passes over are never told it arrived — and a button left behind under a
   * moving pointer is a button in the way of the thing it started.
   */
  const hint = $derived(gesture.dragging ? null : rail);

  /** Whether the open pick reaches a particular gutter of this row. */
  const picked = (at: { side: Side; line: number } | null): boolean =>
    at !== null && holds(gesture.pick, nodeId, at.side, at.line);

  const bandPicked = $derived(holdsBand(gesture.pick, nodeId, band?.covers));

  /**
   * The two ends of the open pick, when it is this card's.
   *
   * Read from the pick rather than remembered per row, so a range that moves
   * takes its handles with it. Rendered onto the rows themselves they would
   * have to be removed again as the range slid off them, and the one that was
   * missed would sit on a line that is no longer an end of anything.
   */
  const ends = $derived(endsOf(gesture.pick, nodeId));

  /**
   * The boxes to draw on one side of this row.
   *
   * Placed along the row's own text rather than from the card's left edge, so
   * the same arithmetic serves a single column of code and either pane of a
   * split one — where the code begins is a question about the reading, and the
   * box does not have to ask it.
   */
  const boxesFor = (only: CodeRow | undefined, keys: (string | null)[]): SymbolBox[] => {
    if (!only || !marks) return [];
    const here: SymbolMark[] = [];
    for (const key of keys) {
      const found = key ? marks.get(key) : undefined;
      if (found) here.push(...found);
    }
    return boxesOn(only.text, here);
  };

  /** The one line a pane is showing, whichever reading and whichever side. */
  const paneLine = (only: CodeRow, which: Side, one: boolean) =>
    lineOn(only, which, one);

  /**
   * A gutter a remark can start from, as the strip beside the code needs it.
   *
   * A pane has one; a unified row has two, since its left gutter numbers the
   * base and its right the head, and either can begin a remark about the one
   * piece of code between them.
   */
  type Rail = {
    at: { side: Side; line: number } | null;
    name: "left" | "right";
    end: End | null;
  };
</script>

<!--
  A line's code, and the mark for a file that ends without one.

  The mark sits after the last character rather than on a row of its own: every
  card's height is worked out from how many rows it has, and a row nobody can
  point an arrow at would move every arrow below it down the canvas.

  Written without a break between its pieces because a row is `white-space:
  pre`. A newline in this template is a space in the file's code, and a space
  that is not in the file changes what the reader is reading.
-->
{#snippet code(source: CodeRow)}{#each runs(source) as run}{#if run.color || run.italic || run.bold || run.underline}<span
        style:color={run.color}
        style:font-style={run.italic ? "italic" : null}
        style:font-weight={run.bold ? "bold" : null}
        style:text-decoration={run.underline ? "underline" : null}
      >{run.text}</span>{:else}{run.text}{/if}{/each}{#if source.noNewline}<span
      class="no-newline"
      title={NO_NEWLINE}
      aria-label={NO_NEWLINE}
    ><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"
        ><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.5" /><path
          d="M5.2 8h5.6"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        /></svg
      ></span>{/if}{/snippet}

<!--
  The words this row's arrows are about.

  Drawn inside the code rather than over the row, so one piece of arithmetic
  serves a single column and either pane of a split one: the offsets are along
  the line's own characters, and where that line begins is a question the box
  never has to ask. Clipped with the code for the same reason a long line is —
  a box on a word the card had to cut belongs off the edge with it.
-->
{#snippet outlines(list: SymbolBox[])}{#each list as box (box.key)}<span
    class="symbol-box"
    data-change={box.change}
    data-edge={box.edgeId}
    data-role={box.role}
    style="left:{box.from}ch;width:{box.span}ch"
  ></span>{/each}{/snippet}

<!--
  The button that says a remark can start here.

  Out of the row's flow, inside a column that is in it. Every card's height is
  the layout engine's answer and every arrow below a card is aimed at it, so a
  button that took a single pixel of a row's height would push the rest of the
  file down and take the whole column of arrows with it. Its width is another
  matter entirely — see the strip below, which is where the horizontal room
  comes from.

  In the column the grips use, at the same offset, because it is the same
  control at two moments of one gesture: press it and it becomes the grip on the
  near end of the range. Sitting it over the line number instead — where it was
  — meant the affordance appeared by covering the digits it was offering to talk
  about, so a row read `1[+]5` for as long as the pointer was on it, and then the
  button jumped sideways the instant the drag began.

  Clear of the numbers, then, for the reason the grips are: the numbers are
  exactly what the reader is reading while they decide how far a passage should
  reach. The rail either side of it still starts the gesture, so hover, press
  and drag remain one movement.
-->
{#snippet plus(at: { side: Side; line: number }, name: "left" | "right")}<button
    type="button"
    class="pick-hint"
    data-rail={name}
    data-gutter={at.side}
    data-line={at.line}
    title="Comment on this line, or drag to take several"
    aria-label="Comment on line {at.line}">+</button>{/snippet}

<!--
  A handle on one end of the passage being chosen.

  Two of them, one per end, and each moves its own end: adjusting a range is the
  thing a reviewer does most after making one, and without a grip at the top the
  only way to change where a passage starts is to throw it away and drag it
  again.

  In the strip between the numbers and the code, over neither. A handle centred
  on the gutter covers the number of the row it marks; one over the head of the
  line covers the first characters of it, and the rail joining two of them runs
  down through the text of everything in between — which is the state this was
  found in, with a chosen passage the one part of a card that could not be read.

  Each end is its own element on its own row, so taking hold of one never looks
  like the other jumping across the card to meet the pointer.
-->
{#snippet handle(at: { side: Side; line: number }, which: End)}<button
    type="button"
    class="pick-grip"
    data-end={which}
    data-gutter={at.side}
    data-line={at.line}
    title={which === "start" ? "Drag to move the start of this range" : "Drag to move the end of this range"}
    aria-label={which === "start" ? "Start of the range, line " + at.line : "End of the range, line " + at.line}
  >+</button>{/snippet}

<!--
  The strip the picking marks are drawn in, between the numbers and the code.

  A column of the row rather than an overlay on one. The offer and the grips
  used to be positioned over the head of the code, which meant that choosing a
  passage covered the first three characters of every line in it and ran the
  rail down through the text of all of them — the reader could no longer read
  what they were picking. Putting them back over the line numbers is no better:
  those digits are exactly what is being read while a range is decided. So the
  marks get a column of their own and take space from neither.

  Its width is `--pick-column`, which is the layout engine's, not this
  stylesheet's. Every card was sized in the extension host before this page
  existed and every arrow was placed against those sizes, so a strip invented
  here would push the code past the width the card was measured at and clip the
  end of each long line.

  It is a rail like the numbers beside it. It has to be: the offer appears while
  the pointer is on a gutter, and a strip that stood for no line would put the
  button away the moment the reader moved towards it.

  Present on every row, whether or not a remark can start on this one. Where the
  code begins is a fact about the card — one offset, the same on every line, the
  one the engine measured and the one the symbol outlines count characters from.
  A strip that came and went with the patch would step the code in and out down
  a single card, and would move every line of a file the reader ticked off as
  read.
-->
{#snippet strip(sides: Rail[])}{@const stands = sides.find((side) => side.at)}{@const
  held = sides.find((side) => side.at && side.end)}{@const
  offered = sides.find((side) => side.at && hint === side.name)}<span
    class="pick-column"
    data-rail={stands ? stands.name : null}
    data-gutter={stands?.at?.side}
    data-line={stands?.at?.line}
  >{#if held?.at && held.end}{@render handle(held.at, held.end)}{:else if offered?.at}{@render plus(offered.at, offered.name)}{/if}</span
  >{/snippet}

<!--
  The sign saying what happened to a line.

  Only a sign. It used to arm the comment rail as well, on the grounds that it
  and the number together are the strip a remark begins from — but it is the
  outermost column of the card, and that is where an arrow lands: the circle at
  the end of a reference sits on the card's edge, over this. Arming a comment
  from here made the circle unreachable, so following a reference back was
  impossible on any line the change had touched. The number and the strip beside
  it still begin a remark, and they are what the reader reaches for.
-->
{#snippet sign(mark: string, at: { side: Side; line: number } | null, name: "left" | "right")}<span
    class="marker"
    data-gutter={at?.side}
    data-line={at?.line}
    data-side={name}>{mark}</span>{/snippet}

<!-- One side of a split row: its marker, its line number, and its code. -->
{#snippet pane(
  side: RowView | undefined,
  which: "base" | "head",
  one: boolean,
  name: "left" | "right",
)}
  {@const only = line(side)}
  {#if !only}
    <!-- Nothing on this side of the change: not blank code, no code. -->
    <span class="side {which} empty"></span>
  {:else}
    <!--
      The gutter says which line it stands for, and says nothing at all when it
      stands for none. Which is what keeps the card's pointer handler from
      working the rule out a second time: it reads the answer off the rail
      instead of deciding again whether this side of this row is in the patch.
    -->
    {@const at = canComment ? commentOn(only, which, one) : null}
    <!-- On a one-sided file the number shown is whichever side the file has. -->
    {@const shown =
      (one
        ? (only.newLine ?? only.oldLine)
        : which === "base"
          ? only.oldLine
          : only.newLine) ?? ""}
    <!--
      The sign sits beside the number that exists, which in two panes means at
      the outer edge of the pane holding it: a minus at the start of the base,
      where the line was removed from, and a plus at the end of the head, where
      it was added. That is the same story the coloured strips down the card's
      two edges already tell, and the same rule the single-column reading uses.

      Decided by the pane rather than by the line, so every row in a pane has
      its gutter in the same place. Moving the sign only for the rows that carry
      one would put the numbers of a context line and an inserted line in
      different columns, a row apart.
    -->
    {@const last = one ? only.newLine !== undefined : which === "head"}
    {@const spot = paneLine(only, which, one)}
    {@const grip = endAt(ends, at)}
    <span
      class="side {which} {only.kind}"
      class:in-diff={only.inDiff}
      class:picked={picked(at)}
      class:sign-last={last}
    >
      {#if !last}{@render sign(only.kind === "del" ? "−" : "", at, name)}{/if}
      <span
        class="num"
        data-rail={at ? name : null}
        data-gutter={at?.side}
        data-line={at?.line}>{shown}</span
      >
      {@render strip([{ at, name, end: grip }])}
      <span class="text">{@render code(only)}{@render outlines(
          boxesFor(only, [spot && markKey(spot.side, spot.line)]),
        )}</span>
      {#if last}{@render sign(only.kind === "add" ? "+" : "", null, name)}{/if}
    </span>
  {/if}
{/snippet}

{#if band}
  <!--
    A collapsed run of untouched code. One that knows what it hides can be
    opened; one that does not — a jump between hunks, whose lines were never
    read — must not pretend otherwise, so it is rendered inert.

    The role and the tab stop arrive together or not at all; the compiler checks
    them one at a time and cannot see that.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="row gap"
    class:expandable={!!band.rows}
    class:imports={band.imports}
    class:beyond-cap={beyondCap}
    class:in-gap={inGap}
    class:revealed
    class:open
    class:picked={bandPicked}
    title={band.header ?? ""}
    data-base-from={band.covers?.base?.[0]}
    data-base-to={band.covers?.base?.[1]}
    data-head-from={band.covers?.head?.[0]}
    data-head-to={band.covers?.head?.[1]}
    role={band.rows ? "button" : undefined}
    tabindex={band.rows ? 0 : undefined}
    onclick={toggle}
    onkeydown={onKey}
  >
    <span class="text">{band.text}</span>
    <span class="header">{band.header ?? ""}</span>
  </div>

  <!--
    The lines the band stands in for, written out whether or not it is open.
    Expanding is then a matter of revealing rows that are already there, and the
    browser's own search still finds code inside a closed band.
  -->
  {#each behind as inner, i (pair ? pairKey(inner as RowPair, i) : rowKey(inner as RowView, i))}
    {#if pair}
      <Row
        pair={inner as RowPair}
        {single}
        {nodeId}
        {canComment}
        {marks}
        {beyondCap}
        {revealed}
        inGap
        gapOpen={open}
      />
    {:else}
      <Row
        row={inner as RowView}
        {single}
        {nodeId}
        {canComment}
        {marks}
        {beyondCap}
        {revealed}
        inGap
        gapOpen={open}
      />
    {/if}
  {/each}
{:else if pair}
  <!--
    The base of the change beside the head of it. The line numbers double as
    anchors: after an expansion the arrows find a row by the line it shows
    rather than by an index that has since moved, and a row carries both, one
    from each pane.
  -->
  <div
    class="row split"
    class:just-changed={flash === "changed"}
    class:just-added={flash === "added"}
    class:in-diff={inDiff(pair.left) || inDiff(pair.right)}
    class:beyond-cap={beyondCap}
    class:in-gap={inGap}
    class:revealed
    class:open
    data-old={line(pair.left)?.oldLine}
    data-new={line(pair.right)?.newLine}
    onpointerover={onRail}
    onpointerout={offRail}
  >
    {#if single}
      <!-- A one-sided file has a single numbering, and one pane to show it in. -->
      {@render pane(pair.right ?? pair.left, "head", true, "left")}
    {:else}
      {@render pane(pair.left, "base", false, "left")}
      {@render pane(pair.right, "head", false, "right")}
    {/if}
  </div>
{:else if row && row.kind !== "gap"}
  <!--
    One column of code, a gutter either side: the base number on the left and
    the head number on the right, which is how a reader of this card asks "where
    is this line in each checkout". A line that exists on one side only leaves
    the other column empty, the way the forge leaves it — the alternative is
    either the same number repeated down a whole insertion or a number the line
    does not have.

    Both signs share one column at the front of the row, the way every unified
    diff has ever written them: a plus and a minus in the same place, so the eye
    runs down a single edge to find what changed instead of tracking one column
    on the left for removals and another on the right for insertions. The plus
    used to sit at the far end beside the head number it was added at, on the
    argument that a sign belongs next to the number that exists — which is true
    of the split reading, where the two checkouts have a pane each, and is not
    how anybody reads a single column of code.
  -->
  <!--
    Each gutter answers for its own side of the change. The left one starts a
    remark on the base, the right one on the head, which is the same thing the
    two columns of numbers already say — and it is the only way to say anything
    about a line that was removed, since a deleted line exists nowhere but the
    base and has no number on the right at all.
  -->
  {@const before = canComment ? commentOn(row, "base", single) : null}
  {@const after = canComment ? commentOn(row, "head", single) : null}
  <!-- One column of code, so whichever gutter belongs to the picked side is
       the one carrying an end of the range. -->
  {@const beforeEnd = endAt(ends, before)}
  {@const afterEnd = endAt(ends, after)}
  <div
    class="row flat {row.kind}"
    class:just-changed={flash === "changed"}
    class:just-added={flash === "added"}
    class:in-diff={row.inDiff}
    class:beyond-cap={beyondCap}
    class:in-gap={inGap}
    class:revealed
    class:open
    class:picked={picked(before) || picked(after)}
    data-old={row.oldLine}
    data-new={row.newLine}
    onpointerover={onRail}
    onpointerout={offRail}
  >
    <!-- No rail here: this is the card's outermost column, and it is where an
         arrow lands. See the `sign` snippet above. -->
    <span
      class="marker"
      data-gutter={before?.side}
      data-line={before?.line}>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span
    >
    <!-- A wholly added or deleted file has one numbering, so both gutters carry it. -->
    <span
      class="num old"
      data-rail={before ? "left" : null}
      data-gutter={before?.side}
      data-line={before?.line}>{(row.oldLine ?? (single ? row.newLine : undefined)) ??
        ""}</span
    >
    <!-- Both gutters draw into the one strip, because there is one column of
         code and both ends of a range belong at the head of it. The strip
         stands for the base where the line has one, since that is the gutter it
         sits against; a line the change added has no base number, and it stands
         for the head instead rather than for nothing. -->
    {@render strip([
      { at: before, name: "left", end: beforeEnd },
      { at: after, name: "right", end: afterEnd },
    ])}
    <span class="text">{@render code(row)}{@render outlines(
        boxesFor(row, [markKey("base", row.oldLine), markKey("head", row.newLine)]),
      )}</span>
    <!-- The trailing gutter's button opens towards the code, which is on its
         left here — anchored to the far edge it would sit against the card
         border and read as part of the frame. -->
    <span
      class="num new"
      data-rail={after ? "right" : null}
      data-gutter={after?.side}
      data-line={after?.line}>{(row.newLine ?? (single ? row.oldLine : undefined)) ??
        ""}</span
    >
  </div>
{/if}

<style>
  .row {
    display: flex;
    height: var(--line-height);
    line-height: var(--line-height);
    font-size: var(--font-size);
    white-space: pre;
  }

  /* A line that has just changed under the reader.

     Yellow for a rewrite and green for an arrival, which is the same pair of
     meanings the rest of the page already uses — the point is to say *where*
     something happened, on a card of two hundred rows, in the seconds after it
     did. It fades out on its own rather than being cleared by a timer: the
     animation ends transparent, so a reader who was looking at another card
     comes back to code rather than to a page full of colour.

     Painted with an inset shadow rather than a background, because the row's
     own background is what says added, removed or untouched, and a line that
     was rewritten is still whichever of those it was. */
  .row.just-changed,
  .row.just-added {
    animation: line-touched 1400ms ease-out forwards;
  }
  .row.just-added { --touched: var(--added); }
  .row.just-changed { --touched: var(--warning); }

  @keyframes line-touched {
    0% {
      box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--touched) 34%, transparent);
    }
    45% {
      box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--touched) 26%, transparent);
    }
    100% {
      box-shadow: inset 0 0 0 999px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    /* The same fact, held still and then gone. */
    .row.just-changed,
    .row.just-added {
      animation: line-touched-still 1400ms steps(2, end) forwards;
    }
    @keyframes line-touched-still {
      0% {
        box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--touched) 30%, transparent);
      }
      100% { box-shadow: inset 0 0 0 999px transparent; }
    }
  }

  /* A run of changed lines is one block of colour, not a stack of them.
     Row heights are whole CSS pixels, but the canvas is scaled by a fraction, so
     two rows that share an edge land it between device pixels and the compositor
     antialiases both sides of it — a hairline of the page showing through every
     boundary. Each row paints one pixel up into its own kind of neighbour, which
     closes the seam without touching layout: a shadow occupies no space, so
     nothing that measures rows can notice. Adjacency does the work of a wrapper
     element, which would break the sibling rules that open and close bands.

     `--seam` is the canvas's, measured in its own units and kept in step with
     the zoom, so a seam is one device pixel wherever the reader happens to be.

     The neighbour is spelled out as global because the compiler cannot see it:
     each of these components renders one row, so the row beside it belongs to
     another instance and a scoped sibling selector is thrown away as matching
     nothing. Which is how the seams came back after the port — every boundary a
     hairline again, and no rule left in the stylesheet to explain it. */
  .row.split:has(.side.add) + :global(.row.split .side.add) { box-shadow: 0 var(--seam) 0 0 var(--add-bg); }
  .row.split:has(.side.del) + :global(.row.split .side.del) { box-shadow: 0 var(--seam) 0 0 var(--del-bg); }
  .row.split:has(.side.empty) + :global(.row.split .side.empty) { box-shadow: 0 var(--seam) 0 0 var(--gap-bg); }
  .row.flat.add + .row.flat.add { box-shadow: 0 var(--seam) 0 0 var(--add-bg); }
  .row.flat.del + .row.flat.del { box-shadow: 0 var(--seam) 0 0 var(--del-bg); }
  .row.gap + .row.gap { box-shadow: 0 var(--seam) 0 0 var(--gap-bg); }

  /* A collapsed run of untouched code, banded the way a diff viewer marks the
     part of a file it is not showing. */
  .row.gap {
    background: var(--gap-bg);
    color: var(--muted);
    font-size: calc(var(--font-size) - 1px);
    padding: 0 var(--padding);
    justify-content: space-between;
    gap: 12px;
  }

  /* Rows the card starts out hiding: past the height cap, or behind a closed
     band. Present in the document, absent from the picture — so the card is the
     height the layout engine measured, and the browser's own search still finds
     what is folded away.

     An open band beats the cap, as it did when these were three rules in one
     stylesheet: a reader who opened a band asked for its lines, and the cap is
     about the tail of the card rather than about them. */
  .row.beyond-cap,
  .row.in-gap { display: none; }
  .row.beyond-cap.revealed { display: flex; }
  .row.in-gap.open { display: flex; }

  /* Bands open and close rather than opening once, so a band keeps its row
     instead of dissolving into what it revealed and leaving no way back. */
  .row.gap.expandable.open { color: var(--gutter); }
  .row.gap.expandable.open .text::before { content: "▾ "; }
  .row.gap.expandable:not(.open) .text::before { content: "▸ "; }

  .row.gap.expandable {
    cursor: pointer;
    user-select: none;
  }
  .row.gap.expandable:hover { color: var(--text); }

  /* Sized to its words rather than stretched across the row: a box placed after
     the label is placed after the words, and a stretched span ends at the far
     side of the card. */
  .row.gap .text { flex: 0 0 auto; }

  /* The hunk header, which says which declaration the hidden run came out of.
     It gives way to the count beside it rather than pushing past the card: a
     flex item will not shrink below its own contents unless it is told it may,
     so the ellipsis asked for here could never happen and a header longer than
     the room left ran off the end of a narrow card, cut mid-word by the card's
     own clipping and pressed hard against the words it was supposed to be
     apart from. Which of the two gives way is not a choice: the count is the
     row's subject, and it is short. */
  .row.gap .header {
    color: var(--gutter);
    font-size: calc(var(--font-size) - 2px);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row.flat { padding: 0 var(--padding); }
  .row.flat.add { background-color: var(--add-bg); color: var(--added); }
  .row.flat.del { background-color: var(--del-bg); color: var(--removed); }
  .row.flat.add .marker, .row.flat.del .marker { color: inherit; }
  /* The head number keeps the whole trailing gutter now that no sign shares it.
     The fourteen pixels the sign used to occupy stay where they were, as this
     number's own margin, so the numbers sit in the column they always sat in
     and the code column is the width it was measured at — moving a mark must
     not move anything the layout engine counted. */
  .row.flat .num.new {
    width: var(--right-gutter-width);
    padding-right: 14px;
    padding-left: 8px;
  }

  /* An edge marker down both sides of the card, in the diff's own colours, so a
     run of changed lines is visible from further out than the code inside it can
     be read -- and so a row whose other side is empty still says what happened to
     it. Painted as the row's own background under the padding, which is the strip
     between the card border and where a pane begins. */
  .row.flat.add,
  .row.split:has(.side.add):not(:has(.side.del)) {
    background-image:
      linear-gradient(to right, var(--added) 0 3px, transparent 3px),
      linear-gradient(to left, var(--added) 0 3px, transparent 3px);
  }
  .row.flat.del,
  .row.split:has(.side.del):not(:has(.side.add)) {
    background-image:
      linear-gradient(to right, var(--removed) 0 3px, transparent 3px),
      linear-gradient(to left, var(--removed) 0 3px, transparent 3px);
  }
  /* A line rewritten in place: what it was on the left, what it became on the
     right, which is the same story the two panes tell. */
  .row.split:has(.side.del):has(.side.add) {
    background-image:
      linear-gradient(to right, var(--removed) 0 3px, transparent 3px),
      linear-gradient(to left, var(--added) 0 3px, transparent 3px);
  }

  /* Two panes: the base of the change on the left, the head on the right. Equal
     halves of the row, each with its own marker, number and code, so a line and
     the line that replaced it read across rather than down and both numbers are
     real. The card was measured as two of these plus its padding. */
  .row.split { padding: 0 var(--padding); }
  .row.split .side {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
  }
  /*
   * The seam between the two readings.
   *
   * Split, a card is two files side by side and nothing said where one ended
   * and the other began — the eye had to find the boundary from the line
   * numbers, on every row. A hairline down the pair, drawn on the right-hand
   * pane so it lands exactly on the join, and quiet enough that it is a
   * division rather than a rule: what is being separated is the same code
   * twice, not two different things.
   *
   * Inset rather than a border, because a border would take a pixel of width
   * from a pane whose width the layout engine has already decided.
   */
  .row.split .side + .side {
    box-shadow: inset 1px 0 0 0 color-mix(in srgb, var(--text) 14%, transparent);
  }
  /* Except where a run has already painted its own seam downwards: two
     shadows on one element replace each other, so the pair is written out. */
  .row.split:has(.side.add) + :global(.row.split .side.add + .side.add) {
    box-shadow:
      inset 1px 0 0 0 color-mix(in srgb, var(--text) 14%, transparent),
      0 var(--seam) 0 0 var(--add-bg);
  }
  .row.split:has(.side.del) + :global(.row.split .side.del + .side.del) {
    box-shadow:
      inset 1px 0 0 0 color-mix(in srgb, var(--text) 14%, transparent),
      0 var(--seam) 0 0 var(--del-bg);
  }
  .row.split:has(.side.empty) + :global(.row.split .side.empty + .side.empty) {
    box-shadow:
      inset 1px 0 0 0 color-mix(in srgb, var(--text) 14%, transparent),
      0 var(--seam) 0 0 var(--gap-bg);
  }

  .row.split .side.add { background: var(--add-bg); color: var(--added); }
  .row.split .side.del { background: var(--del-bg); color: var(--removed); }
  .row.split .side.empty { background: var(--gap-bg); opacity: 0.35; }

  .row .marker {
    width: 14px;
    /* Inside the marker's own box, which is border-box, so the gutter is still
       exactly as wide as the layout engine measured it. Without this the sign
       sits against the card border and reads as part of the frame. */
    padding-left: 5px;
    flex: 0 0 auto;
    color: var(--gutter);
  }
  /* The column the picking marks live in, kept clear of both its neighbours.
     Fixed rather than flexible: it is the engine's measurement, and a column
     that gave ground under a long line would move the code out from under the
     outlines the arrows draw on it. */
  .row .pick-column {
    flex: 0 0 var(--pick-column);
    width: var(--pick-column);
    /* What the marks inside are placed against. An element's own position moves
       neither it nor anything around it, so the row is untouched. */
    position: relative;
  }

  .row .num {
    color: var(--gutter);
    opacity: 0.85;
    font-size: calc(var(--font-size) - 1px);
    text-align: right;
    padding-right: 8px;
    width: calc(var(--gutter-width) - 22px);
    flex: 0 0 auto;
    user-select: none;
  }
  .row .side.add .marker, .row .side.del .marker { color: inherit; }

  /* The head pane's sign, moved to the end of that pane, takes its fourteen
     pixels with it — so the number gets them back as padding and both panes
     keep their numbers in the same column and start their code at the same
     offset. Given back rather than simply dropped: without it the head pane's
     gutter is fourteen pixels narrower than the base's, every line number on
     the right sits left of its neighbour on the left, and the two columns stop
     reading as columns. A pane that exists on one side only is measured the
     same way, so an empty facing pane changes nothing. */
  .row.split .side.sign-last .num {
    width: calc(var(--gutter-width) - 8px);
    padding-left: 14px;
  }
  /* Against the pane's outer edge, the way the leading sign is against the
     card's: the two read as a pair of margins rather than as one mark inside
     the code and one outside it. */
  .row.split .side.sign-last .marker {
    padding-left: 0;
    padding-right: 5px;
    text-align: right;
  }

  /* The word an arrow is about, outlined where it is written. An arrow reaching
     a line of forty characters is pointing at all of them, and the reader is
     left to guess which name was followed.

     Placed from the character width the layout engine used rather than from a
     measurement of the text: the arrows were placed against that number, and
     the box has to land on the same word they did. It also costs the row
     nothing — an outline over glyphs that are already there, out of the flow,
     so a card is the height it was counted at.

     It takes no presses. The rail beneath it starts a remark and the code
     beneath it is code; a box that swallowed either would be an outline that
     stopped the line working. */
  .symbol-box {
    position: absolute;
    top: 1px;
    height: calc(var(--line-height) - 2px);
    border-radius: 3px;
    pointer-events: none;
  }
  /* The colour is the reference's, not the line's: a line nobody touched can
     still be where an added call now lands, and colouring it by what happened
     to the line would say the opposite. */
  .symbol-box[data-change="added"] {
    border: 1px solid color-mix(in srgb, var(--added) 75%, transparent);
    background: color-mix(in srgb, var(--added) 16%, transparent);
  }
  .symbol-box[data-change="removed"] {
    border: 1px solid color-mix(in srgb, var(--removed) 75%, transparent);
    background: color-mix(in srgb, var(--removed) 16%, transparent);
  }
  .symbol-box[data-change="unchanged"] {
    border: 1px solid color-mix(in srgb, var(--unchanged) 65%, transparent);
    background: color-mix(in srgb, var(--unchanged) 14%, transparent);
  }

  /* min-width:0 is load-bearing: without it a flex item refuses to shrink below
     its own content, so a long pre-formatted line runs past the card border and
     out from under the line numbers. */
  .row .text {
    /* What the boxes above are placed against. An element's own position does
       not move it or anything around it, so the row is untouched. */
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Where a file ends without a newline. Sits after the last character rather
     than in a column of its own: it belongs to that line, and a card's height is
     counted in rows, so it must not take one. */
  .no-newline {
    display: inline-flex;
    vertical-align: -2px;
    margin-left: 0.7ch;
    color: var(--warning);
    opacity: 0.85;
  }
  .no-newline svg { display: block; }
  .no-newline:hover { opacity: 1; }

  /* ------------------------------------------------------------ picking lines */

  /* The rail is the only part of a row that offers to start a remark, and so
     the only part that says it can. Anywhere-on-the-row meant a stray press
     while reading opened a composer over the code, and the way out of that was
     to notice it had happened.

     Selected on the attribute rather than on a class, because the attribute is
     already the statement that this gutter stands for a line the forge can see:
     a gutter with no number in it, or one on a line Odin only fetched so an
     arrow had somewhere to land, does not carry it and does not light up. */
  .row .num[data-rail],
  .row .pick-column[data-rail] { cursor: cell; }
  .row .num[data-rail]:hover { color: var(--status-renamed); }

  /* Out of the row's flow, though not out of the card's width — the column
     below is in it. A card's height is the layout engine's count of its rows,
     and every arrow beneath the card is placed against that count, so a button
     that took even one pixel of a row's height would move the drawing at the
     moment the reader reached for it. Absolute costs nothing: the row is the
     height it was measured at whether these are showing or not.

     The offer and the grip it turns into are one control, so the only thing
     that separates them is what the pointer does next. */
  .pick-hint { cursor: cell; }

  /* `picked` no longer paints anything. The range is drawn as one box by the
     card, from the pieces of it that are on screen, and this is how a piece
     says it is one of them — a tint per row is exactly what left a hairline at
     every boundary once the canvas scale turned whole pixels into fractions.

     What the class still has to do is keep the row legible over that box. The
     box is opaque and painted by position, so anything in the row that is not
     also painted by position disappears underneath it. The code and the strip
     the marks sit in already are; the numbers, the change markers and a band's
     own words are not, and `position: relative` moves nothing while lifting
     them clear. */
  .row .num,
  .row .marker,
  .row.gap .text,
  .row.gap .header { position: relative; }

  /* Gutter grey on a lit background is the one place these numbers are hard to
     read, and a picked range is exactly when they are being read: the reader is
     about to quote them. */
  .row.flat.picked .num,
  .row.split .side.picked .num { color: var(--text); opacity: 0.9; }

  /* The two ends of the range, and the offer to begin one. The same button
     doing the same job, so they are the same button — the corners are barely
     rounded rather than the five pixels the old renderer used, which on a box
     this size read as a pill rather than as something to take hold of. */
  .pick-hint,
  .pick-grip {
    position: absolute;
    top: 1px;
    /* Inside the strip the row keeps for them, centred across it: two pixels
       clear of the last digit on one side and of the first character on the
       other. Written once so the offer and the two grips cannot come apart by
       one of them being moved and the others not.

       As wide as it is tall, which the strip is sized for. It was eighteen
       across against a sixteen-pixel row while it was floating over the code,
       where nothing constrained it; in a column of its own the square is what
       leaves the same air on both sides. */
    left: 2px;
    width: calc(var(--line-height) - 2px);
    height: calc(var(--line-height) - 2px);
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: var(--status-renamed);
    color: var(--action-ink);
    font: inherit;
    font-weight: 700;
    font-size: calc(var(--font-size) + 1px);
    line-height: calc(var(--line-height) - 2px);
    text-align: center;
    user-select: none;
    z-index: 2;
  }
  .pick-hint:hover,
  .pick-grip:hover { filter: brightness(1.15); }

  /* Clear of the numbers and clear of the code, which is the whole reason the
     strip exists: a grip centred on the gutter covers the number of the row it
     marks, and one laid over the head of the line covers the words being
     picked. Both are what the reader is reading while they decide how far the
     passage should reach. */
  .pick-grip { cursor: ns-resize; }
</style>
