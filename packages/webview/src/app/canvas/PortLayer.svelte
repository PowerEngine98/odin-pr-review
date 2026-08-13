<!--
  The way back, drawn over the cards rather than under them.

  The dot at an arrow's head belongs just inside the card it arrives at — the
  head is already on the border, and a dot beyond it sits out in the canvas the
  arrow has just crossed. But the cards are painted after the arrows, so a dot
  inside one is a dot underneath it. It gets its own layer, laid over the cards,
  holding nothing but these.

  It works out the same routes the arrow layer does rather than being handed
  them. The two are separated by paint order, not by data: passing the geometry
  down would mean routing it through whichever component happens to sit above
  both, and that component would then own an arrangement it has no interest in.
  The routing is a pure function of the model and the reader's filters, so
  running it twice costs one pass over the edges and cannot disagree with itself.
-->
<script lang="ts">
  import type { EdgeView } from "../model.js";
  import { model, settings, ui } from "../state.svelte.js";
  import { arrows, type Box, type Journey, type LineAt } from "./wire.js";

  let {
    size,
    boxes,
    lineAt,
    onfollow,
  }: {
    /** How much canvas there is — the same answer the arrows are drawn over. */
    size?: { width: number; height: number };
    boxes?: Record<string, Box>;
    lineAt?: LineAt;
    onfollow?: (journey: Journey) => void;
  } = $props();

  const reading = $derived({
    unified: settings.unified,
    showTests: settings.showTests,
    showImports: settings.showImports,
    showUnchanged: settings.showUnchanged,
    showInfra: settings.showInfra,
    hideViewed: settings.hideViewed,
    part: ui.part,
    viewed: ui.viewed,
  });

  const drawn = $derived(arrows({ model: model.current, reading, boxes, lineAt }));

  const quiet = $derived(ui.activeEdge !== null || ui.activeNode !== null);

  function lit(edge: EdgeView): boolean {
    if (ui.activeEdge !== null) return edge.id === ui.activeEdge;
    if (ui.activeNode !== null) return edge.from === ui.activeNode || edge.to === ui.activeNode;
    return false;
  }

  /**
   * Home, which is where the arrow came from.
   *
   * An arrow read forwards leaves the reader somewhere they did not choose to
   * be, and the way back was a shape they had to find by eye; this is the same
   * journey offered in reverse, in the place they have just arrived at.
   */
  function back(edge: EdgeView, at: { x: number; y: number }): void {
    ui.activeEdge = edge.id;
    onfollow?.({ edge, nodeId: edge.from, x: at.x, y: at.y });
  }
</script>

<svg
  id="ports"
  class="edges"
  width={size?.width ?? model.current.width}
  height={size?.height ?? model.current.height}
>
  {#each drawn as arrow (arrow.edge.id)}
    {@const active = lit(arrow.edge)}
    <g
      class="edge {arrow.edge.change} {arrow.edge.kind}"
      class:schema={arrow.schema}
      class:active
      class:dim={quiet && !active}
      data-id={arrow.edge.id}
    >
      <circle
        class="port in"
        cx={arrow.wire.home.x}
        cy={arrow.wire.home.y}
        r="4.5"
        role="button"
        tabindex="-1"
        onclick={(event) => {
          event.stopPropagation();
          back(arrow.edge, arrow.wire.from);
        }}
        onkeydown={(event) => {
          if (event.key === "Enter" || event.key === " ") back(arrow.edge, arrow.wire.from);
        }}
        onmouseenter={() => (ui.activeEdge = arrow.edge.id)}
        onmouseleave={() => (ui.activeEdge = null)}
      >
        <title>Go back to where this is called from</title>
      </circle>
    </g>
  {/each}
</svg>

<style>
  /* The dots' rules are written out here rather than shared with the arrow
     layer through `:global`. They are three declarations and a colour per kind
     of change; a global block covering both layers would put the most generic
     class names in the drawing — `edge`, `port`, `dim` — into the page at
     large, where the cards and the tabs use the same words. */

  .edges {
    position: absolute;
    inset: 0;
    overflow: visible;
    /* Laid over every card, so anything but the dots themselves would swallow
       the clicks and the text selection meant for the code underneath. */
    pointer-events: none;
  }

  circle.port {
    fill: var(--bg);
    stroke-width: 2.5;
    cursor: pointer;
    pointer-events: all;
    transition: opacity 120ms ease;
    outline: none;
  }

  /* Quieter than the dot that sets out, because it is only worth looking for
     once the reader has arrived. */
  circle.port.in { opacity: 0.65; }
  g.edge:hover circle.port.in,
  g.edge.active circle.port.in { opacity: 1; }

  g.edge.added .port { stroke: var(--added); }
  g.edge.removed .port { stroke: var(--removed); }
  g.edge.unchanged .port { stroke: var(--unchanged); }
  g.edge.schema .port { stroke: var(--status-renamed); }

  circle.port:hover { fill: var(--added); }
  g.edge.removed circle.port:hover { fill: var(--removed); }
  g.edge.unchanged circle.port:hover { fill: var(--unchanged); }

  /* A dimmed edge keeps its dot out of the way with it, pointer and all: a
     faded arrow should not be pressable while the reader is following another. */
  g.edge.dim .port { opacity: 0.1; pointer-events: none; }

  @media (prefers-reduced-motion: reduce) {
    circle.port {
      transition: none;
    }
  }
</style>
