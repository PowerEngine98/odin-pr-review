<!--
  The pending review: what has been written, and the verdict to send it with.

  Comments accumulate here rather than being posted one at a time, which is both
  what the forge's own model expects and what spares a team a notification per
  remark. Nothing leaves the machine until one of the three buttons is pressed,
  and the host confirms even then.

  It sits at a corner rather than following the cursor: it is a summary of
  everything pending, not a remark about one line.
-->
<script lang="ts">
  import type { CommentView } from "../model.js";
  import { model, notify } from "../state.svelte.js";
  import type { Draft } from "./drafts.js";
  import {
    SUMMARY_KEY,
    clearAll,
    fileDrafts,
    load,
    remember,
    whereOf,
  } from "./drafts.js";
  import Editor from "./Editor.svelte";

  let {
    open = $bindable(false),
    drafts = $bindable([]),
  }: { open?: boolean; drafts?: Draft[] } = $props();

  let summary = $state("");

  /**
   * The summary outlives the panel being closed.
   *
   * Closing is a view being put away, not a review being abandoned — so the
   * words are read back from where they were filed rather than from whether the
   * box happens to be on screen.
   */
  $effect(() => {
    summary = load(model.current.review).unsent[SUMMARY_KEY] ?? "";
  });

  $effect(() => {
    const held = summary;
    remember(model.current.review, SUMMARY_KEY, held);
  });

  const count = $derived(
    drafts.length + (drafts.length === 1 ? " comment" : " comments"),
  );

  function drop(at: number): void {
    drafts = fileDrafts(
      model.current.review,
      drafts.filter((_, index) => index !== at),
    );
  }

  /**
   * A verdict, and the one irreversible thing this page can do.
   *
   * Approving is the only one the forge will take without words, so the other
   * two send the reader back to the box rather than failing at the forge — a
   * round trip to be told to write a sentence is a round trip nobody needed.
   */
  /**
   * Whether a verdict can be sent as things stand.
   *
   * The forge takes an approval without words and refuses the other two
   * without them. That was already known here, and the button said nothing
   * about it: pressing Comment with an empty box put the cursor back in the
   * box and otherwise did nothing at all, which reads as a broken button
   * rather than as a rule. It says so itself now.
   */
  const wordsFor = (event: string) => event === "APPROVE" || summary.trim().length > 0;

  function submit(event: string): void {
    const body = summary.trim();
    if (!wordsFor(event)) {
      nudges++;
      return;
    }
    // The host confirms before anything is sent; nothing leaves here on the
    // strength of a single click.
    notify("submitReview", { event, body, comments: drafts });
  }

  /**
   * How many times a verdict has been asked for without the words it needs.
   *
   * Counted rather than flagged: the box is put back under the cursor by being
   * built again, and a flag that was already true the second time would leave a
   * reviewer pressing Comment at a panel that appears to ignore them.
   */
  let nudges = $state(0);

  /**
   * The forge has taken the review.
   *
   * Sent is the one thing that is not a draft any more, so everything held for
   * this review goes at once — the remarks, the summary and the panel showing
   * them. The comments that come back with it are the same remarks as the forge
   * now has them, which is what the marks on the canvas are drawn from.
   */
  $effect(() => {
    const done = (message: MessageEvent) => {
      if (!message.data || message.data.type !== "reviewSubmitted") return;
      clearAll(model.current.review);
      drafts = [];
      summary = "";
      open = false;
      if (message.data.comments) {
        model.current.comments = message.data.comments as CommentView[];
      }
    };
    window.addEventListener("message", done);
    return () => window.removeEventListener("message", done);
  });
</script>

{#if open}
  <!-- A click in the panel is not a click on the canvas behind it, which would
       clear whatever the reader has picked. Nothing is being performed here, so
       there is no keyboard equivalent to give it. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="review" onclick={(event) => event.stopPropagation()} role="dialog" aria-label="Pending review" tabindex="-1">
    <div class="review-head">
      <span>Pending review · <span class="review-count">{count}</span></span>
      <!-- A way out that is not the button that opened it. Closing keeps every
           draft: this panel is a view of what is pending, not the pending
           itself. -->
      <button class="review-close" title="Close" aria-label="Close" onclick={() => (open = false)}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="review-list">
      {#each drafts as draft, at}
        <div class="review-item">
          <span class="where">{draft.path.split("/").pop()}:{whereOf(draft)}</span>
          <span class="what">{draft.body.slice(0, 90)}</span>
          <button class="drop" onclick={() => drop(at)}>remove</button>
        </div>
      {/each}
    </div>

    {#key nudges}
      <Editor
        bind:value={summary}
        placeholder="Summary (required to comment or request changes)"
        rows={3}
        autofocus={nudges > 0}
      />
    {/key}

    <div class="review-actions">
      <button class="review-submit approve" onclick={() => submit("APPROVE")}>Approve</button>
      <button
        class="review-submit"
        disabled={!wordsFor("COMMENT")}
        title={wordsFor("COMMENT") ? undefined : "Write a summary to comment"}
        onclick={() => submit("COMMENT")}>Comment</button>
      <button
        class="review-submit changes"
        disabled={!wordsFor("REQUEST_CHANGES")}
        title={wordsFor("REQUEST_CHANGES") ? undefined : "Write a summary to request changes"}
        onclick={() => submit("REQUEST_CHANGES")}>Request changes</button>
    </div>
  </div>
{/if}

<style>
  .review {
    position: fixed;
    right: 16px;
    top: 96px;
    z-index: 40;
    width: 430px;
    padding: 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    border: 1px solid var(--panel-edge);
    font-size: 12px;
  }

  .review-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--muted);
    margin-bottom: 6px;
  }

  .review-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: -4px -4px -4px 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .review-close:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .review-list {
    max-height: 190px;
    overflow-y: auto;
    margin-bottom: 8px;
  }

  .review-item {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 3px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
  }

  .review-item .where {
    color: var(--muted);
    flex: 0 0 auto;
  }

  .review-item .what {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .review-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .review button {
    font: inherit;
    color: var(--muted);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    border-radius: 5px;
    padding: 3px 10px;
    cursor: pointer;
  }

  .review button:hover {
    color: var(--text);
  }

  .review-item .drop {
    padding: 0 6px;
    font-size: 11px;
  }

  /* Sending a review is the one irreversible thing this page can do, so the
     three are told apart by more than their words: the agreement is the filled
     one, and asking for changes carries the colour a removed line has. */
  .review-submit.approve {
    color: var(--action-ink);
    background: var(--action);
    border-color: color-mix(in srgb, #000 22%, var(--action));
    font-weight: 600;
  }

  .review-submit.approve:hover {
    color: var(--action-ink);
    filter: brightness(1.08);
  }

  .review-submit.changes {
    color: var(--removed);
    border-color: var(--removed);
  }
</style>
