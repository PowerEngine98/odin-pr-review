<!--
  What the sidebar shows before there is a change to look at: the open pull
  requests.

  Choosing what to review is the step before reviewing it, and doing that in a
  browser and then finding the branch by hand is the part of the loop that has
  nothing to do with reading code.

  The frame is the same whether there are twenty pull requests, one, or none, so
  the action sits in the same place every time — a button that moves when the
  list changes length is a button that has to be found again. The question stays
  on screen when the answer is empty, which is exactly when it needs changing:
  "nothing is open" is the moment a reader wants to ask for what was merged.
-->
<script lang="ts">
  import Asked from "./Asked.svelte";
  import type { PickerView, PullView } from "./model.js";
  import Pull from "./Pull.svelte";
  import { notify, remember, remembered } from "./state.svelte.js";

  let { picker }: { picker: PickerView } = $props();

  /** What the box is searching the answer for, as opposed to asking about it. */
  let needle = $state("");

  const PANEL = "odin.asked-open";
  let asking = $state(false);

  // Re-opened after a redraw, since changing the question rebuilds the document
  // and a panel that shut on every press would be unusable. Done in an effect
  // rather than read straight into the initial value: on the host's side of the
  // render there is no session storage, and the markup the script adopts has to
  // be the markup that was sent.
  $effect(() => {
    asking = remembered(PANEL) === "1";
  });

  function toggle(): void {
    asking = !asking;
    remember(PANEL, asking ? "1" : "0");
  }

  /** A row matches on its number, its title, its branch and its author. */
  const matches = (pull: PullView): boolean =>
    needle === "" ||
    `${pull.pr.number} ${pull.pr.title} ${pull.pr.branch} ${pull.pr.author}`
      .toLowerCase()
      .includes(needle);

  const mine = $derived(picker.mine.filter(matches));
  const rest = $derived(picker.everythingElse.filter(matches));
  const anything = $derived(picker.mine.length + picker.everythingElse.length > 0);
</script>

<div class="picker">
  <!-- The search box and the question behind it, on one line. -->
  <div class="find">
    <input
      class="filter"
      type="search"
      autocomplete="off"
      placeholder="Filter pull requests"
      oninput={(event) => (needle = event.currentTarget.value.trim().toLowerCase())}
    />
    <button
      class="funnel"
      class:on={asking}
      title="What the list asks the forge for"
      aria-label="Filters"
      onclick={toggle}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M1.5 2.5h13a.5.5 0 0 1 .38.83L10 9v4.2a.5.5 0 0 1-.72.45l-2.5-1.25A.5.5 0 0 1 6.5 12V9L1.12 3.33a.5.5 0 0 1 .38-.83Z"
        />
      </svg>
    </button>
  </div>

  <Asked asked={picker.asked} viewer={picker.viewer} open={asking} />

  {#if !anything}
    {#if !picker.reached}
      <!-- The question was never answered, which is not an answer of none. -->
      <p class="empty">The forge did not answer.</p>
      <p class="empty small">
        Odin asks the <code>gh</code> command line, so this needs it installed and
        signed in — and a slow or unreachable forge looks the same from here. You can
        review the current branch regardless.
      </p>
    {:else}
      <p class="empty">
        No {picker.asked.state === "all" ? "" : `${picker.asked.state} `}pull requests{picker
          .asked.author
          ? ` by ${picker.asked.author}`
          : ""} found.
      </p>
      <p class="empty small">
        Odin asks the <code>gh</code> command line, so this needs it installed and
        signed in. You can review the current branch regardless.
      </p>
    {/if}
  {:else if picker.mine.length > 0}
    <!-- The queue, and then everything else. What the forge is waiting on this
         reader for comes first and under its own heading; everything else is
         context. A heading over nothing is a heading that has to be read and
         discounted, so a section the box has emptied goes with it. -->
    {#if mine.length > 0}
      <div class="section">
        <div class="section-head">Waiting on you<span class="count">{mine.length}</span></div>
        <div class="pulls">
          {#each mine as pull (pull.pr.number)}<Pull {pull} />{/each}
        </div>
      </div>
    {/if}
    {#if rest.length > 0}
      <div class="section">
        <div class="section-head">Everything else</div>
        <div class="pulls">
          {#each rest as pull (pull.pr.number)}<Pull {pull} />{/each}
        </div>
      </div>
    {/if}
  {:else}
    <div class="pulls">
      {#each rest as pull (pull.pr.number)}<Pull {pull} />{/each}
    </div>
  {/if}

  <div class="footer">
    <button class="review" onclick={() => notify("review")}>Review This Branch</button>
  </div>
</div>

<style>
  /* The list scrolls; the action does not. A primary button that walks off the
     bottom of a long list is a button nobody finds. */
  .picker {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px 8px 0;
  }
  .pulls {
    flex: 1 1 auto;
    overflow-y: auto;
    margin: 0 -8px;
    padding: 0 8px;
  }
  /* With nothing to list there is no scroller to take up the slack, so the last
     line of the explanation does it and the button stays where it always is. */
  .empty { flex: 0 0 auto; }
  .empty:last-of-type { margin-bottom: auto; }
  .footer {
    flex: 0 0 auto;
    padding: 8px 0;
    border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }

  .empty { color: var(--muted); padding: 8px 12px; }
  .empty.small { font-size: 0.9em; line-height: 1.5; }
  .empty code { font-family: var(--vscode-editor-font-family); }

  .find { display: flex; align-items: center; gap: 6px; }
  .filter {
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 4px 8px;
    margin-bottom: 8px;
  }
  .filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

  .funnel {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
    /* No line box, so the funnel sits in the middle of its button rather than
       on a baseline inside it. */
    line-height: 0;
    font-size: 0;
  }
  .funnel svg { display: block; }
  .funnel:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-list-hoverBackground);
  }
  .funnel.on { color: var(--status-modified); border-color: var(--status-modified); }

  /* Quiet enough not to compete with the rows under it, present enough to say
     the list is in two parts. */
  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 4px;
    font-size: 0.9em;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .section-head .count {
    padding: 0 5px;
    border-radius: 999px;
    font-size: 0.95em;
    color: var(--vscode-editor-background);
    background: var(--status-modified);
  }

  .review {
    margin: 0;
    font: inherit;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none;
    border-radius: 3px;
    padding: 4px 10px;
    cursor: pointer;
  }
</style>
