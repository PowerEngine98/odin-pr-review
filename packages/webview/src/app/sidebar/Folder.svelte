<!--
  A directory in the change, and everything under it.

  Folders start open: the point of the grouping is to show the shape of the
  project, which a closed tree hides. They carry no reviewed box of their own —
  one would have to show a partial state whenever some of its files were read
  and some were not, and a checkbox that means "some" is harder to read at a
  glance than the files themselves.

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
  import { folderOpen, toggleFolder, ui } from "./state.svelte.js";

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
    onclick={() => toggleFolder(path)}
    onkeydown={(event) => {
      if (event.key === "Enter" || event.key === " ") toggleFolder(path);
    }}
  >
    <Chevron {open} />
    <span class="dir">{folder.label}</span>
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
  }
  .folder:hover { background: var(--vscode-list-hoverBackground); }
  .folder .dir { overflow: hidden; text-overflow: ellipsis; }
</style>
