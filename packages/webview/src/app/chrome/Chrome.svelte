<!--
  The fixed block across the top of the page.

  One block rather than three, so the bar, the part strip and the progress line
  cannot drift apart and the canvas has a single height to make room for. It is
  also a stacking context, which is why the z-index lives here: the menus inside
  the bar open downward across the reviewers, and an index set on a menu could
  never beat one set outside the bar.
-->
<script lang="ts">
  import DoneBar from "./DoneBar.svelte";
  import PrBar from "./PrBar.svelte";
  import Tabs from "./Tabs.svelte";

  /**
   * What the forge knows about the change.
   *
   * Not in the view model: the host embeds a graph, a layout and a set of
   * comments, and none of them carries the pull request's number or the pair of
   * refs. Passed in until the contract has a field for it — the header is the
   * first thing a reviewer reads, and reading it out of a second source is
   * better than not drawing it at all.
   */
  interface PrMeta {
    baseRef: string;
    headRef: string;
    /** Who wrote the commits in this range, most prolific first. */
    authors?: { name: string; commits: number }[];
    pullRequest?: {
      number: number;
      title: string;
      url: string;
      draft?: boolean;
      /** `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or absent. */
      reviewDecision?: string;
    };
  }

  let {
    meta,
    hasSchema = false,
    notes,
    pending = 0,
    onFit,
    onReview,
  }: {
    meta?: PrMeta;
    /**
     * Whether the drawing has a schema card on it. A switch for something the
     * change does not have teaches the reader nothing, so the database option
     * only appears when there is a database. The view model's nodes do not say
     * which of them stands for one, so the host has to.
     */
    hasSchema?: boolean;
    /** What the page could not do, said once and quietly under the settings. */
    notes?: { gaps?: string; unpainted?: string[] };
    /** Remarks written here and not yet sent, for the count on the button. */
    pending?: number;
    onFit?: () => void;
    onReview?: () => void;
  } = $props();
</script>

<div class="chrome">
  <PrBar {meta} {hasSchema} {notes} {pending} {onReview} />
  <Tabs {onFit} />
  <DoneBar />
</div>

<style>
  /* The same surface a card's title sits on, so a pinned header sliding up to
     the bar arrives at the colour it was already wearing rather than crossing
     an edge between two greys. Opaque, which also makes the blur that was
     standing in for solidity unnecessary. */
  .chrome {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 30;
    background: var(--card-bg);
  }
</style>
