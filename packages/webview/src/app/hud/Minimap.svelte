<!--
  The change as a shape, in the corner.

  Forty rectangles answer "what shape is this change". They only answer "where
  am I in it" if one of them is you, which is why the card under the middle of
  the screen is outlined. No title and no fold: the map is a picture, it says
  what it is, and the only thing worth offering is a way to be rid of it.
-->
<script lang="ts">
  import { model, view, settings } from "../state.svelte.js";
  import type { NodeView } from "../model.js";
  import { ODIN_MARK } from "../chrome/icons.js";
  import { pinnedHere } from "../canvas/pins.js";
  import {
    MAP_SIZE,
    bounds,
    fitMap,
    placeNode,
    placeWindow,
    pointAt,
    region,
    uncovered,
    type Window,
  } from "./map.js";

  let {
    /** What the reader can see, in the drawing's units. Measured by the canvas. */
    window: onScreen,
    /** The card under the middle of the screen, which is the one being read. */
    here = null,
    /** Cards the reader has filtered away, which the map should not be framed on. */
    visible,
  }: {
    window: Window;
    here?: string | null;
    visible: NodeView[];
  } = $props();

  /*
   * How much of the viewport the bar across the top is standing on.
   *
   * Measured rather than assumed, because it stacks and wraps with how much it
   * has to say, and re-measured on every reshaping of it for the same reason.
   * Read from the page rather than passed in: the camera reports the viewport,
   * and how much of the viewport is covered is a fact about the document that
   * only the document can answer. Nought until the effect has run, which is
   * also what it stays at when this is rendered to text in Node — a frame a
   * tenth too tall on a page nobody is steering is a better answer there than
   * reaching for a document that is not present.
   */
  let covered = $state(0);

  $effect(() => {
    const bar = document.querySelector(".chrome");
    if (!bar) return;
    const measure = () => (covered = bar.getBoundingClientRect().height);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(bar);
    return () => watch.disconnect();
  });

  /** What is really on screen, which is the window less the bar over its top. */
  let seen = $derived(uncovered(onScreen, covered / view.scale));

  /**
   * Drawings the reader pinned to the change, which are part of its shape.
   *
   * The map answers "what is here and where"; a picture somebody deliberately
   * put beside a card is as much an answer to that as the card. Drawn plainly
   * and in one neutral colour: the file rectangles carry the statuses, and a
   * fifth colour among them would read as a fifth thing that can happen to a
   * file.
   */
  const pinned = $derived(pinnedHere());

  let all = $derived(
    bounds([...visible, ...pinned], {
      x: 0,
      y: 0,
      width: model.current.width,
      height: model.current.height,
    }),
  );
  let box = $derived(region(all, seen));
  let fit = $derived(fitMap(box));
  let frame = $derived(placeWindow(seen, fit));

  /*
   * Whether the map has stopped changing shape.
   *
   * The first second of a page is three different maps: one drawn before the
   * cards have their real heights, one after they settle, one after the camera
   * frames the change. Showing all three is a flicker in the corner of the eye
   * that says something is wrong. The mark stands in until a redraw goes by
   * without another following it.
   */
  let settled = $state(false);
  let waiting: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Reading the fit is what subscribes this to every reshaping of the map.
    void fit;
    if (settled) return;
    if (waiting) clearTimeout(waiting);
    waiting = setTimeout(() => (settled = true), 260);
    return () => clearTimeout(waiting);
  });

  const split = $derived(!settings.unified);

  /*
   * Whether this file has something to say on both sides.
   *
   * A file that was only added has nothing on the base side and a file that was
   * only deleted has nothing on the head side — drawing either as two halves
   * would claim a removal or an insertion that never happened. Those keep the
   * single colour their status already gives them.
   */
  function sided(node: NodeView): boolean {
    return Boolean(node.title?.additions) && Boolean(node.title?.deletions);
  }

  /** Which colour a half takes: what that side of the diff did. */
  function sideOf(node: NodeView, which: "base" | "head"): string {
    return which === "base" ? "deleted" : "added";
  }

  function goTo(event: MouseEvent): void {
    const face = event.currentTarget as SVGSVGElement;
    const rect = face.getBoundingClientRect();
    const at = pointAt(event.clientX - rect.left, event.clientY - rect.top, fit);
    // Centred on what was pressed, at whatever zoom the reader is already
    // using. Jumping and zooming at once is two answers to one gesture.
    //
    // The middle of what can be seen, not of the viewport: the bar covers the
    // top of it, so centring on the viewport left the point the reader aimed at
    // sitting behind the bar — the same middle the camera uses when it flies to
    // a card, so a press on the map and a followed arrow arrive in the same
    // place.
    view.x = seen.width * view.scale / 2 - at.x * view.scale;
    view.y = covered + seen.height * view.scale / 2 - at.y * view.scale;
    view.placed = true;
  }
</script>

{#if settings.hud.map && box.width > 0 && box.height > 0}
  <div class="minimap" class:waiting={!settled}>
    <div class="head">
      <button
        class="close"
        title="Hide the map"
        aria-label="Hide the map"
        onclick={() => (settings.hud.map = false)}>×</button
      >
    </div>
    <!-- The mark stands in while the shape is still moving. Hidden rather than
         absent, so the box keeps its size and the corner does not jump when the
         map arrives. -->
    <div class="wait">{@html ODIN_MARK}</div>
    <svg
      class="face"
      width={MAP_SIZE}
      height={MAP_SIZE}
      viewBox="0 0 {MAP_SIZE} {MAP_SIZE}"
      role="presentation"
      onclick={goTo}
    >
      <g class="nodes">
        {#each visible as node (node.id)}
          {@const at = placeNode(node, fit)}
          {#if split && sided(node)}
            <!--
              A card read as two panes is drawn as two halves.

              Split view puts the base of the change on the left and the head on
              the right, and a reader glancing at the map is looking for the same
              shape they are reading. One flat colour per file answers "what
              happened to it"; two answers "and on which side", which is the
              question the split reading was opened to ask.
            -->
            <g class="pair">
              <rect
                class="on side {sideOf(node, 'base')}"
                x={at.x}
                y={at.y}
                width={at.width / 2}
                height={at.height}
              /><rect
                class="on side {sideOf(node, 'head')}"
                x={at.x + at.width / 2}
                y={at.y}
                width={at.width / 2}
                height={at.height}
              /><rect
                class="outline {here === node.id ? 'here' : ''}"
                x={at.x}
                y={at.y}
                width={at.width}
                height={at.height}
                rx="1"><title>{node.path}</title></rect
              >
            </g>
          {:else}
            <rect
              class="on {node.status} {here === node.id ? 'here' : ''}"
              x={at.x}
              y={at.y}
              width={at.width}
              height={at.height}
              rx="1"><title>{node.path}</title></rect
            >
          {/if}
        {/each}
        {#each pinned as one (one.id)}
          {@const at = placeNode(one, fit)}
          <rect class="map-pin" x={at.x} y={at.y} width={at.width} height={at.height} rx="1"
            ><title>diagram</title></rect
          >
        {/each}
      </g>
      <rect
        class="window"
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
      />
    </svg>
  </div>
{/if}

<style>
  .minimap {
    position: relative;
    position: fixed;
    /* One edge, said explicitly.
     *
     * The old renderer's stylesheet is still in the document and still has a
     * rule for this class name. A fixed element given both a left and a right
     * is not positioned twice — it is stretched between them, which turned a
     * 150px square into a box the width of the window. Naming both, with one
     * of them `auto`, is what keeps that from happening however the other
     * stylesheet is written. It goes away with the rest of that stylesheet. */
    left: 12px;
    right: auto;
    bottom: 12px;
    /* In front of the marks, which are in front of the drawing. A comment mark
       is anchored to a row on the canvas; the map is a fixed panel over the
       whole of it, and a mark drawn across it is a mark on top of the one
       control that says where you are. */
    z-index: var(--z-hud, 25);
    /* The square and its padding, and nothing beyond it. */
    width: max-content;
    border-radius: 6px;
    background: var(--panel-veil);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    padding: 4px;
  }

  /* Hidden rather than removed: taking the square out of the flow would make
     the corner jump the moment the map settled, which is the flicker the wait
     exists to avoid in the first place. */
  .minimap.waiting .face {
    visibility: hidden;
  }

  .wait {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    color: var(--text);
    pointer-events: none;
  }
  .minimap.waiting .wait {
    display: flex;
  }
  .wait :global(svg) {
    width: 46px;
    height: 46px;
  }

  .head {
    display: flex;
    justify-content: flex-end;
    height: 0;
  }

  .close {
    position: relative;
    top: -2px;
    right: -2px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    line-height: 1;
    padding: 2px 4px;
  }
  .close:hover {
    color: var(--text);
  }

  .face {
    display: block;
    cursor: pointer;
  }

  /*
   * The same palette the cards wear, not the diff's.
   *
   * A rectangle here stands for a file, and a card's border already says what
   * happened to that file — so the two have to be drawn from one vocabulary or
   * the map is a legend for a picture it does not match. The diff's green and
   * red are for lines; `--status-*` is for files, and this draws files.
   *
   * Every status is named. A file whose status has no rule falls through to a
   * neutral grey, which is indistinguishable from an untouched file that is
   * only on the canvas because something points at it — and "modified" was
   * doing exactly that, which is the most common status there is.
   */
  /*
   * The same palette the cards wear, at the strength the map was drawn at.
   *
   * A rectangle here stands for a file, and a card's border already says what
   * happened to it — so the two are drawn from one vocabulary, `--status-*`,
   * which is for files. The diff's green and red are for lines.
   *
   * Very faint on purpose. The map answers "what shape is this change" at a
   * glance and is looked past the rest of the time; forty saturated rectangles
   * in the corner compete with the drawing they are a map of. The one the
   * reader is on is the exception, and it earns its contrast by being the only
   * one.
   */
  .on {
    opacity: 0.07;
  }
  .on.added {
    fill: var(--status-added);
  }
  .on.modified {
    fill: var(--status-modified);
  }
  .on.deleted {
    fill: var(--status-deleted);
  }
  .on.renamed {
    fill: var(--status-renamed);
  }
  /* A pinned drawing: present, and not a file. Outlined in the text colour at
     the same weight the file rectangles are filled at, so it reads as furniture
     among them rather than as another status.

     Named apart from the drawing's own pins, which are a different element in a
     different layer: one class across both made `.pin` mean two things, and the
     first thing that asked the page how many there were got the wrong answer. */
  .map-pin {
    fill: color-mix(in srgb, var(--text) 14%, transparent);
    stroke: color-mix(in srgb, var(--text) 45%, transparent);
    stroke-width: 0.6;
  }

  /* Outlined rather than filled: it is in the picture because an arrow reaches
     it, not because the change did anything to it. */
  .on.phantom {
    fill: none;
    stroke: var(--status-phantom);
    stroke-width: 1;
  }

  /* Where the reader is. Its own colour at full strength around a block drawn
     at a fraction of it: the map stays quiet, and one rectangle in it does not. */
  .on.here {
    opacity: 0.5;
    fill-opacity: 0.16;
    stroke-width: 1;
    paint-order: stroke;
  }
  .on.added.here    { stroke: color-mix(in srgb, var(--status-added) 62%, transparent); }
  .on.modified.here { stroke: color-mix(in srgb, var(--status-modified) 62%, transparent); }
  .on.deleted.here  { stroke: color-mix(in srgb, var(--status-deleted) 62%, transparent); }
  .on.renamed.here  { stroke: color-mix(in srgb, var(--status-renamed) 62%, transparent); }
  .on.phantom.here  { stroke: color-mix(in srgb, var(--status-phantom) 62%, transparent); }

  /* The two halves of a split card, at the same strength as a whole one. */
  .side {
    opacity: 0.07;
  }
  .outline {
    fill: none;
  }
  .outline.here {
    stroke: color-mix(in srgb, var(--text) 62%, transparent);
    stroke-width: 1;
  }

  /*
   * What is on screen. An outline, because it is a window and not a thing.
   *
   * Faint fill, strong stroke: it is a frame around what the reader is already
   * looking at. At full strength it washed out the very rectangles it sits on,
   * and a hairline in the text colour vanished into them instead.
   */
  .window {
    fill: color-mix(in srgb, #fff 6%, transparent);
    stroke: color-mix(in srgb, #fff 62%, transparent);
    stroke-width: 1.5;
    paint-order: stroke;
    pointer-events: none;
  }
</style>
