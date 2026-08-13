<!--
  How much of what is on screen has been read.

  Along the bottom edge of the chrome, where a sticky card title comes to rest,
  and full width because it is about the whole view rather than any one card.
  It answers the tabs' question without a number: the part being read, as far
  as it has got.
-->
<script lang="ts">
  import { model, ui } from "../state.svelte.js";

  /**
   * The fraction read of whatever part is open, or of the change when none is.
   *
   * Untouched files carry no box, so counting them would leave the bar short of
   * full however much was read — the same rule the tallies use, because two
   * answers to one question is worse than either.
   */
  const filled = $derived.by(() => {
    const part = ui.part
      ? (model.current.parts ?? []).find((p) => p.id === ui.part)
      : undefined;
    const ids = part ? new Set(part.nodes) : null;

    let done = 0;
    let total = 0;
    for (const node of model.current.nodes) {
      if (node.untouched) continue;
      if (ids && !ids.has(node.id)) continue;
      total += 1;
      if (ui.viewed.has(node.path)) done += 1;
    }
    return total ? (done / total) * 100 : 0;
  });
</script>

<div class="done-bar"><span style="width:{filled}%"></span></div>

<style>
  /* The empty part of the bar is the strip it runs along, so only the filled
     part is a mark on the page. */
  .done-bar {
    height: 2px;
    background: var(--strip);
  }
  .done-bar span {
    display: block;
    height: 100%;
    width: 0;
    background: var(--status-renamed);
    /* Ticking a file moves it rather than jumping it: the bar is the one thing
       here that reports progress, and progress that arrives instantly is not
       seen at all. */
    transition: width 200ms ease;
  }
</style>
