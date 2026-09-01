<!--
  What an arrow says when the reader points at it.

  An arrow on the canvas is a coloured curve and nothing else: it can say that
  something in this file reaches something in that one, but not which call it
  is, nor which line at either end. Reading a reference without this means
  opening both files to find out what the line was for — the trip the graph
  exists to save.

  It lives in the page rather than on the canvas. The drawing sits inside one
  transformed layer, and a `position: fixed` box inside a transform is fixed to
  that transform, not to the window: the tooltip would be scaled along with the
  drawing and, at the four per cent a whole change is framed at, would be a
  smear a few pixels tall. So the element is moved to the body once it exists,
  where the only coordinates it can be given are the screen's.
-->
<script lang="ts">
  import type { EdgeView } from "../model.js";

  let {
    edge = null,
    at = null,
  }: {
    /** The arrow under the pointer, or nothing when the pointer is elsewhere. */
    edge?: EdgeView | null;
    /** Where the pointer is, in the window's own coordinates. */
    at?: { x: number; y: number } | null;
  } = $props();

  /**
   * Whether there is a document to hang this on.
   *
   * These components are also rendered to text by Node, which has no body to
   * move the box into and nobody to hover anything. An effect is the one thing
   * that does not run on that side, so it is what the question is asked
   * through — and it only ever answers yes, so the box is built once and then
   * lives for as long as the drawing does, exactly as the old page's did.
   */
  let here = $state(false);
  $effect(() => {
    here = true;
  });

  let box: HTMLDivElement | undefined = $state();

  let left = $state(0);
  let top = $state(0);

  const shown = $derived(edge !== null && at !== null);

  // Out of the canvas and onto the body, which is the whole point of the
  // component. Done from an effect rather than at render time because the
  // element does not exist until the block above it has been rendered.
  $effect(() => {
    if (box) document.body.appendChild(box);
  });

  /**
   * How big the box is, measured when what it says changes and not before.
   *
   * This used to be measured on every move, and measuring is not free: asking
   * an element for its rectangle makes the browser lay the page out there and
   * then, and the page under this one holds two hundred cards and six hundred
   * arrows. At sixty moves a second that is a full layout sixty times a second
   * for a box whose size has not changed — the reason following a line made the
   * drawing stutter under the hand.
   *
   * The size only depends on the words, so it is taken when the words change.
   */
  let size = $state({ width: 260, height: 64 });

  /*
   * Watched rather than asked.
   *
   * Asking an element for its rectangle makes the browser lay the page out then
   * and there, and the page under this one holds two hundred cards and six
   * hundred arrows: measured, one such question costs a fifth of a second, and
   * following a line across the drawing asks one per arrow crossed. That is the
   * stutter, and it is not fixed by asking less often — an observer is told the
   * answer by the layout the browser was going to do anyway.
   */
  $effect(() => {
    const element = box;
    if (!element || typeof ResizeObserver === "undefined") return;
    const watching = new ResizeObserver((seen) => {
      const rect = seen[0]?.contentRect;
      if (rect && rect.width > 0) size = { width: rect.width, height: rect.height };
    });
    watching.observe(element);
    return () => watching.disconnect();
  });

  /**
   * Where the box goes.
   *
   * Below and to the right of the pointer, so it never covers the arrow that
   * asked for it — and flipped above when it would otherwise run off the foot
   * of the window, which is exactly where arrows to the bottom of a column are
   * pointed at.
   */
  $effect(() => {
    const point = at;
    if (!point) return;

    const x = Math.min(point.x + 14, window.innerWidth - size.width - 12);
    let y = point.y + 18;
    if (y + size.height > window.innerHeight - 12) {
      y = Math.max(12, point.y - size.height - 12);
    }
    left = Math.max(12, x);
    top = y;
  });

  /**
   * File names only.
   *
   * The directory prefix of two files in the same project is mostly identical,
   * so it costs three wrapped lines to say almost nothing; the name is what
   * tells them apart.
   */
  function name(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
  }
</script>

{#if here}
  <!-- The full pair of paths stays on the element's own title, for the case
       where two files share a name and the tail alone is genuinely ambiguous. -->
  <div
    bind:this={box}
    class="tooltip {edge?.change ?? ''}"
    class:visible={shown}
    style:left="{left}px"
    style:top="{top}px"
    title={edge ? `${edge.fromPath} → ${edge.toPath}` : null}
  >
    {#if edge}
      <div class="target">{edge.label || edge.symbol || ""}</div>
      <div class="meta">
        {name(edge.fromPath)}<span class="at">:</span><span class="line">{edge.fromLine}</span>
        <span class="arrow">→</span>
        {name(edge.toPath)}<span class="at">:</span><span class="line">{edge.toLine}</span>
      </div>
      <div class="facts">
        <span class={edge.change}>{edge.change}</span> · {edge.kind} · {edge.confidence}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tooltip {
    position: fixed;
    /* The same rank the chrome has, which is where the old stylesheet put it.
       Taken from the scale rather than typed, because the number only means
       anything next to the other layers' — and read from the body, which the
       box is moved to, so it is the page's order it takes its place in and not
       the canvas's. Under the panels and the menus deliberately: a hint about
       something the pointer is resting on should never cover a conversation
       the reader has opened. */
    z-index: var(--z-chrome);
    max-width: 620px;
    padding: 7px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 92%, var(--text) 8%);
    border: 1px solid var(--panel-edge);
    /* Stated rather than inherited. The box is moved to the body, which does
       set this face — but the widths in the drawing were measured in it, and a
       component that quietly depends on where it happens to be parented is one
       that changes shape when it is parented somewhere else. */
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.5;
    /* The box follows the pointer, so a box that took the pointer would put
       itself between the hand and the arrow it is describing — and the arrow
       would report the pointer as having left the moment the hint appeared,
       which reads as a tooltip that flickers and cannot be aimed at. */
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .tooltip.visible { opacity: 1; }

  .tooltip .arrow { color: var(--unchanged); font-weight: 600; }
  .tooltip.added .arrow { color: var(--added); }
  .tooltip.removed .arrow { color: var(--removed); }

  .tooltip .target,
  .tooltip .meta {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* A line revealed here is read, not skimmed: it keeps its own spacing and
     breaks wherever it has to rather than being clipped a second time. */
  .tooltip .target {
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .tooltip .meta { color: var(--muted); }
  /* Dimmed so the eye can split "file" from "line" without a pause; run in the
     same colour they read as one long token. */
  .tooltip .meta .at { color: var(--gutter); margin: 0 1px; }
  .tooltip .meta .line { color: var(--text); opacity: 0.75; }

  /* What the reference is says something different from where it goes, so it is
     set apart rather than run on as a third line of the same grey. */
  .tooltip .facts {
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
    color: var(--gutter);
    font-size: 10px;
    letter-spacing: 0.02em;
  }
  .tooltip .facts .added { color: var(--added); }
  .tooltip .facts .removed { color: var(--removed); }
  .tooltip .facts .unchanged { color: var(--unchanged); }

  @media (prefers-reduced-motion: reduce) {
    .tooltip { transition: none; }
  }
</style>
