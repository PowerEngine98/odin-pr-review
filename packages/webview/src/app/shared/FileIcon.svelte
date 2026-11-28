<script lang="ts">
  import type { FileIcons } from "../../file-icons.js";

  let { path, icons }: { path: string; icons: FileIcons | undefined } = $props();

  const src = $derived(icons?.icons[icons.of[path] ?? ""]);
</script>

{#if src}
  <img class="file-icon" {src} alt="" aria-hidden="true" draggable="false" />
{/if}

<style>
  .file-icon {
    flex: 0 0 auto;
    width: var(--file-icon, 16px);
    height: var(--file-icon, 16px);
    vertical-align: -3px;
  }
</style>
