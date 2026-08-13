<!--
  A label with the part that matched picked out.

  The editor's own colour for a search hit in a list, so a match here looks
  like a match anywhere else in the window.
-->
<script lang="ts">
  import { pieces } from "./filter.js";

  let { text, needle = "" }: { text: string; needle?: string } = $props();
</script>
<!-- prettier-ignore -->
{#each pieces(text, needle) as piece}{#if piece.hit}<span class="hit">{piece.text}</span>{:else}{piece.text}{/if}{/each}

<style>
  .hit {
    color: var(--vscode-list-highlightForeground, #2aaaff);
    font-weight: 600;
  }
</style>
