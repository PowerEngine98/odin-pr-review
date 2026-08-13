<!--
  What the list is asking the forge for.

  Separate from the text box above it, which searches what has already arrived.
  This changes the question: a merged change is not in the answer to "what is
  open", however hard the box is searched.
-->
<script lang="ts">
  import { untrack } from "svelte";

  import type { Query } from "./model.js";
  import { ask, forget, remember, remembered } from "./state.svelte.js";

  let { asked, viewer, open }: { asked: Query; viewer: string; open: boolean } =
    $props();

  const STATES: { value: Query["state"]; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "merged", label: "Merged" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
  ];

  /**
   * What is in the box, which is not the same as what was last asked for.
   *
   * Seeded from the question and then owned by the reader — untracked on
   * purpose, because a box that reset itself whenever the answer came back
   * would take the caret with it. The seed skips the login the "Mine" chip
   * already stands for: a name shown in two places at once reads as two
   * filters.
   */
  let typed = $state(
    untrack(() => (asked.author && asked.author !== viewer ? asked.author : "")),
  );
  let box = $state<HTMLInputElement | null>(null);
  let pending: ReturnType<typeof setTimeout> | undefined;

  const TYPING = "odin.author-typing";

  /*
   * Asked for half a second after the typing stops.
   *
   * Every keystroke would be a call to the forge and a redrawn list under the
   * cursor — and a login is typed a letter at a time, so most of those calls
   * would be for a name nobody has. Enter still asks straight away, for anyone
   * who would rather say when they are done.
   */
  function settle(): void {
    clearTimeout(pending);
    pending = setTimeout(() => {
      // Asking rebuilds the document, and a rebuild rebuilds this box. It says
      // so before it goes and takes the caret back when it returns —
      // otherwise a second letter after the pause lands nowhere.
      remember(TYPING, "1");
      ask({ author: typed.trim() });
    }, 500);
  }

  function now(): void {
    clearTimeout(pending);
    ask({ author: typed.trim() });
  }

  $effect(() => {
    if (remembered(TYPING) !== "1") return;
    forget(TYPING);
    box?.focus();
    box?.setSelectionRange(typed.length, typed.length);
  });
</script>

<div class="asked" hidden={!open}>
  <div class="group">State</div>
  <div class="chips">
    {#each STATES as state (state.value)}
      <button
        class="chip"
        class:on={asked.state === state.value}
        data-state={state.value}
        onclick={() => ask({ state: state.value })}>{state.label}</button
      >
    {/each}
  </div>
  <div class="group">Author</div>
  <div class="chips">
    <button class="chip" class:on={asked.author === ""} onclick={() => ask({ author: "" })}
      >Anyone</button
    >
    {#if viewer}
      <button
        class="chip"
        class:on={asked.author === viewer}
        onclick={() => ask({ author: viewer })}>Mine</button
      >
    {/if}
  </div>
  <input
    class="filter"
    type="search"
    autocomplete="off"
    placeholder="Any other login"
    bind:this={box}
    bind:value={typed}
    oninput={settle}
    onkeydown={(event) => {
      if (event.key === "Enter") now();
    }}
  />
</div>

<style>
  .asked {
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Room under it, so the question and the first answer are not one block. */
    margin: 6px 0 12px;
    padding: 8px;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    border-radius: 6px;
  }
  .group {
    font-size: 0.9em;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 2px; }
  .chip {
    padding: 2px 8px;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
    border-radius: 999px;
    font: inherit;
    font-size: 0.9em;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }
  .chip:hover { color: var(--vscode-foreground); border-color: currentColor; }
  /* Chosen, in the state's own colour and outlined — the same pill the row
     wears when it is in that state, so the question and the answer are drawn
     alike. The colours are the forge's: green open, purple merged, red
     closed. */
  .chip.on {
    color: var(--vscode-foreground);
    border-color: currentColor;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .chip.on[data-state="open"]   { color: var(--status-added); }
  .chip.on[data-state="merged"] { color: var(--merged); }
  .chip.on[data-state="closed"] { color: var(--status-deleted); }

  .filter {
    width: 100%;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 4px 8px;
  }
  .filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
</style>
