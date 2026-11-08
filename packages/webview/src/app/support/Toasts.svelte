<script lang="ts">
  import { dismiss, openLink, toasts } from "./support.svelte.js";
</script>

{#if toasts.list.length > 0}
  <div class="toasts" role="status" aria-live="polite">
    {#each toasts.list as one (one.id)}
      <div class="toast">
        <span class="toast-text">{one.text}</span>
        {#if one.url}
          <button class="toast-link" title="Open on GitHub" onclick={() => openLink(one.url!)}>{one.url}</button>
        {/if}
        <button class="toast-close" aria-label="Dismiss" onclick={() => dismiss(one.id)}>×</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: var(--z-picture, 60);
    display: grid;
    gap: 8px;
    max-width: min(420px, calc(100vw - 32px));
  }

  .toast {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 10px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-left: 3px solid #3fb950;
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, #1f2428);
    color: var(--vscode-foreground, #e6edf3);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font-size: 12px;
  }

  .toast-text {
    font-weight: 600;
  }

  .toast-link {
    grid-column: 1;
    padding: 0;
    border: 0;
    background: none;
    color: var(--vscode-textLink-foreground, #58a6ff);
    font: inherit;
    text-align: left;
    word-break: break-all;
    cursor: pointer;
  }

  .toast-close {
    grid-column: 2;
    grid-row: 1;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
</style>
