<!--
  Something on disk moved and the picture is being rebuilt from it.

  At the right-hand end of the bar rather than over the drawing: a rebuild is a
  fact about the page, not about any file on it, and the reader is meant to be
  able to carry on reading through one. Quiet on purpose — muted text, a thin
  arc — because it appears on every save, and anything louder would be a reason
  to switch the watching off.
-->
<script lang="ts">
  let { on = false, note = "Refreshing" }: { on?: boolean; note?: string } = $props();
</script>

{#if on}
  <span class="refreshing" aria-live="polite">
    <svg class="spinner" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" opacity="0.25" />
      <circle class="spin-arc" cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="10 29" />
    </svg>
    <span class="note">{note}</span>
  </span>
{/if}

<style>
  .refreshing {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    color: var(--muted);
    /* Held apart from the tallies to its right: without it the spinner reads
       as belonging to the checks ring, which is a different kind of waiting. */
    margin-right: 4px;
    /* Fades in rather than appearing. A rebuild that finishes quickly should
       not leave a flicker behind in the corner of the reader's eye. */
    animation: fade-in 160ms ease both;
  }

  .spinner {
    color: var(--status-modified);
  }

  /* An arc rather than a ring of dots: one path, so it spins as a single
     transform and costs nothing while a rebuild holds the host busy. */
  .spin-arc {
    transform-origin: 8px 8px;
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* A reader who has asked the system to stop animating things is not asking
     for a worse answer, only a still one. The label still says what happens. */
  @media (prefers-reduced-motion: reduce) {
    .refreshing,
    .spin-arc {
      animation: none;
    }
  }
</style>
