<!--
  The band at the top of the list: how far through the change you are, how big
  it is, and who wrote it.

  Sticky, because progress is the one thing worth seeing while scrolling a long
  change, and a bar that scrolls away stops answering the question it was put
  there for.

  Nothing read yet is not progress, and "0/43 0%" is three ways of saying the
  review has not started — printed where the amount left to do goes. So the bar
  and the fraction are simply absent until there is one.
-->
<script lang="ts">
  import type { ChangeView } from "./model.js";
  import { foldAll, ui } from "./state.svelte.js";
  import { progressOf } from "./tree.js";

  let { change }: { change: ChangeView } = $props();

  /*
   * Counted from the marks themselves.
   *
   * The old renderer was sent a fraction and then kept it in step by hand,
   * re-reading every checkbox in the document after each press and after each
   * message from the host. Two facts, one of which could be stale — and it
   * was, whenever a file was marked from the canvas instead of from here.
   */
  const done = $derived(progressOf(change.tree));
</script>

<div class="head">
  {#if done.done > 0}
    <div class="bar"><div class="fill" style:width="{done.percent}%"></div></div>
  {/if}
  <div class="stats">
    {#if done.done > 0}
      <span class="progress">
        <b class="done">{done.done}</b>/<span class="total">{done.total}</span
        ><span class="pct">{done.percent}%</span>
      </span>
    {/if}
    <span class="spacer"></span>
    {#if change.totals.additions > 0}
      <span class="added">+{change.totals.additions}</span>
    {/if}
    {#if change.totals.deletions > 0}
      <span class="removed">−{change.totals.deletions}</span>
    {/if}
    {#if change.totals.authors}
      <span class="authors" title={change.totals.authorsFull}>
        {change.totals.authors}
      </span>
    {/if}
  </div>
  <input
    class="filter"
    type="search"
    autocomplete="off"
    placeholder="Filter files and references"
    oninput={(event) => (ui.needle = event.currentTarget.value.trim().toLowerCase())}
  />
  <!--
    The two ways to take the whole tree at once.

    Here rather than on the tree itself, because they are about every folder and
    there is no folder they belong to. Words rather than the editor's chevron
    icons: a webview has no icon font to borrow, and two unlabelled glyphs in a
    strip that already has a chevron on every row would read as a third kind of
    fold rather than as a control over all of them.

    Expanding also turns test files back on in the drawing — see `foldAll`.
  -->
  <div class="all">
    <button
      type="button"
      title="Open every folder, and show test files in the drawing"
      onclick={() => foldAll(true)}
    >Expand all</button>
    <button
      type="button"
      title="Shut every folder, leaving the file you are standing on showing"
      onclick={() => foldAll(false)}
    >Collapse all</button>
  </div>
</div>

<style>
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    /* The same clearance the rows keep on the right, so the band and the list
       under it end at the same place rather than a scrollbar's width apart. */
    padding: 6px 20px 6px 8px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--vscode-progressBar-background, #0a84ff);
    transition: width 160ms ease;
  }
  .stats {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 5px;
    font-size: 0.9em;
    color: var(--muted);
    white-space: nowrap;
  }
  .spacer { flex: 1; }
  .progress { color: var(--muted); }
  .progress .done {
    color: var(--vscode-progressBar-background, #0a84ff);
    font-weight: 600;
  }
  .pct { margin-left: 4px; }
  .added { color: var(--added); }
  .removed { color: var(--removed); }
  .authors {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40%;
  }

  .filter {
    width: 100%;
    margin-top: 6px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 4px 8px;
  }
  .filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

  .all {
    display: flex;
    gap: 10px;
    margin-top: 5px;
  }

  /* Drawn as text rather than as buttons. They are a pair of standing commands
     over the list, and two filled buttons under the search box would be the
     loudest thing in a strip whose point is the file names — the same argument
     the reviewed box is drawn by. The editor's link colour because that is what
     every theme that ships has an opinion about. */
  .all button {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.85em;
    color: var(--vscode-textLink-foreground, #0a84ff);
    cursor: pointer;
    opacity: 0.8;
  }
  .all button:hover { opacity: 1; text-decoration: underline; }
  .all button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
</style>
