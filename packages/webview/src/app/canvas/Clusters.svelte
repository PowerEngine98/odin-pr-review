<!--
  The folders, drawn as boxes around the cards that live in them.

  Behind everything: a box is a place the cards are in, and one drawn over them
  would be a pane of glass across the thing the reader came to look at. Dotted,
  because a folder is not a file — a solid border would read as one more card,
  larger and empty, and the drawing already spends its solid lines on the things
  that hold code.

  Nothing here is placed. The banding puts a folder's cards in the same run of
  canvas in every column, which is what makes a folder a rectangle at all, and
  these are the rectangles they came out as. A box with a position of its own
  would be a second opinion about where a folder is.
-->
<script lang="ts">
  import { view } from "../state.svelte.js";

  import type { FolderBox } from "./placement.js";

  let {
    folders = [],
    /**
     * The bottom of the bar across the top, in window pixels.
     *
     * The same number the cards are given, and for the same reason: it is where
     * the drawing stops being visible, and the header has to stay under it.
     */
    chromeBottom = 0,
  }: { folders?: FolderBox[]; chromeBottom?: number } = $props();

  /** How tall a folder's own header is. Matches `CLUSTER_HEAD` in placement. */
  const HEAD = 30;

  /**
   * How far a header slides down its own box to stay in view.
   *
   * The card's problem exactly, and the card's answer: the canvas is one
   * transformed layer, so there is no scrolling ancestor for anything to be
   * sticky inside. A folder spanning half the drawing is worse off than a long
   * file — scroll past its top and there is nothing at all saying which folder
   * the eight cards on screen belong to.
   *
   * It stops at the foot of the box rather than following the bar for ever, so
   * a name never outlives the cards it is about: as the folder leaves, its
   * header slides out with it and the next folder's takes over.
   */
  function pin(box: FolderBox): number {
    // A pixel above the bar rather than level with it: level leaves a hairline
    // showing between the two once the canvas scale turns whole pixels into
    // fractions.
    const line = (chromeBottom - 1 - view.y) / view.scale;
    const offset = Math.floor(line - box.y);
    if (offset <= 0 || box.height <= HEAD) return 0;
    return Math.min(offset, box.height - HEAD);
  }
</script>

{#each folders as box (box.path)}
  <div
    class="cluster"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
  >
    <div class="cluster-head" style:transform="translateY({pin(box)}px)">
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <path
          d="M2.2 4.2a1 1 0 0 1 1-1h2.9l1.4 1.6h5.3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
      </svg>
      <span class="cluster-name" title={box.path}>{box.label}</span>
      <span class="cluster-count">{box.nodes.length}</span>
    </div>
  </div>
{/each}

<style>
  .cluster {
    position: absolute;
    /*
     * Dotted, and a folder rather than a file. A solid border here reads as one
     * more card — larger, emptier — and the drawing spends its solid lines on
     * the things that hold code.
     */
    border: 1.5px dotted color-mix(in srgb, var(--text) 30%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--text) 3%, transparent);
    /* Behind the cards, and out of the way of every gesture aimed at them: a
       box is a place, not a thing to be clicked. */
    pointer-events: none;
  }

  .cluster-head {
    position: absolute;
    left: 10px;
    top: 4px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px 2px 6px;
    border-radius: 999px;
    /* Solid, because cards pass under it as the folder scrolls. */
    background: color-mix(in srgb, var(--text) 12%, var(--card-bg));
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
  }

  .cluster-name { color: var(--text); }

  .cluster-count {
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 14%, transparent);
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
  }
</style>
