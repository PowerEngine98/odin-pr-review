<!--
  The surface the change is drawn on.

  One transformed layer with every card inside it, rather than a scrolling box:
  a card's coordinates then never change with pan or zoom, so the arrows, the
  marks and the minimap can all be computed from the same numbers the layout
  engine handed over. Everything that moves the picture moves this one
  transform.
-->
<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { travel, ui, view } from "../state.svelte.js";
  import * as camera from "./camera.svelte.js";
  import type { Placed } from "./camera.svelte.js";
  import EdgeLayer from "./EdgeLayer.svelte";
  import { listen as listenForKeys } from "./keyboard.svelte.js";
  import { lineAt } from "./measured.svelte.js";
  import PortLayer from "./PortLayer.svelte";
  import SchemaMarks from "./SchemaMarks.svelte";
  import type { Box, Journey } from "./wire.js";

  let {
    /**
     * What goes in a slot.
     *
     * The canvas owns where a card is and how big it is; what a card says about
     * its file comes from the change rather than from the view model, so it is
     * rendered by whoever has the diff to hand. A slot with nothing in it is
     * still the right size in the right place, which is what the arrows and the
     * framing are computed from — so a page that cannot draw its cards yet still
     * draws a picture of the change.
     */
    card = undefined,
    /** Following an arrow: where the camera is moved from is not this layer. */
    onfollow = undefined,
  }: {
    card?: Snippet<[Placed]>;
    onfollow?: (journey: Journey) => void;
  } = $props();

  let viewport: HTMLDivElement;

  const cards = $derived(camera.shown());
  const size = $derived(camera.extent());

  /**
   * Where the cards actually ended up, for everything drawn against them.
   *
   * The arrows, the dots and the schema marks each work out their own geometry
   * from the same numbers rather than being handed shapes, but none of them can
   * know about a part being closed up or a card that measured taller than it was
   * counted at. That is this pass's answer, and it is handed over.
   */
  const boxes = $derived<Record<string, Box>>(
    Object.fromEntries(cards.map((placed) => [placed.node.id, placed])),
  );

  /**
   * Which cards are on the canvas, said once for everyone who asks.
   *
   * The map draws these and no others and the reviewer list shows the faces
   * belonging to them, and both of them are outside the canvas. Deriving the
   * rule again in each of them is how three places come to disagree about it.
   *
   * Published as the component initialises as well as from an effect, because a
   * page rendered to a string on the server runs no effects: the map and the
   * list would be told the canvas was empty, which is a different answer from
   * not having been told yet.
   */
  const onCanvas = $derived(new Set(cards.map((placed) => placed.node.id)));
  ui.visible = onCanvas;
  /*
   * The side bar presses; the canvas flies.
   *
   * The list is a different document with no camera in it, so its presses
   * arrive as messages and the page has to be told who can act on one. Filled
   * here rather than declared in the state module because the camera only
   * exists while a canvas is mounted — and emptied on the way out, so a press
   * arriving after this component has gone finds nobody home instead of
   * reaching into a viewport that is no longer there.
   */
  $effect(() => {
    travel.toFile = (path) => camera.showFile(path);
    travel.toLine = (path, line, side) => camera.showLine(path, line, side, true);
    return () => {
      travel.toFile = undefined;
      travel.toLine = undefined;
    };
  });

  $effect(() => {
    ui.visible = onCanvas;
  });

  /**
   * The wheel is bound by hand because the listener has to be able to refuse
   * the gesture. A passive listener cannot call preventDefault, and without it
   * a pinch zooms the whole webview and a two-finger scroll walks the document
   * out from under the drawing.
   */
  $effect(() => {
    const element = viewport;
    const onWheel = (event: WheelEvent) => camera.wheel(event, element);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  /**
   * The keys, which act on the drawing and are pressed anywhere.
   *
   * Bound here rather than in the page above, because what they do is walk this
   * canvas and move this camera — and bound from an effect rather than at the
   * top of the module, so that nothing is reached for while the same components
   * are being rendered to text by Node, where there is no document to bind to.
   */
  $effect(listenForKeys);

  /**
   * Framed once the viewport is real, and watched for the rest of the session.
   *
   * A ResizeObserver rather than the window's resize event: the panel this sits
   * in is resized by dragging a divider or hiding a side bar, neither of which
   * changes the size of the window, and both of which change the size of the
   * room the drawing has.
   */
  $effect(() => {
    const element = viewport;
    camera.start(element);
    const watch = new ResizeObserver(() => camera.reframe(element));
    watch.observe(element);
    return () => watch.disconnect();
  });

  /**
   * Framed again once the cards have said what they really are.
   *
   * A browser only reports a card's height after it has drawn one, so the first
   * frame is fitted to the engine's estimates and the drawing then changes shape
   * underneath it — a tall card settling can push the foot of its column clean
   * out of the view the reader was just handed. The old renderer measured before
   * it framed, in one synchronous pass; here the measurement comes back a beat
   * later, so the framing follows it.
   *
   * Only while the reader has not placed the view themselves, the same rule a
   * resize follows: someone who has zoomed in on two cards has said where they
   * want to be, and a card settling is no reason to take them somewhere else.
   *
   * What is read here is the size and nothing else. Fitting writes the camera —
   * including the very flag this consults — and an effect that watched those
   * would refit because it had just refitted, for as long as anyone let it.
   */
  $effect(() => {
    const room = size;
    untrack(() => {
      if (view.placed || !room.width || !room.height) return;
      camera.fit(viewport);
    });
  });
</script>

<div
  class="viewport"
  class:panning={camera.motion.panning}
  bind:this={viewport}
  onpointerdown={(event) => camera.beginPan(event, viewport)}
  onpointermove={camera.dragPan}
  onpointerup={(event) => camera.endPan(event, viewport)}
  onpointercancel={(event) => camera.endPan(event, viewport)}
>
  <div
    class="canvas"
    class:moving={camera.motion.moving}
    class:flying={camera.motion.flying}
    style:--flight="{camera.motion.flight}ms"
    style:width="{size.width}px"
    style:height="{size.height}px"
    style:transform="translate({view.x}px, {view.y}px) scale({view.scale})"
    style:--zoom={view.scale}
  >
    <!--
      In the order they are drawn: the arrows under the cards, the dots that lead
      back over them, and the marks beside them. All three are in canvas units,
      so they belong inside this layer and nowhere else — placed anywhere above
      it they would stand still while the drawing moved under them.
    -->
    <EdgeLayer {size} {boxes} {lineAt} {onfollow} />

    <!--
      Keyed by file id, so a rebuild that reorders the list moves cards rather
      than rebuilding them: a card is a few hundred rows of markup, and the
      reader's scroll inside an open one is worth more than the reordering.
    -->
    {#each cards as placed (placed.node.id)}
      <div
        class="card-slot"
        class:empty={!card}
        data-id={placed.node.id}
        data-path={placed.node.path}
        style:left="{placed.x}px"
        style:top="{placed.y}px"
        style:width="{placed.width}px"
        style:height="{placed.height}px"
      >
        {@render card?.(placed)}
      </div>
    {/each}

    <SchemaMarks {boxes} />
    <PortLayer {size} {boxes} {lineAt} {onfollow} />
  </div>
</div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    cursor: grab;
  }

  .viewport.panning {
    cursor: grabbing;
  }

  .canvas {
    position: absolute;
    transform-origin: 0 0;
    /* Deliberately not promoted at rest. A layer carrying will-change:
       transform is rasterised once and then stretched as a bitmap, so zooming
       in magnifies pixels instead of redrawing glyphs — code goes soft exactly
       when it is being read closely. Promotion is granted only while the view
       is moving, where the trade is worth it, and given back on settle so the
       browser redraws the text at the scale it is actually shown. */
    will-change: auto;
    /* What one device pixel is worth in the canvas's own units, for whatever is
       drawn inside. The seams between rows of the same colour are closed by
       painting a little way into the neighbour, and a fixed amount shrinks with
       the zoom: at a third of full size a one-pixel overlap covers a third of a
       pixel, and the hairline comes back everywhere at once. */
    --seam: calc(-1px / var(--zoom, 1));
  }

  /*
   * The only time the drawing is animated rather than dragged.
   *
   * Panning must never carry a transition — the canvas has to be under the
   * pointer on the frame the pointer moved, and easing it puts the drawing
   * behind the hand holding it. Following a reference is the opposite case:
   * nobody is holding anything, the destination was chosen for the reader, and
   * arriving without having seen the journey means arriving lost.
   *
   * Eased out rather than in and out. The move is a consequence of a press that
   * has already happened, so it should leave at once and settle gently, not
   * pause first as though deciding.
   */
  .canvas.flying {
    transition: transform var(--flight, 420ms) cubic-bezier(0.22, 1, 0.36, 1);
  }

  .canvas.moving {
    will-change: transform;
  }

  /* Where the card goes. It holds the size and the place the arrangement gave
     it so that the drawing is already the right shape — the arrows land where
     they will land, and fit frames what it will frame — before the card itself
     is here to fill it. */
  .card-slot {
    position: absolute;
  }

  /* Drawn only while there is nothing in it. An outline around a card that has
     arrived reads as a second border half a card's border-radius away from the
     first. */
  .card-slot.empty {
    border: 1.5px dashed var(--muted, #888);
    border-radius: 14px;
    opacity: 0.4;
  }
</style>
