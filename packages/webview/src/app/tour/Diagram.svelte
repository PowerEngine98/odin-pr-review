<!--
  The picture a tour frame draws: in the drawing's own coordinates, in room
  the cards leave free, and only for as long as its frame lasts.
-->
<script lang="ts">
  import Diagram from "../panels/Diagram.svelte";
  import { tour } from "./state.svelte.js";
  import { diagramDrawn } from "./player.svelte.js";

  let box: HTMLDivElement | undefined = $state();

  function framed(id: number, svg: SVGSVGElement): void {
    const at = tour.diagram;
    if (!box || !at || at.id !== id) return;
    const outer = box.getBoundingClientRect();
    const inner = svg.getBoundingClientRect();
    if (outer.width <= 0) return;
    const scale = outer.width / at.width;
    diagramDrawn(id, {
      x: at.x + (inner.left - outer.left) / scale,
      y: at.y + (inner.top - outer.top) / scale,
      width: inner.width / scale,
      height: inner.height / scale,
    });
  }
</script>

{#if tour.active && tour.diagram}
  {#key tour.diagram.id}
    <div
      class="tour-diagram"
      bind:this={box}
      style:left="{tour.diagram.x}px"
      style:top="{tour.diagram.y}px"
      style:width="{tour.diagram.width}px"
      style:height="{tour.diagram.height}px"
      aria-label="A diagram the tour drew"
    >
      <Diagram
        code={tour.diagram.code}
        liftable={false}
        openable={false}
        ondrawn={(svg) => framed(tour.diagram!.id, svg)}
      />
    </div>
  {/key}
{/if}

<style>
  .tour-diagram {
    position: absolute;
    z-index: 4;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--status-renamed) 55%, transparent);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.4);
    overflow: hidden;
    pointer-events: none;
    animation: appear 260ms ease-out;
  }
  .tour-diagram :global(svg) {
    max-width: 100%;
    max-height: 100%;
    height: auto;
  }
  @keyframes appear {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
