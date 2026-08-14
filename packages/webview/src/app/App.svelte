<!--
  The page — or, asked for it, only the drawing.

  The order things are laid down in is the order the old renderer used, and it
  is not arbitrary. The edges go under the cards because an arrow arriving at a
  card should disappear behind it; the ports go over them because the dot marking
  where an arrow landed belongs just inside the card it landed on, and a dot
  drawn under a card is a dot nobody sees. The marks float above everything,
  because they are placed in screen coordinates rather than canvas ones.

  `drawingOnly` is this application asked for less: the cards, the arrows and
  the schema marks in one SVG root and nothing around them, for a target that is
  a file rather than a page. Every piece of chrome the page carries is something
  to press, and a file has nothing behind any of it.

  It is not a second renderer, but it is not literally the same components
  either — a card there is drawn in SVG's own shapes, because SVG cannot hold
  the page's markup. What both readings share is everything above that: one
  model, one arrangement, one piece of arithmetic behind every arrow.
-->
<script lang="ts">
  import { untrack } from "svelte";

  import * as camera from "./canvas/camera.svelte.js";
  import { drop, gesture } from "./canvas/picking.svelte.js";
  import Canvas from "./canvas/Canvas.svelte";
  import Card from "./canvas/Card.svelte";
  import Chrome from "./chrome/Chrome.svelte";
  import Checks from "./hud/Checks.svelte";
  import Minimap from "./hud/Minimap.svelte";
  import Rebuilding from "./hud/Rebuilding.svelte";
  import Marks from "./marks/Marks.svelte";
  import type { ViewModel } from "./model.js";
  import Composer from "./panels/Composer.svelte";
  import ReviewPanel from "./panels/ReviewPanel.svelte";
  import Reviewers from "./panels/Reviewers.svelte";
  import Thread from "./panels/Thread.svelte";
  import {
    model as page,
    review,
    travel,
    ui,
    view,
    watchSettings,
  } from "./state.svelte.js";
  import type { Drawn } from "./svg/card.js";
  import Drawing from "./svg/Drawing.svelte";

  let {
    model,
    ssr = false,
    drawingOnly = false,
    drawn,
  }: {
    /**
     * Everything the page is drawn from.
     *
     * Absent in a browser, where the state module has already found it on
     * `window` and every component is watching that object. Handed in on the
     * server, where there is no window to have found it on.
     */
    model?: ViewModel;
    /**
     * There is no browser here.
     *
     * Nothing rendered under this may touch a document, a window or an
     * observer, or measure anything: the markup is being produced as text, by
     * something that has none of those and cannot be given them. What is
     * measured in a browser is measured after the page wakes up.
     */
    ssr?: boolean;
    /** Only the drawing, in one SVG root, for a target with no page around it. */
    drawingOnly?: boolean;
    /**
     * What the drawing needs and the view model does not carry: the palette,
     * the card geometry, and each card's lines already cut to width.
     */
    drawn?: Drawn;
  } = $props();

  // The model arrives as a prop on this side and is put where every component
  // already looks for it. Only on this side: in a browser the state module read
  // it from the document before anything mounted, and assigning an identical
  // object over the top would swap the one the whole page is watching.
  //
  // Read once and deliberately not tracked. There is nothing here to react to —
  // this rendering happens once and is handed back as text — and a tracked read
  // would make the assignment look like something that could run again.
  untrack(() => {
    if (ssr && model) page.current = model;
  });

  const current = $derived(page.current);

  /**
   * Whether the change has a schema in it.
   *
   * The settings menu offers the database switch only when there is something
   * for it to switch, because a control for something the change does not have
   * teaches the reader nothing.
   */
  const hasSchema = $derived(current.nodes.some((n) => n.kind === "database"));

  /**
   * Where the bottom of the chrome falls on the screen.
   *
   * A card's title sticks to the top of its card until the card has run out
   * from under the chrome, at which point it has to let go — otherwise a name
   * hangs in the bar over a file that has scrolled away. The chrome's height
   * depends on how much it has to say, so it is measured rather than assumed.
   */
  let chrome: HTMLElement | undefined = $state();
  let chromeBottom = $state(0);

  // Measured rather than derived: a bounding rectangle is not reactive state,
  // so reading one inside a `$derived` would give an answer that was true once
  // and never again. The bar changes height when it has more to say — a long
  // title wrapping, a second row of parts appearing — and none of that is a
  // resize of the window.
  $effect(() => {
    // The bar itself, not the element it was mounted into. The chrome is
    // fixed, so the wrapper around it is a box of zero height sitting at the
    // top of the document — measuring that gave every card a threshold of
    // nought, and a title only pins once its card has passed the bar, so no
    // title ever pinned.
    const bar = chrome?.querySelector<HTMLElement>(".chrome") ?? chrome;
    if (!bar) return;
    const measure = () => (chromeBottom = bar.getBoundingClientRect().bottom);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(bar);
    return () => watch.disconnect();
  });

  /**
   * What the map is a window onto, which only the camera can answer.
   *
   * Not called `window`: a component that shadows the global one is a
   * component where every later reference to the real one silently means
   * something else.
   */
  const onScreen = $derived(camera.onScreen());

  /*
   * Which card the reader is on.
   *
   * The middle of the screen, not the last thing they pressed. A map of forty
   * rectangles answers "what shape is this change"; it only answers "where am
   * I in it" if one of them is you — and that has to keep being true while
   * they pan, which a highlight set by following an arrow does not.
   *
   * The card under the centre wins outright; when the centre falls in the gap
   * between cards nothing is marked, because guessing at the nearest one makes
   * the highlight jump about as the reader crosses open canvas.
   */
  const centred = $derived.by(() => {
    const win = onScreen;
    if (!win.width || !win.height) return ui.activeNode;
    const x = win.left + win.width / 2;
    // The middle of what can be seen, not of the element. The chrome covers the
    // top of the viewport, so the geometric centre sits above the reader's own
    // — and the card marked "you are here" was the one about forty pixels over
    // their eye line rather than the one they were reading.
    const hidden = chromeBottom / view.scale;
    const y = win.top + hidden + (win.height - hidden) / 2;
    const on = camera
      .shown()
      .find((c) => x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height);
    // Nothing under the middle: keep whatever the reader last arrived at, so a
    // pan across empty canvas does not clear the one mark that says where they
    // came from.
    return on ? on.node.id : ui.activeNode;
  });

  /**
   * The cards on the canvas, at the coordinates they were actually drawn at.
   *
   * Not `model.nodes`, which carries the layout engine's estimate for the whole
   * change. Once a part is open the canvas has packed the cards back to the
   * margin and replaced their estimated heights with measured ones, so the two
   * describe different drawings — and a map built from the model frames itself
   * on a picture nobody is looking at, with a window that cannot line up
   * because the coordinates underneath it are not the ones on screen.
   *
   * The placement is the single answer to where a card is. The map takes it
   * from the same place the arrows do.
   */
  const visible = $derived(
    camera.shown().map((placed) => ({
      ...placed.node,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
    })),
  );

  /**
   * The two places the side bar can send the reader.
   *
   * Answered here because this is already where arriving somewhere is decided —
   * the canvas hands up a followed arrow and this marks the card, the edge and
   * moves the camera — and a press in the file list means exactly what a press
   * on the arrow means. The state module routes the host's messages and knows
   * nothing about a camera; what it lacks is somewhere to send them, which is
   * this.
   *
   * From an effect so that nothing is registered while the same components are
   * rendered to text by Node, where there is no camera and no side bar, and so
   * that a page taken down leaves no handler behind pointing at a drawing that
   * has gone.
   */
  /*
   * The way out, whatever has gone wrong.
   *
   * A passage stays picked until something drops it, and its two handles sit
   * over the code the whole time — so any path that closes the composer without
   * dropping the pick leaves the reader one press away from opening it again,
   * and they have found several. Rather than keep patching the paths, Escape
   * always ends it: the box goes, the passage is let go, and any open thread
   * closes with them. It costs one listener and it means no future way of
   * getting into that state can be a way of staying in it.
   */
  $effect(() => {
    const out = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!ui.composer && !ui.thread && !gesture.pick) return;
      ui.composer = null;
      ui.thread = null;
      drop();
    };
    window.addEventListener("keydown", out);
    return () => window.removeEventListener("keydown", out);
  });

  /*
   * The reader's choices, handed to the only thing that outlives the page.
   *
   * One effect over the whole object rather than a call from each control: a
   * checkbox added later is carried without anybody remembering to wire it up,
   * and there is nowhere for a control to forget.
   */
  $effect(watchSettings);

  $effect(() => {
    travel.toFile = (path) => {
      const id = camera.showFile(path);
      // The mark the map falls back on, so that arriving from the list says the
      // same thing about where the reader is as arriving from a key or an arrow.
      if (id) ui.activeNode = id;
    };
    travel.toLine = (path, line, side) => {
      const at = camera.showLine(path, line, side);
      if (!at) return;
      ui.activeNode = at.nodeId;
      ui.activeEdge = at.edgeId;
    };
    return () => {
      travel.toFile = undefined;
      travel.toLine = undefined;
    };
  });
</script>

{#if drawingOnly}
  <!-- Both are required to draw anything, and neither has a sensible stand-in:
       a drawing with no model is an empty picture, and one with no palette is
       an invisible one. -->
  {#if model && drawn}
    <Drawing {model} {drawn} />
  {/if}
{:else}
  <div class="chrome-mount" bind:this={chrome}>
    <Chrome
      meta={current.meta}
      {hasSchema}
      pending={review.drafts.length}
      onFit={camera.fitNow}
      onReview={() => (review.open = true)}
    />
  </div>

  <!-- Following a reference. The point to land on travels with the request
       rather than being looked up here: by the time the camera has moved, the
       numbers that described where it was going are describing where it has
       been. -->
  <Canvas onfollow={(journey) => {
    ui.activeNode = journey.nodeId;
    ui.activeEdge = journey.edge.id;
    camera.centreOn(journey.x, journey.y);
  }}>
    {#snippet card(placed)}
      <Card
        node={placed.node}
        left={placed.x}
        viewLeft={onScreen.left}
        viewRight={onScreen.left + onScreen.width}
        rows={placed.node.rows ?? []}
        title={placed.node.title}
        splitCap={placed.node.splitCap}
        unifiedCap={placed.node.unifiedCap}
        single={placed.node.single}
        top={placed.y}
        {chromeBottom}
      />
    {/snippet}
  </Canvas>

  <!-- Over the canvas rather than in it: a mark is placed against where a row
       has ended up on the screen, and a layer inside the transformed canvas
       would be scaled along with the drawing — a comment at ten per cent zoom
       would be a comment nobody could press. -->
  <Marks />

  <Thread
    openId={ui.thread?.id ?? null}
    anchor={ui.thread?.anchor ?? null}
    onclose={() => (ui.thread = null)}
  />

  <Composer
    {chromeBottom}
    where={ui.composer}
    anchor={ui.composer?.anchor ?? null}
    lines={ui.composer?.lines ?? []}
    bind:drafts={review.drafts}
    oncancel={() => {
      ui.composer = null;
      // The picked passage goes with the box that was about it.
      //
      // Closing the composer alone left the range chosen and its two handles
      // sitting over the code, so the next press anywhere near it took hold of
      // one, and letting go opened the composer again. Cancelling put the
      // reader in a loop they could only leave by reloading the page.
      drop();
    }}
    onadded={() => {
      ui.composer = null;
      // Said, and therefore over. Leaving the range picked after a remark has
      // been written invites the same handle to be grabbed for a passage the
      // reader has already finished talking about.
      drop();
    }}
  />

  <Reviewers
    reviewers={current.meta.pullRequest?.reviewers ?? []}
    visible={ui.visible.size > 0 ? ui.visible : null}
    onshow={(thread) => (ui.thread = { id: thread.root.id, anchor: null })}
  />

  <!-- The top of the same corner the map has the bottom of: one is anchored
       above and the other below, so they never meet. -->
  <Checks chromeHeight={chromeBottom} />

  <Minimap window={onScreen} {visible} here={centred} />

  <!-- The other corner: where the reader is, saying whether what is under them
       is still current. -->
  <Rebuilding />

  <!-- Bound, not merely rendered.
       Both of these are `$bindable`, and neither was tied to anything: the
       panel kept its own `open` at false while the bar's button set
       `review.open` beside it, so pressing Submit review did nothing at all —
       and the drafts it would have listed were a different empty array from the
       one the composer appends to. -->
  <ReviewPanel bind:open={review.open} bind:drafts={review.drafts} />
{/if}
