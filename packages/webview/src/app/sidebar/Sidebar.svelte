<!--
  The sidebar: a change to read, or a change to choose.

  Never both. The chooser is a step before the reading, and the view steps back
  to it from its own title bar — which does not throw the change list away, so
  going to see what else is open costs nothing but the press back.
-->
<script lang="ts">
  import { untrack } from "svelte";

  import Changes from "./Changes.svelte";
  import type { SidebarModel } from "./model.js";
  import Picker from "./Picker.svelte";
  import { model as page, ui } from "./state.svelte.js";

  let {
    model,
    ssr = false,
  }: {
    /**
     * Everything the sidebar is drawn from.
     *
     * Absent in a browser, where the state module has already found it on
     * `window` and every component is watching that object. Handed in on the
     * server, where there is no window to have found it on.
     */
    model?: SidebarModel;
    /**
     * There is no browser here.
     *
     * Nothing rendered under this may touch a document, a window or session
     * storage: the markup is being produced as text by something that has none
     * of them. What a reader has hidden or typed is restored after the page
     * wakes up, which is why the panels read their memory from an effect.
     */
    ssr?: boolean;
  } = $props();

  // Read once and deliberately not tracked. There is nothing here to react to —
  // this rendering happens once and is handed back as text — and a tracked read
  // would make the assignment look like something that could run again.
  untrack(() => {
    if (ssr && model) {
      page.current = model;
      ui.loading = model.loading;
    }
  });

  const current = $derived(page.current);
</script>

<!--
  Something is running. Indeterminate, because asking the forge how far along it
  is costs another round trip — the same reason the editor's own notifications
  draw it this way.
-->
{#if ui.loading}
  <div class="loading"><span></span></div>
{/if}

{#if current.change}
  <Changes change={current.change} />
{:else}
  <Picker picker={current.picker} />
{/if}

<style>
  .loading {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    height: 2px;
    overflow: hidden;
    background: transparent;
  }
  .loading span {
    display: block;
    width: 40%;
    height: 100%;
    background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground));
    animation: odin-progress 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes odin-progress {
    from { transform: translateX(-100%); }
    to { transform: translateX(350%); }
  }
</style>
