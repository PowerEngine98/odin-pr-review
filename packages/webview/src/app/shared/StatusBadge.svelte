<!--
  What happened to a file, as a small filled square carrying a mark.

  Follows GitHub Desktop rather than printing a letter: at sidebar size the
  shape is what registers, and a reader picks out "green plus" long before they
  read anything. The card on the canvas draws the same square beside its title,
  so a file and its row are recognisably the same file.

  Drawn rather than typed. A glyph is centred on its font's baseline and side
  bearings, not on its box, so a plus, a bullet and an arrow each sat a
  different distance from the middle of the same square. These are centred on
  the box because the box is what they are drawn in.

  The colour is the caller's: everything here takes `currentColor`, so a row
  that sets `color` to the status's own colour gets a badge in it, and the card
  gets one in the colour its title is already wearing.
-->
<script lang="ts">
  let {
    status,
    size = 14,
  }: {
    status: string;
    /** The square's edge, in pixels. The list draws 14; a card's title, 13. */
    size?: number;
  } = $props();

  /*
   * The glyph, inset two pixels from the square on every edge.
   *
   * Derived rather than given, because the two have to move together: a caller
   * free to pick both would eventually pick a pair that does not fit, and the
   * mark would either touch the border or float in the middle of it.
   */
  const glyph = $derived(Math.max(size - 4, 0));
</script>

<span
  class="badge"
  class:untouched={status === "phantom"}
  style:width="{size}px"
  style:height="{size}px"
>
  <svg viewBox="0 0 10 10" width={glyph} height={glyph} aria-hidden="true">
    {#if status === "added"}
      <rect x="4.2" y="1.4" width="1.6" height="7.2" rx="0.6" fill="currentColor" />
      <rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor" />
    {:else if status === "modified"}
      <circle cx="5" cy="5" r="2.4" fill="currentColor" />
    {:else if status === "deleted"}
      <rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor" />
    {:else if status === "renamed"}
      <path
        d="M1.6 5h6M5.4 2.6 8.2 5 5.4 7.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {:else if status === "phantom"}
      <circle cx="5" cy="5" r="1.5" fill="currentColor" />
    {/if}
  </svg>
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border: 1px solid currentColor;
    border-radius: 3px;
    background: color-mix(in srgb, currentColor 16%, transparent);

    /*
     * Three rules, one job: nothing but the centring above may decide where
     * the mark lands.
     *
     * The border is counted inside the given size rather than added to it, so
     * the square the row was measured for is the square that is drawn. That is
     * the document's default and is said again here anyway, because a badge
     * that silently grew by two pixels wherever the default did not reach
     * would be a very quiet bug.
     *
     * The other two guard the axis that goes wrong first. An `<svg>` is an
     * inline element, and an inline element given a line box to sit in sits on
     * that line's baseline — which is below the middle, so the mark reads as
     * dropped. Measured, that is worth a whole pixel down and, once the
     * horizontal centring has gone with it, a pixel left: exactly the "low and
     * left" a glyph typed as a character gives you. The flex centring is what
     * prevents it here; zeroing the line height and the font size means there
     * is no line box to fall back to if some future rule ever takes that
     * centring away, and `display: block` on the drawing keeps it off the
     * baseline outright.
     */
    box-sizing: border-box;
    line-height: 0;
    font-size: 0;
  }

  .badge svg { display: block; }

  /* Dashed, like the canvas draws it: a file the change never touched is here
     because something points at it, and the broken border says the box stands
     for something outside the change rather than part of it. */
  .badge.untouched {
    background: transparent;
    border-style: dashed;
  }
</style>
