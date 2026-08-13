<!--
  Somewhere this file points.

  Under the file it leaves rather than at a fixed indent: a fixed one puts a
  deeply nested file's references out at the margin, where they read as
  siblings of the folders rather than as its contents.
-->
<script lang="ts">
  import Hit from "./Hit.svelte";
  import type { RefView } from "./model.js";
  import { notify, ui } from "./state.svelte.js";

  let { ref, depth }: { ref: RefView; depth: number } = $props();

  /* Where the file's own row starts, plus the width of its fold and badge. */
  const indent = $derived(8 + (depth + 1) * 10 + 22);
</script>

<div
  class="ref {ref.change}"
  style:padding-left="{indent}px"
  title={ref.label}
  role="button"
  tabindex="0"
  onclick={() => notify("follow", { edgeId: ref.id })}
  onkeydown={(event) => {
    if (event.key === "Enter" || event.key === " ") notify("follow", { edgeId: ref.id });
  }}
>
  <span class="arrow">→</span>
  <span class="symbol"><Hit text={ref.symbol} needle={ui.needle} /></span>
  <span class="where"><Hit text={ref.where} needle={ui.needle} /></span>
</div>

<style>
  .ref {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 1px;
    padding-bottom: 1px;
    padding-right: 20px;
    cursor: pointer;
    white-space: nowrap;
    font-size: 0.95em;
  }
  .ref:hover { background: var(--vscode-list-hoverBackground); }
  .ref .arrow { flex: 0 0 auto; }
  .ref.added .arrow { color: var(--added); }
  .ref.removed .arrow { color: var(--removed); }
  .ref.unchanged .arrow { color: var(--muted); }
  .ref .symbol { overflow: hidden; text-overflow: ellipsis; }
  .ref .where { color: var(--muted); font-size: 0.9em; }
</style>
