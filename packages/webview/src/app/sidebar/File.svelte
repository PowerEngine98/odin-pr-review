<!--
  One file in the change.

  Pressing it brings the file's card to the middle of the canvas; pressing the
  fold opens what it points at. Opening an editor on it is the card's own
  button — choosing a file to look at and opening it are different intentions,
  and doing both on one press means one of them was never asked for.
-->
<script lang="ts">
  import StatusBadge from "../shared/StatusBadge.svelte";
  import Viewed from "../shared/Viewed.svelte";
  import Chevron from "./Chevron.svelte";
  import { fileMatches, refMatches } from "./filter.js";
  import Hit from "./Hit.svelte";
  import type { FileView } from "./model.js";
  import Ref from "./Ref.svelte";
  import { mark, notify, ui } from "./state.svelte.js";

  let { file, depth }: { file: FileView; depth: number } = $props();

  /** What the reader last did to the fold, when nothing is being searched. */
  let unfolded = $state(false);

  const searching = $derived(ui.needle !== "");
  /** Whether the file's own name is what matched. */
  const itself = $derived(fileMatches(file, ui.needle));
  const refs = $derived(
    file.refs.filter((ref) => itself || refMatches(ref, ui.needle)),
  );

  /*
   * Open while searching when the match is inside rather than on the row.
   *
   * The old renderer had to reach for the element and toggle a class, and then
   * remember to put it back when the box was cleared. Here it is one reading of
   * two facts, so there is nothing to put back: the reader's own fold is what
   * the row returns to the moment the box is empty.
   */
  const open = $derived(searching ? !itself && refs.length > 0 : unfolded);

  /** The row survives if it matched, or if something it points at did. */
  const survives = $derived(itself || refs.length > 0);

  /* A file the diff never touched has nothing to review, so it gets no box. */
  const reviewable = $derived(file.status !== "phantom");

  const indent = $derived(8 + (depth + 1) * 10);

  /*
   * The fold folds; anywhere else brings the file's card to the middle of the
   * canvas.
   *
   * Read off the press rather than answered by a handler on the fold itself,
   * because a button inside a row that is already pressable is two controls
   * occupying the same pixels — and the fold is a hint about this row, not a
   * thing of its own to reach with the keyboard.
   */
  function press(event: MouseEvent): void {
    if ((event.target as Element | null)?.closest(".fold")) {
      unfolded = !unfolded;
      return;
    }
    notify("focus", { path: file.path });
  }
</script>

<div
  class="row status-{file.status}"
  class:seen-marked={file.viewed}
  hidden={!survives}
  style:padding-left="{indent}px"
  title={file.path}
  role="button"
  tabindex="0"
  onclick={press}
  onkeydown={(event) => {
    if (event.key === "Enter") notify("focus", { path: file.path });
  }}
>
  <span class="fold">
    <Chevron {open} blank={file.refs.length === 0} />
  </span>
  <StatusBadge status={file.status} />
  <span class="name"><Hit text={file.name} needle={ui.needle} /></span>
  <span class="counts">
    {#if file.status === "phantom"}
      <span class="untouched">untouched</span>
    {:else}
      {#if file.additions}<span class="added">{file.additions}</span>{/if}
      {#if file.deletions}<span class="removed">{file.deletions}</span>{/if}
    {/if}
  </span>
  {#if file.note}
    <span
      class="note"
      title="Odin has no {file.language} resolver, so this file has no references"
    >{file.note}</span>
  {/if}
  {#if reviewable}
    <Viewed checked={file.viewed} onchange={(on) => mark(file.path, on)} />
  {/if}
</div>

{#if open && refs.length > 0}
  <div class="refs">
    {#each refs as ref (ref.id)}
      <Ref {ref} {depth} />
    {/each}
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 2px;
    padding-bottom: 2px;
    /* Generous on purpose: the reviewed box sits at the end of the row, and the
       editor draws its scrollbar over the last few pixels of the view. Without
       the clearance the box ends up under it. */
    padding-right: 20px;
    cursor: pointer;
    white-space: nowrap;
    /* How loud the reviewed box is while the row is not being pointed at. The
       box reads it across the component boundary, which a class could not
       do. */
    --viewed-quiet: 0.55;
  }
  .row:hover {
    background: var(--vscode-list-hoverBackground);
    --viewed-quiet: 1;
  }

  /* The badge takes `currentColor`, so the row says what colour this file is
     and the square, its border and its wash all follow. */
  .row.status-added    { color: var(--status-added); }
  .row.status-modified { color: var(--status-modified); }
  .row.status-deleted  { color: var(--status-deleted); }
  .row.status-renamed  { color: var(--status-renamed); }
  .row.status-phantom  { color: var(--status-phantom); }

  /* Only the badge is in the status's colour. The name is the thing being
     read, and a list of forty file names in five colours is unreadable. */
  .name {
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
  }
  .row.status-phantom .name { color: var(--muted); }

  .row.seen-marked .name,
  .row.seen-marked .counts { opacity: 0.45; }
  .row.seen-marked .name { text-decoration: line-through; }

  /* The counts line up down the right rather than trailing each filename.
     Ragged against names of every length they were a column that could not be
     read as one; against the edge they can be compared without reading a
     single name. */
  .counts {
    margin-left: auto;
    flex: 0 0 auto;
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
  }
  .counts .added { color: var(--added); }
  .counts .removed { color: var(--removed); }
  .counts .untouched { color: var(--muted); }

  .note {
    flex: 0 0 auto;
    color: var(--warning);
    font-size: 0.85em;
    border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    border-radius: 4px;
    padding: 0 5px;
  }

  .fold { display: inline-flex; flex: 0 0 auto; }

  /* Held off the counts, which are the thing it must not be mistaken for. */
  .row :global(.viewed) { margin-left: 10px; }
</style>
