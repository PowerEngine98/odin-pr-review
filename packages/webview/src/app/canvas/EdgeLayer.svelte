<!--
  The arrows, under the cards.

  One SVG for the whole drawing rather than one per arrow: they are in canvas
  units, so the layer is placed once and every line in it moves with the camera
  for free.

  What is drawn is a function of the model, the reader's filters and where the
  cards ended up — so a filter changing, a card growing or a rebuilt graph
  arriving all redraw the arrows by the same route, and there is no longer a
  hand-written reroute pass that has to be remembered on each of those paths.
  Forgetting it on one of them was how arrows ended up pointing at where a card
  used to be.
-->
<script lang="ts">
  import type { EdgeView } from "../model.js";
  import { model, settings, ui } from "../state.svelte.js";
  import EdgeTip from "./EdgeTip.svelte";
  import { arrows, HEAD, type Box, type Journey, type LineAt } from "./wire.js";

  let {
    size,
    boxes,
    lineAt,
    onfollow,
  }: {
    /**
     * How much canvas there is, from whoever worked out where the cards went.
     *
     * The model's own figures are the engine's answer about the whole change in
     * the reading the page was built in, and this layer is drawn over a canvas
     * that may be neither — a part on its own, the other reading, a filter. A
     * layer of a different size from the surface it covers is a layer whose
     * coordinates are not the surface's.
     */
    size?: { width: number; height: number };
    /** Where the cards actually are, when something has placed them. */
    boxes?: Record<string, Box>;
    /** Which height on a card a line sits at, when the rows have been measured. */
    lineAt?: LineAt;
    /** Taking the reader to one end of an arrow: the camera's business, not ours. */
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

  /** Whether anything at all is under the reader's attention. */
  const quiet = $derived(ui.activeEdge !== null || ui.activeNode !== null);

  function lit(edge: EdgeView): boolean {
    if (ui.activeEdge !== null) return edge.id === ui.activeEdge;
    if (ui.activeNode !== null) return edge.from === ui.activeNode || edge.to === ui.activeNode;
    return false;
  }

  /**
   * The roads a gathered run travels, lit with whichever of their arrows is.
   *
   * The stems belong to their own arrows but the road belongs to one of them, so
   * following any other left the light stopping at the junction — the path to
   * the destination went dim exactly when the reader was trying to follow it.
   * Deriving the set of lit runs rather than lighting the followed arrow's own
   * elements is what fixes it: a road is lit because something travelling it is,
   * whoever happens to hold the path.
   */
  const litRuns = $derived(
    new Set(drawn.filter((a) => a.run !== null && lit(a.edge)).map((a) => a.run)),
  );

  function follow(edge: EdgeView, at: { x: number; y: number }, forward: boolean): void {
    ui.activeEdge = edge.id;
    onfollow?.({ edge, nodeId: forward ? edge.to : edge.from, x: at.x, y: at.y });
  }

  /**
   * The arrow being pointed at, and where the pointer is on the screen.
   *
   * Held here rather than derived from `ui.activeEdge`, because the shared flag
   * says which arrow is lit and nothing about the hand: an arrow lit by
   * following it, or by its card being picked, has no pointer anywhere near it,
   * and a hint has nowhere to go.
   */
  let pointed = $state<{ edge: EdgeView; x: number; y: number } | null>(null);

  /**
   * Shown only while the hint's arrow is still the lit one, so that everything
   * which puts the drawing back to rest — Escape, most of all — takes the hint
   * with it rather than leaving a box hanging over a canvas nothing is selected
   * on.
   */
  const hint = $derived(pointed !== null && ui.activeEdge === pointed.edge.id ? pointed : null);

  function enter(edge: EdgeView, event: MouseEvent): void {
    ui.activeEdge = edge.id;
    pointed = { edge, x: event.clientX, y: event.clientY };
  }

  function leave(): void {
    ui.activeEdge = null;
    pointed = null;
  }
</script>

<svg
  id="edges"
  class="edges"
  width={size?.width ?? model.current.width}
  height={size?.height ?? model.current.height}
>
  <!-- Sized in canvas units rather than in stroke widths: the stem is cut short
       by exactly the head's length, and a head that grew with the stroke — the
       wire thickens while it is followed — would leave that cut in the wrong
       place, with the line poking out past the triangle. -->
  <defs>
    {#each ["added", "removed", "unchanged"] as change (change)}
      <marker
        id="arrow-{change}"
        viewBox="0 0 10 10"
        refX="10"
        refY="5"
        markerUnits="userSpaceOnUse"
        markerWidth={HEAD}
        markerHeight={HEAD}
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" class="head-{change}" />
      </marker>
    {/each}
  </defs>

  {#each drawn as arrow (arrow.edge.id)}
    {@const active = lit(arrow.edge)}
    <!-- `data-run` says which gathered run this arrow travels with, for anything
         that has to find a whole run in the document. It is not what lights the
         road — that is derived, below — but a run is otherwise invisible from
         outside this component, and the minimap and the tests both ask. -->
    <g
      class="edge {arrow.edge.change} {arrow.edge.kind}"
      class:schema={arrow.schema}
      class:active
      class:dim={quiet && !active}
      data-id={arrow.edge.id}
      data-run={arrow.run}
    >
      <!-- A wide invisible stroke along the whole curve. A 1.8px line is not
           something a hand can point at, and the arrow is the thing this tool
           is for pointing at. -->
      <path
        class="hit"
        d={arrow.hit}
        role="button"
        tabindex="-1"
        aria-label="Follow {arrow.edge.symbol || arrow.edge.label || 'this reference'}"
        onmouseenter={(event) => enter(arrow.edge, event)}
        onmousemove={(event) => enter(arrow.edge, event)}
        onmouseleave={leave}
        onclick={(event) => {
          event.stopPropagation();
          follow(arrow.edge, arrow.wire.to, true);
        }}
        onkeydown={(event) => {
          if (event.key === "Enter" || event.key === " ") follow(arrow.edge, arrow.wire.to, true);
        }}
      />
      <path class="wire" d={arrow.stem} />
      <!-- The road onwards, when this arrow is the one carrying a gathered run,
           and the wider invisible stroke that makes it pressable. Both empty on
           an arrow that travels alone, which is most of them. -->
      <path
        class="road-hit"
        d={arrow.road}
        role="button"
        tabindex="-1"
        aria-label="Follow this run of references"
        onmouseenter={(event) => enter(arrow.edge, event)}
        onmousemove={(event) => enter(arrow.edge, event)}
        onmouseleave={leave}
        onclick={(event) => {
          event.stopPropagation();
          follow(arrow.edge, arrow.wire.to, true);
        }}
        onkeydown={(event) => {
          if (event.key === "Enter" || event.key === " ") follow(arrow.edge, arrow.wire.to, true);
        }}
      />
      <path
        class="trunk"
        class:lit={arrow.run !== null && litRuns.has(arrow.run)}
        d={arrow.trunk}
      />
      <path class="head" d={arrow.head} marker-end="url(#arrow-{arrow.edge.change})" />
      <!-- The dot where the arrow leaves takes you to where it lands; its
           opposite number, over in the port layer, brings you back. Following a
           reference across a large graph otherwise means finding the other end
           by eye and then finding your way home the same way. -->
      <circle
        class="port out"
        cx={arrow.wire.port.x}
        cy={arrow.wire.port.y}
        r="4.5"
        role="button"
        tabindex="-1"
        onclick={(event) => {
          event.stopPropagation();
          follow(arrow.edge, arrow.wire.to, true);
        }}
        onkeydown={(event) => {
          if (event.key === "Enter" || event.key === " ") follow(arrow.edge, arrow.wire.to, true);
        }}
      >
        <title>Go to the definition this points at</title>
      </circle>
    </g>
  {/each}
</svg>

<!-- Beside the drawing rather than in it. The hint is page furniture: it is
     placed against the screen the pointer is on, and everything inside the SVG
     above is in canvas units. It is rendered from this layer all the same,
     because this is the only place that knows both which arrow is being pointed
     at and where the hand is — the shared flag carries the first and nothing
     carries the second. -->
<EdgeTip edge={hint?.edge ?? null} at={hint ? { x: hint.x, y: hint.y } : null} />

<style>
  /* Every rule here is scoped, which is the point: these classes — `edge`,
     `dim`, `active`, `added` — are the most generic names in the drawing, and
     as global rules they collided with the cards and the tabs that use the same
     words. The dots over the cards are a separate component and carry their own
     copy of the few rules they need, rather than this block reaching into them
     with `:global`: each layer owning what it paints is what lets either be
     changed without reading the other. */

  .edges {
    position: absolute;
    inset: 0;
    overflow: visible;
    /* The layer covers the whole canvas, so anything but the lines themselves
       would swallow every click meant for a card underneath. */
    pointer-events: none;
  }

  path.wire {
    fill: none;
    stroke-width: 1.8;
    opacity: 0.85;
    transition: opacity 160ms ease, stroke-width 160ms ease;
  }

  /* Carries the head and nothing else: the stem already stopped where it starts. */
  path.head {
    fill: none;
    stroke: none;
  }

  .head-added { fill: var(--added); }
  .head-removed { fill: var(--removed); }
  .head-unchanged { fill: var(--unchanged); }

  /* A wide transparent stroke, so the line a reader is following is the line
     they can point at. */
  path.hit,
  path.road-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    pointer-events: stroke;
    cursor: pointer;
    outline: none;
  }

  /* The road a gathered run travels once its stems have met. Drawn like the
     stems, because it is the same journey continued. */
  path.trunk {
    fill: none;
    stroke-width: 1.8;
    opacity: 0.85;
    transition: opacity 160ms ease, stroke-width 160ms ease;
  }

  g.edge.added path.wire,
  g.edge.added path.trunk { stroke: var(--added); }
  g.edge.removed path.wire,
  g.edge.removed path.trunk { stroke: var(--removed); }
  g.edge.unchanged path.wire,
  g.edge.unchanged path.trunk { stroke: var(--unchanged); }

  /* An arrow that says what holds what, rather than what calls what. Dashed like
     an import, since it is a fact about the shape rather than about the change. */
  g.edge.schema path.wire,
  g.edge.schema path.trunk { stroke: var(--status-renamed); opacity: 0.55; }
  g.edge.import path.wire,
  g.edge.import path.trunk { stroke-dasharray: 4 4; opacity: 0.5; }

  g.edge.dim path.wire,
  g.edge.dim path.trunk { opacity: 0.12; }
  g.edge.active path.wire,
  g.edge.active path.trunk { opacity: 1; stroke-width: 3; }

  /* The road belongs to one arrow and is travelled by several, so it lights for
     whichever of them is being followed — even while that arrow's own group is
     the dimmed one. This has to outrank the dim rule above it, which is why it
     comes last rather than sitting with the other trunk rules. */
  path.trunk.lit,
  g.edge.schema path.trunk.lit,
  g.edge.dim path.trunk.lit { opacity: 1; stroke-width: 3; }

  /* The dot at the tail. Filled with the page's background rather than left
     hollow, so the wire behind it does not show through the ring. */
  circle.port {
    fill: var(--bg);
    stroke-width: 2.5;
    opacity: 0.9;
    cursor: pointer;
    pointer-events: all;
    transition: opacity 120ms ease;
    outline: none;
  }
  g.edge.added .port { stroke: var(--added); }
  g.edge.removed .port { stroke: var(--removed); }
  g.edge.unchanged .port { stroke: var(--unchanged); }
  g.edge.schema .port { stroke: var(--status-renamed); }

  g.edge:hover .port,
  g.edge.active .port { opacity: 1; }
  circle.port:hover { fill: var(--added); }
  g.edge.removed circle.port:hover { fill: var(--removed); }
  g.edge.unchanged circle.port:hover { fill: var(--unchanged); }

  /* A dimmed edge keeps its dot out of the way with it — including out of the
     way of the pointer, so a faded arrow cannot be pressed by accident while
     the reader is following a different one. */
  g.edge.dim .port { opacity: 0.1; pointer-events: none; }

  @media (prefers-reduced-motion: reduce) {
    path.wire,
    path.trunk,
    circle.port {
      transition: none;
    }
  }
</style>
