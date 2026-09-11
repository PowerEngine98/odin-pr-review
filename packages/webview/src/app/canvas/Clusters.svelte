<!--
  The folders, drawn as boxes around the cards that live in them.

  Behind everything: a box is a place the cards are in, and one drawn over them
  would be a pane of glass across the thing the reader came to look at. It is
  told apart from a card by being fainter and by holding others, rather than by
  being drawn in a different kind of line.

  Nothing here is placed. The banding puts a folder's cards in the same run of
  canvas in every column, which is what makes a folder a rectangle at all, and
  these are the rectangles they came out as. A box with a position of its own
  would be a second opinion about where a folder is.
-->
<script lang="ts">
  import { view } from "../state.svelte.js";

  import { CLUSTER_HEAD, pinHead } from "./heading.js";
  import type { FolderBox } from "./placement.js";

  let {
    folders = [],
    /**
     * What the reader can see, in canvas units.
     *
     * A folder box is routinely wider than the window — that is what makes it a
     * folder rather than a card — so panning right takes its left edge, and its
     * name with it, off the side of the screen. The same thing happens to a
     * card, and this is the same answer: the name slides along its own bar.
     */
    viewLeft = 0,
    viewRight = 0,
    /**
     * The bottom of the bar across the top, in window pixels.
     *
     * The same number the cards are given, and for the same reason: it is where
     * the drawing stops being visible, and the header has to stay under it.
     */
    chromeBottom = 0,
  }: {
    folders?: FolderBox[];
    chromeBottom?: number;
    viewLeft?: number;
    viewRight?: number;
  } = $props();

  /**
   * How far a name slides along its own bar to stay in view.
   *
   * Horizontally, and stopping at the far end of the box rather than following
   * the window for ever, on the same terms as the vertical pin: a folder's name
   * never outlives the box it is about. Left alone, a reader panning through a
   * wide folder has a dotted rule across the top of the screen and nothing
   * saying which folder it is.
   */
  function slide(box: FolderBox): number {
    if (!viewLeft && !viewRight) return 0;
    const off = Math.max(0, viewLeft - box.x);
    if (off <= 0) return 0;
    // Never past the point where the name would leave the box's far end: the
    // bar is the folder's, and a name pinned beyond it belongs to nothing.
    return Math.min(off, Math.max(0, box.width - NAME_ROOM));
  }

  /** Room the name and its count need, so the slide can stop before the edge. */
  const NAME_ROOM = 180;

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
   *
   * The arithmetic is next door in `heading.ts` rather than here, because it is
   * the part of this component that two units meet in — the bar is window
   * pixels, a header is canvas units — and every version of that fault has
   * looked right at whatever zoom it was last seen at. `media` and `media/grid`
   * are both held against the top of the window at once, and a step that is not
   * exactly one header tall in the header's own units puts one name over the
   * other as the reader zooms in and leaves them adrift as they zoom out.
   */
  function pin(box: FolderBox): number {
    return pinHead({ chromeBottom, y: view.y, scale: view.scale }, box);
  }
</script>

{#each folders as box (box.path)}
  <div
    class="cluster"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:z-index={40 - box.depth}
  >
    <!--
      A bar across the whole box, as a card's title is across the whole card.
      A pill floating at one corner reads as a label stuck onto the drawing;
      a bar reads as the top of the thing it names, which is what it is.

      Its height is the constant rather than a number in the stylesheet that
      happens to match it. The names are stacked one header apart, so a header
      drawn at any other size is names that overlap or names with daylight
      between them — and the two numbers sitting in two files is how they came
      to disagree in the first place.
    -->
    <div
      class="cluster-head"
      style:height="{CLUSTER_HEAD}px"
      style:transform="translateY({pin(box)}px)"
    >
      <span class="cluster-said" style:transform="translateX({slide(box)}px)">
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
      </span>
    </div>
  </div>
{/each}

<style>
  /*
   * An outer box's name sits over an inner one's.
   *
   * They are stacked by how deep they are, so a parent's bar is drawn above its
   * children's rather than under them. Held against the top of the window they
   * are a few pixels apart, and a child's bar drawn over its parent's leaves the
   * outer folder's name half covered by the inner one's — which is the wrong way
   * round: the outer name is the one that is about to go off screen, and the one
   * a reader has the least other way of recovering.
   */
  .cluster {
    position: absolute;
    /*
     * Solid, and quieter than a card's.
     *
     * Dotted read as provisional — a selection, or something still being
     * dragged — rather than as a container, and against a drawing of dotted
     * gap-bands and dashed marks it was one more broken line among several. A
     * box is a real thing the cards are in, so it gets a real edge, and it is
     * told apart from a card by being fainter and by holding others rather than
     * by being made of a different kind of line.
     */
    border: 1.5px solid color-mix(in srgb, var(--text) 26%, transparent);
    border-radius: 10px;
    /*
     * The corners belong to the box, so the box is what cuts them.
     *
     * The header drew its own rounded top, which is right only while it is
     * sitting at the top. Slid down to stay under the bar it took its corners
     * with it, so a bar with two curves in the middle of a folder sat inside
     * square walls — the shape saying "a box begins here" in a place where
     * nothing began. Clipped here instead, the header is square, and where it
     * happens to meet a corner the corner is the one the box already has.
     */
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 3%, transparent);
    /* Behind the cards, and out of the way of every gesture aimed at them: a
       box is a place, not a thing to be clicked. */
    pointer-events: none;
  }

  .cluster-head {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    align-items: center;
    /*
     * A header is as tall as it says it is, rule and all.
     *
     * The height itself is set on the element, from the same constant the
     * stacking steps by. What is said here is that the border along the bottom
     * counts towards it: nothing in this page resets the box model, so without
     * this the rule is a thirty-first unit hanging below a thirty-unit bar, and
     * every name in the column sits a unit over the one above it. A unit is a
     * quarter of a screen pixel pulled well back and three of them zoomed in,
     * so it is a seam that only appears once the reader is close enough to read
     * the names it is spoiling.
     */
    box-sizing: border-box;
    padding: 0 10px;
    /* Solid, because cards pass under it as the folder scrolls. */
    /*
     * Opaque, and said twice on purpose.
     *
     * Cards pass under this bar as the folder scrolls, and a header one can
     * read code through is a header that is illegible exactly when it is
     * needed. The mix is against the card background rather than against
     * nothing, so it is solid whatever the theme makes of it.
     */
    background: var(--card-bg);
    background: color-mix(in srgb, var(--text) 10%, var(--card-bg));
    border-bottom: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
  }

  /* What actually slides. The bar stays where the box is; the words inside it
     travel, so the bar never comes away from the folder it belongs to. */
  .cluster-said {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
