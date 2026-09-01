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
  import { afterTheFrame, bridgesAt, crossed } from "./bridges.svelte.js";
  import {
    arrows,
    detours,
    secondPass,
    sharedRoads,
    HEAD,
    type Arrow,
    type Box,
    type Journey,
    type LineAt,
  } from "./wire.js";

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

  /*
   * The bridges are a stage of their own, after the frame the arrows go up in.
   *
   * Which roads cross which cannot be known until every road is planned, and
   * planning them all is the last thing this pass does — so sweeping for
   * crossings inside it would delay the thing the reader is waiting for in
   * order to decorate it. The geometry hands the sweep back here to be
   * scheduled, and reading the counter is what makes a finished sweep redraw
   * these arrows with their hops on.
   */
  secondPass.run = afterTheFrame;
  const drawn = $derived.by(() => {
    void bridgesAt();
    return arrows({ model: model.current, reading, boxes, lineAt });
  });

  /**
   * The lanes several roads ended up sharing, drawn under all of them.
   *
   * Read after the arrows rather than worked out here: the roads are moved onto
   * the lanes as part of laying them out, so the lanes are what that pass left
   * behind. Deriving it from `drawn` is what keeps the two in step — a lane
   * drawn from a placement the arrows are no longer using would be a grey line
   * under nothing.
   */
  const shared = $derived.by(() => {
    void drawn;
    return sharedRoads();
  });

  /**
   * The roads are planned around the cards once the cards have stopped moving.
   *
   * During the first build every card that measures itself moves the ones
   * below it, and each move throws away every road planned against where they
   * were. Planning through that is two and a half seconds of a large boot,
   * measured, spent on arrangements that were replaced before they were drawn.
   *
   * So the drawing waits for a quiet moment and plans then. What the reader
   * sees is arrows taking the plain way for the first second and then finding
   * their way around the cards — the same shape the bridges appear in, and a
   * beat the cover is usually still up for.
   */
  const QUIET = 250;
  let settling: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    /*
     * The cards moving, and nothing else.
     *
     * Watching the arrows instead looks equivalent and is not: they are
     * rebuilt for a hover, for a bridge sweep, for anything at all, so on a
     * large change they never go quiet for a quarter of a second and the roads
     * were never planned. Where the cards are is the only thing planning
     * depends on, and it does settle.
     */
    void boxes;
    void model.current;
    if (detours.on) return;
    settling = setTimeout(() => {
      detours.set(true);
      // The arrows are derived from this, so turning the roads on is what
      // redraws them. Without it the plans exist and nothing asks for them.
      crossed();
    }, QUIET);
    return () => clearTimeout(settling);
  });

  /**
   * Whether the drawing is hushed so one thing can be read.
   *
   * Not for a hover. Fading six hundred arrows means the browser resolving the
   * rule against every one of them and repainting the whole layer, and doing
   * that as the pointer crosses each hit area on its way somewhere is what the
   * flicker was: a fifth of a second of repainting per crossing, measured, with
   * a fifth of the time going to garbage collection. Pointing at a line now
   * lights that line and leaves the rest alone.
   *
   * A deliberate choice still hushes everything — following an arrow, picking a
   * card — because that is a reader who has said which one thing they are
   * reading, and it happens once rather than continuously.
   */
  const quiet = $derived(ui.activeNode !== null || (ui.activeEdge !== null && !hovering));

  /** Whether the lit arrow is lit because a pointer is resting on it. */
  let hovering = $state(false);

  function lit(edge: EdgeView): boolean {
    if (ui.activeEdge !== null) return edge.id === ui.activeEdge;
    if (ui.activeNode !== null) return edge.from === ui.activeNode || edge.to === ui.activeNode;
    return false;
  }

  /**
   * Which arrow is lit, marked on the document rather than derived per arrow.
   *
   * `class:active={lit(arrow.edge)}` inside the list reads the shared flag from
   * every one of six hundred blocks, so one hover re-runs all six hundred:
   * measured, five milliseconds of script per pointer crossing, on top of the
   * repaint. Nothing about that work is per arrow — one arrow stops being lit
   * and one starts — so the two elements are found and marked directly.
   *
   * The road a gathered run travels is marked with them. The stems belong to
   * their own arrows but the road belongs to one of them, so lighting only the
   * followed arrow's own elements left the light stopping at the junction —
   * dim exactly where the reader was trying to follow it.
   */
  let layer: SVGSVGElement | undefined = $state();
  let marked: Element[] = [];

  /* An id as it can be written inside an attribute selector. Ids come from the
     graph rather than from this page, and one with a quote in it would end the
     selector early and match something else. */
  const quoted = (value: string) => value.replace(/["\\]/g, "\\$&");

  $effect(() => {
    const edgeId = ui.activeEdge;
    const nodeId = ui.activeNode;
    // Re-marked after a rebuild as well as after a hover: the elements the last
    // pass marked may not be in the document any more.
    void drawn;
    const root = layer;
    if (!root) return;

    for (const element of marked) element.classList.remove("active", "runlit");
    marked = [];

    const light = (group: Element) => {
      group.classList.add("active");
      marked.push(group);
      const run = group.getAttribute("data-run");
      if (!run) return;
      for (const other of root.querySelectorAll(`g.edge[data-run="${run}"] path.trunk`)) {
        other.classList.add("runlit");
        marked.push(other);
      }
    };

    if (edgeId !== null) {
      const group = root.querySelector(`g.edge[data-id="${quoted(edgeId)}"]`);
      if (group) light(group);
      return;
    }
    if (nodeId !== null) {
      for (const group of root.querySelectorAll(
        `g.edge[data-from="${quoted(nodeId)}"], g.edge[data-to="${quoted(nodeId)}"]`,
      )) {
        light(group);
      }
    }
  });

  function follow(edge: EdgeView, at: { x: number; y: number }, forward: boolean): void {
    // Chosen rather than pointed at, which is what hushes the rest of the
    // drawing: the reader has said which one thing they are reading.
    hovering = false;
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

  /**
   * The pointer moved enough to be worth answering.
   *
   * Every move over an arrow used to replace this state, and replacing it makes
   * the hint measure itself — a synchronous layout of a document holding
   * thousands of paths, on every one of the sixty-odd events a second a hand
   * produces while it is still. What the reader saw was the drawing stuttering
   * whenever the cursor rested on a line.
   */
  const NUDGE = 4;

  function enter(edge: EdgeView, event: MouseEvent): void {
    if (going !== undefined) {
      clearTimeout(going);
      going = undefined;
    }
    hovering = true;
    ui.activeEdge = edge.id;
    const was = pointed;
    if (
      was &&
      was.edge === edge &&
      Math.abs(was.x - event.clientX) < NUDGE &&
      Math.abs(was.y - event.clientY) < NUDGE
    ) {
      return;
    }
    pointed = { edge, x: event.clientX, y: event.clientY };
  }

  /**
   * Let go a beat late.
   *
   * The hit areas are wide and they touch, so following a line means crossing
   * in and out of several of them — and each crossing put the whole drawing
   * back to full brightness and dimmed it again, which is a flash across every
   * arrow on the page. The gap between leaving one and entering the next is a
   * few milliseconds; the gap before a reader has actually looked away is not.
   */
  const LINGER = 220;
  let going: ReturnType<typeof setTimeout> | undefined;

  function leave(): void {
    if (going !== undefined) clearTimeout(going);
    going = setTimeout(() => {
      going = undefined;
      hovering = false;
      ui.activeEdge = null;
      pointed = null;
    }, LINGER);
  }

  $effect(() => () => {
    if (going !== undefined) clearTimeout(going);
  });
</script>

<!--
  Whether anything is being attended to is said once, and acted on once.

  This has been wrong twice. First it was a `dim` class computed per arrow and
  rewritten whenever attention moved — a couple of thousand attribute updates
  for one crossing of one line. Then it was one class on the layer, which the
  browser still had to resolve against every arrow under it, and every one of
  those arrows had a transition on `opacity`: two thousand paths animating at
  once, twice for each hit area a pointer crosses on the way to the one it
  wants. Both of them look the same to a reader — the drawing flickering under
  the hand — and neither is about the class.

  So the fading is done to the group rather than to its members. Everything not
  being followed sits in one element whose opacity is set; the followed arrow is
  outside it, because a child cannot be brighter than the group it is in. Two
  elements change, whatever the size of the change.
-->
{#snippet oneArrow(arrow: Arrow)}
    <!-- `data-run` says which gathered run this arrow travels with, for anything
         that has to find a whole run in the document. It is not what lights the
         road — that is derived, below — but a run is otherwise invisible from
         outside this component, and the minimap and the tests both ask. -->
    <g
      class="edge {arrow.edge.change} {arrow.edge.kind}"
      class:schema={arrow.schema}
      data-id={arrow.edge.id}
      data-from={arrow.edge.from}
      data-to={arrow.edge.to}
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
      <!--
        The whole road, always.

        For a while a road that joined a lane drew only its ramps and let the
        lane draw the stretch they shared. It halved the ink and it was wrong:
        an arrow whose middle belongs to something else is an arrow that stops
        at a junction and never comes out, and that is what readers found — a
        red line into a grey lane, a green line beginning in mid-air. Roads of
        the same colour running together look like one road, which is what a
        shared lane is; the band underneath says how many, and nothing has to
        disappear to say it.
      -->
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
      <path class="trunk" d={arrow.trunk} />
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
{/snippet}

<svg
  id="edges"
  class="edges"
  class:quiet
  bind:this={layer}
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

  <!--
    The lanes several roads share, laid down before any of them.
    Wide and grey and behind everything: it is the road rather than a journey
    along it, so it must never be mistaken for an arrow — no colour, no head,
    nothing to press. Its width says how many go this way, up to a point past
    which one more makes no difference to a reader.
  -->
  {#each shared as lane (`${lane.axis}:${lane.at}:${lane.from}`)}
    <path
      class="highway {lane.change ?? 'mixed'}"
      style="stroke-width:{3 + Math.min(lane.users, 10) * 0.55}"
      d={lane.axis === "vertical"
        ? `M ${lane.at} ${lane.from} L ${lane.at} ${lane.to}`
        : `M ${lane.from} ${lane.at} L ${lane.to} ${lane.at}`}
    />
  {/each}

  <!--
    Every arrow, once, in one list that does not change when attention moves.

    Splitting them into "followed" and "the rest" reads better and measured
    three times worse: the lists are rebuilt on every hover, and rebuilding a
    keyed list of six hundred makes the compiler walk all six hundred. Which of
    them is lit is a class, and the browser is better at that than this is.
  -->
  {#each drawn as arrow (arrow.edge.id)}
    {@render oneArrow(arrow)}
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

  /* No transition on `opacity` here. Fading is the group's job now, and two
     thousand paths each animating their own opacity is precisely the flicker
     this drawing had. Width still animates: it is only ever the one arrow
     being followed. */
  path.wire {
    fill: none;
    stroke-width: 1.8;
    opacity: 0.85;
    transition: stroke-width 160ms ease;
  }

  /* The shared lane itself. Grey because it belongs to no arrow in particular,
     rounded at the ends so it reads as a stretch of road rather than a bar, and
     faint enough that the lines running along it are still the thing being
     read. */
  path.highway {
    fill: none;
    /* Grey only when the lane carries more than one kind of change; otherwise
       it wears the colour of what travels it, faded, because it is the road
       rather than a journey along it. */
    stroke: color-mix(in srgb, var(--text) 26%, transparent);
    stroke-linecap: round;
    pointer-events: none;
  }

  path.highway.added { stroke: color-mix(in srgb, var(--added) 42%, transparent); }
  path.highway.removed { stroke: color-mix(in srgb, var(--removed) 42%, transparent); }
  path.highway.unchanged { stroke: color-mix(in srgb, var(--unchanged) 38%, transparent); }

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
    transition: stroke-width 160ms ease;
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

  /* Everything that is not the one being followed, while one is. Said on the
     layer rather than on each arrow, and without a transition: six hundred
     paths fading in and out every time a pointer crosses a hit area is the
     flicker, and the fade is what makes it one. A state change that happens at
     once reads as the drawing answering. */
  .edges.quiet g.edge:not(.active) path.wire,
  .edges.quiet g.edge:not(.active) path.trunk { opacity: 0.12; }
  g.edge.active path.wire,
  g.edge.active path.trunk { opacity: 1; stroke-width: 3; }

  /* The road belongs to one arrow and is travelled by several, so it lights for
     whichever of them is being followed — even while that arrow's own group is
     the dimmed one. This has to outrank the dim rule above it, which is why it
     comes last rather than sitting with the other trunk rules. */
  path.trunk.runlit,
  g.edge.schema path.trunk.runlit,
  .edges.quiet g.edge:not(.active) path.trunk.runlit { opacity: 1; stroke-width: 3; }

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
  /* A faded arrow's dot goes with it, pointer and all: a line the reader is not
     following should not be pressable by accident. */
  .edges.quiet g.edge:not(.active) .port { opacity: 0.1; pointer-events: none; }

  @media (prefers-reduced-motion: reduce) {
    path.wire,
    path.trunk,
    circle.port {
      transition: none;
    }
  }
</style>
