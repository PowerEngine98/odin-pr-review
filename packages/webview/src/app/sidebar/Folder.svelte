<!--
  A directory in the change, and everything under it.

  Folders start open: the point of the grouping is to show the shape of the
  project, which a closed tree hides.

  A folder carries a reviewed box, and it is quiet until the row is pointed at.
  The worry that kept one off for a long time was the partial state — some files
  under it read and some not — and the box answers that by not trying to say it:
  it is set when everything under the folder is read and clear otherwise, and
  what it does is set every file under it to the other of that. A box that meant
  three things would be a box nobody could read at a glance, and the fraction in
  the band above already says how much is left. Hidden until hover because a
  column of boxes down the directory names would compete with the file rows'
  own, which are the ones a reader is aiming at; a folder that is finished keeps
  its tick showing, because that is a fact about the change rather than a
  control being offered.

  The root has no label and draws no row: it is where the tree starts, not a
  directory anybody named.
-->
<script lang="ts">
  import Chevron from "./Chevron.svelte";
  import { folderSurvives } from "./filter.js";
  import File from "./File.svelte";
  import type { FolderView } from "./model.js";
  import Self from "./Folder.svelte";
  import { trailTo } from "./shut.js";
  import { folderOpen, markAll, toggleFolder, ui } from "./state.svelte.js";
  import { reviewableIn } from "./tree.js";
  import Viewed from "../shared/Viewed.svelte";

  let {
    folder,
    depth,
    /**
     * The path from the root to this folder's parent.
     *
     * A folder is remembered by where it is rather than by what it is called: a
     * change with `src/hooks` and `test/hooks` in it has two folders called
     * `hooks`, and shutting one would shut both.
     */
    trail = "",
  }: { folder: FolderView; depth: number; trail?: string } = $props();

  const path = $derived(trailTo(trail, folder.label));

  /*
   * Read from the sidebar's own memory rather than held here.
   *
   * The tree is rebuilt from scratch on every refresh — the host renders a new
   * document and assigns it — so a state that lived in this component was
   * thrown away each time and the whole tree sprang back open.
   */
  const open = $derived(folderOpen(path));

  const root = $derived(folder.label === "");
  const survives = $derived(folderSurvives(folder, ui.needle));

  /*
   * Everything under here that can be marked off, however deep.
   *
   * The whole subtree rather than this folder's own files: what the box offers
   * is the directory, and a reader who ticks `backend` and finds its eleven
   * nested packages untouched has been given a control that did a tenth of what
   * it said.
   */
  const under = $derived(reviewableIn(folder));
  const allSeen = $derived(under.length > 0 && under.every((file) => file.viewed));

  /**
   * The press, which is the fold unless it landed on the box.
   *
   * Read off the target for the same reason the file rows do it: the box sits
   * inside a row that already answers a click, and setting it is not a request
   * to fold anything. The box stops the press on the input itself, but the
   * label it is drawn as is a few pixels wider than that.
   */
  function press(event: MouseEvent | KeyboardEvent): void {
    if ((event.target as Element | null)?.closest(".viewed")) return;
    toggleFolder(path);
  }
</script>

{#snippet body()}
  {#each folder.folders as child (child.label)}
    <Self folder={child} depth={depth + 1} trail={path} />
  {/each}
  {#each folder.files as file (file.path)}
    <File {file} {depth} />
  {/each}
{/snippet}

{#if root}
  {@render body()}
{:else}
  <div
    class="folder"
    hidden={!survives}
    style:padding-left="{8 + depth * 10}px"
    role="button"
    tabindex="0"
    onclick={press}
    onkeydown={(event) => {
      // Space is how a checkbox is set, and the box is inside this row: without
      // the same guard the press carries, one press would set the box and fold
      // the folder out from under it.
      if (event.key === "Enter" || event.key === " ") press(event);
    }}
  >
    <Chevron {open} />
    <span class="dir">{folder.label}</span>
    {#if under.length > 0}
      <Viewed
        checked={allSeen}
        title={allSeen
          ? `Unmark the ${under.length} files under ${folder.label}`
          : `Mark all ${under.length} files under ${folder.label} as reviewed`}
        onchange={(on) => markAll(under.map((file) => file.path), on)}
      />
    {/if}
  </div>
  <div class="folder-body" hidden={!open || !survives}>
    {@render body()}
  </div>
{/if}

<style>
  .folder {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-top: 3px;
    padding-bottom: 2px;
    padding-right: 20px;
    cursor: pointer;
    white-space: nowrap;
    color: var(--muted);
    font-size: 0.92em;
    /* Out of sight until the row is pointed at. The box reads this across the
       component boundary, where a class could not reach it — and it is zero
       rather than the file rows' 0.55 because a directory is not a thing to
       mark off in passing, so the control is offered only to a reader who has
       come to the row. A folder whose files are all read ignores this: the
       control sets its own opacity back to one when it is set. */
    --viewed-quiet: 0;
  }
  .folder:hover {
    background: var(--vscode-list-hoverBackground);
    --viewed-quiet: 1;
  }
  .folder .dir { overflow: hidden; text-overflow: ellipsis; }

  /* At the end of the row, in the same column the file rows keep their boxes
     in, so a press travels straight down the list rather than hunting left and
     right for each one.

     The margin is that column. A file row ends with the dot that says the file
     moved since the last reading, and the box sits before it; a folder row has
     no such news to carry, so it holds the space the dot would have taken
     rather than letting its box sit thirteen pixels further out than every box
     beneath it. The two numbers are named once, on the list itself. */
  .folder :global(.viewed) {
    margin-left: auto;
    margin-right: calc(var(--news-dot, 7px) + var(--news-gap, 6px));
  }
</style>
