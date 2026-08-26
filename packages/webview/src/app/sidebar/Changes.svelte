<!--
  The change as a list.

  A webview rather than the editor's own tree, and the reason is colour: a tree
  item's description is plain text, and a file decoration can only tint a whole
  row one colour. That is not enough here — the counts need the diff's green and
  red, and a file nothing could read needs a warning beside counts that are not
  warnings. What the native tree's affordances buy in exchange is that the
  sidebar and the canvas are drawn from the same palette, by the same
  components.
-->
<script lang="ts">
  import Folder from "./Folder.svelte";
  import Head from "./Head.svelte";
  import type { ChangeView } from "./model.js";
  import { notify } from "./state.svelte.js";

  let { change }: { change: ChangeView } = $props();

  /**
   * Whether there is a local copy worth offering to make.
   *
   * Only for a reading of the forge's commits: a reading of the files on disk
   * already follows the reader's typing, and offering to fetch it would be
   * offering to replace what they are looking at with itself.
   */
  const offerCheckout = $derived(!change.reading.local && !!change.reading.number);
</script>

<Head {change} />

<!--
  The list, and the only part of the strip that scrolls.

  The band above it and the button below it are both fixtures: one is how you
  narrow the list and the other is how you leave the reading, and neither is
  something to go looking for. A change of any size put the button a few hundred
  files below the fold, which is indistinguishable from its not being there.
-->
<div class="scroll">
  <Folder folder={change.tree} depth={0} />
</div>

{#if offerCheckout}
  <!--
    The way from reading to working.

    Opening a change no longer touches the checkout, which is what makes it
    possible to read one while another is in progress — but a reviewer who
    decides to go and change something still needs the branch. This is that
    step, said out loud and taken once, rather than something that happened to
    them for pressing a row in a list.
  -->
  <div class="go-local">
    <button
      class="go-local-do"
      title="Fetch this branch, check it out, and follow the files on disk"
      onclick={() => notify("checkoutLocal", { number: change.reading.number })}
    >
      Check out {change.reading.branch}
    </button>
    <span class="go-local-why">
      Reading the forge's copy. This checkout is untouched.
    </span>
  </div>
{/if}

<style>
  /* Takes what is left after the band and the button, and no more: `min-height`
     because a flex item will otherwise grow to fit every row rather than
     scroll, which puts the button back below the fold. */
  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .go-local {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 10px;
    /* On top of the list rather than after it, so the rows that scroll under it
       are covered rather than showing through. */
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-top: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
  }

  .go-local-do {
    padding: 5px 9px;
    border: 0;
    border-radius: 3px;
    background: var(--vscode-button-background, #0a84ff);
    color: var(--vscode-button-foreground, #fff);
    font: inherit;
    cursor: pointer;
    /* A branch name is long and this column is narrow: it wraps rather than
       running off the side, because which branch is the whole of the question. */
    text-align: left;
    overflow-wrap: anywhere;
  }

  .go-local-do:hover {
    background: var(--vscode-button-hoverBackground, #1a90ff);
  }

  .go-local-why {
    color: var(--vscode-descriptionForeground, #8b949e);
    font-size: 11px;
  }
</style>
