<!--
  What a tour has drawn: boxes around lines, and arrows between them.

  In the canvas's own units, inside the transformed layer, so the marks travel
  with the drawing through every flight. Each mark is placed from the card as it
  stands and from where that card says its lines are — not from where they were
  when the frame played — so a rebuild or a change of reading takes the marks
  with the code.

  The strokes and the labels are sized against the zoom: a guide's box has to
  read the same at a third of full size as at full size, and a two-pixel line in
  canvas units vanishes long before the code it is around does.
-->
<script lang="ts">
  import { model, view } from "../state.svelte.js";
  import type { Box } from "../canvas/wire.js";
  import { arrowPath } from "./drawing.js";
  import { markArea } from "./player.svelte.js";
  import { tour } from "./state.svelte.js";

  let {
    size,
    boxes,
  }: {
    size?: { width: number; height: number };
    /** Where the cards actually are, as the canvas placed them. */
    boxes: Record<string, Box>;
  } = $props();

  const zoom = $derived(Math.max(view.scale, 0.12));
  const weight = $derived(2.5 / zoom);
  const font = $derived(12 / zoom);

  const drawn = $derived.by(() => {
    const outlines: { key: string; box: Box; label?: string; quiet: boolean }[] = [];
    const arrows: { key: string; d: string; head: string }[] = [];

    tour.marks.forEach((mark, index) => {
      const at = markArea(boxes, mark.nodeId, mark.side, mark.start, mark.end);
      if (!at) return;
      if (mark.kind === "highlight") {
        outlines.push({ key: `h${index}`, box: at, label: mark.label, quiet: false });
        return;
      }
      if (!mark.to) return;
      const to = markArea(boxes, mark.to.nodeId, mark.to.side, mark.to.start, mark.to.end);
      if (!to) return;
      // Each end is outlined too, faintly, so it is plain which lines the arrow
      // means rather than only which card. The label stands on the end it lands
      // on: the middle of a long arrow is open canvas with neither end in sight.
      outlines.push({ key: `a${index}f`, box: at, quiet: true });
      outlines.push({ key: `a${index}t`, box: to, label: mark.label, quiet: true });
      const path = arrowPath(at, to);
      const reach = 4 * weight;
      const back = Math.cos(path.head.angle) * reach * 1.6;
      const head = `M ${path.head.x} ${path.head.y} L ${path.head.x - back} ${path.head.y - reach} L ${path.head.x - back} ${path.head.y + reach} Z`;
      arrows.push({ key: `a${index}`, d: path.d, head });
    });
    return { outlines, arrows };
  });
</script>

<svg
  class="tour-arrows"
  width={size?.width ?? model.current.width}
  height={size?.height ?? model.current.height}
>
  {#each drawn.arrows as arrow (arrow.key)}
    <path class="tour-wire" d={arrow.d} stroke-width={weight} />
    <path class="tour-head" d={arrow.head} />
  {/each}
</svg>

{#each drawn.outlines as outline (outline.key)}
  <div
    class="tour-box"
    class:quiet={outline.quiet}
    style:left="{outline.box.x}px"
    style:top="{outline.box.y}px"
    style:width="{outline.box.width}px"
    style:height="{outline.box.height}px"
    style:border-width="{weight}px"
    style:border-radius="{6 / zoom}px"
  >
    {#if outline.label}
      <span class="tour-label" style:font-size="{font}px">{outline.label}</span>
    {/if}
  </div>
{/each}

<style>
  .tour-arrows {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .tour-wire {
    fill: none;
    stroke: var(--tour, #4c8dff);
  }

  .tour-head {
    fill: var(--tour, #4c8dff);
  }

  /* Over the cards and under nothing the reader presses: a guide's mark points
     at code, it does not stand in the way of it. */
  .tour-box {
    position: absolute;
    box-sizing: border-box;
    border-style: solid;
    border-color: var(--tour, #4c8dff);
    background: color-mix(in srgb, var(--tour, #4c8dff) 8%, transparent);
    pointer-events: none;
    animation: tour-in 260ms ease-out;
  }

  .tour-box.quiet {
    border-color: color-mix(in srgb, var(--tour, #4c8dff) 55%, transparent);
    background: none;
  }

  .tour-label {
    position: absolute;
    left: 0;
    bottom: 100%;
    margin-bottom: 0.3em;
    padding: 0.15em 0.55em;
    border-radius: 0.4em;
    background: var(--tour, #4c8dff);
    color: #fff;
    font-family: var(--mono);
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
  }

  @keyframes tour-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tour-box {
      animation: none;
    }
  }
</style>
