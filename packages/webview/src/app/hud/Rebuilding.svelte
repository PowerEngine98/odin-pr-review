<!--
  The picture is being read again, said where the reader is looking.

  The bar across the top already carries a spinner, and this does not replace
  it: that one sits among the pull request's facts — the title, the checks
  ring, the reviewers' faces — and reads as one more thing the forge has to say
  about the change. This is about the drawing underneath, and a reader halfway
  down a seventy-file canvas is not looking at the bar. It is the same two
  fields, in the place where a stale card is noticed.

  Bottom right, diagonally opposite the map, because the map is where the
  reader looks to find out where they are and this is where they look to find
  out whether what they are reading is current. Over the drawing rather than in
  it: the canvas is transformed, and a badge inside it would shrink with the
  zoom until the one thing saying "this is out of date" was too small to read.
-->
<script lang="ts">
  import { ui } from "../state.svelte.js";
</script>

{#if ui.refreshing}
  <div class="rebuilding" role="status" aria-live="polite">
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" opacity="0.25" />
      <circle
        class="arc"
        cx="8"
        cy="8"
        r="6.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-dasharray="10 29"
      />
    </svg>
    <span class="note">{ui.note}</span>
  </div>
{/if}

<style>
  .rebuilding {
    position: fixed;
    /* Both edges named, one of them `auto`. A fixed element given a left and a
       right is stretched between them rather than positioned twice, and the
       old renderer's stylesheet is still in this document with rules of its
       own — the map's corner learned this the hard way. */
    left: auto;
    right: 12px;
    bottom: 12px;
    /* The same layer as the map: in front of the marks, which are in front of
       the drawing. A comment mark drawn across this would hide the one thing
       saying the card underneath it is out of date. */
    z-index: var(--z-hud, 25);

    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 40vw;
    padding: 4px 8px;
    border-radius: 6px;
    /* The map's own box, so the two corners read as one instrument panel
       rather than as two unrelated things that happen to be in corners. */
    background: var(--panel-veil);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--muted);
    font-size: 11px;
    /* Nothing here is pressable, and a badge that swallowed a drag would make
       the corner of the canvas dead to the pan it is sitting on. */
    pointer-events: none;
    /* Fades in rather than appearing. Most rebuilds are now quick enough that
       a badge which snapped into existence would read as a flicker. */
    animation: arrive 160ms ease both;
  }

  svg {
    flex: 0 0 auto;
    color: var(--status-modified);
  }

  .note {
    /* A long note is trimmed rather than allowed to grow the badge across the
       drawing it is reporting on. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One path, so it turns as a single transform and costs nothing while the
     host is busy doing the thing this is reporting. */
  .arc {
    transform-origin: 8px 8px;
    animation: turn 900ms linear infinite;
  }

  @keyframes turn {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes arrive {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* A reader who has asked the system to stop animating things is not asking
     for a worse answer, only a still one. The words still say what happens. */
  @media (prefers-reduced-motion: reduce) {
    .rebuilding,
    .arc {
      animation: none;
    }
  }
</style>
