<script lang="ts">
  import { model } from "../state.svelte.js";
  import { goLiveToDiscuss, openDiscussion, stayCommitted, tourPanel } from "./panel.svelte.js";

  const asking = $derived(tourPanel.goLiveFor !== null);
  const branch = $derived((model.current.meta.headRef ?? "").replace(/^origin\//, ""));
  const pull = $derived(model.current.meta.pullRequest?.number);

  $effect(() => {
    if (!tourPanel.pendingDiscuss || model.current.meta.worktree !== true) return;
    if ((model.current.agents ?? []).length === 0) return;
    if (openDiscussion()) tourPanel.pendingDiscuss = false;
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (asking && !tourPanel.goingLive && event.key === "Escape") stayCommitted();
  }}
/>

{#if asking}
  <div
    class="go-live-backdrop"
    role="presentation"
    onclick={() => {
      if (!tourPanel.goingLive) stayCommitted();
    }}
  ></div>
  <div class="go-live-dialog" role="dialog" aria-modal="true" aria-label="Go live to discuss this">
    <span class="go-live-title">Go live to discuss this?</span>
    <p class="go-live-lead">
      Agents work on the files on disk, and this is the change as committed. Going live checks out
      {#if branch}<code>{branch}</code>{:else}the branch{/if}
      and opens the live reading of
      {#if pull !== undefined}#{pull}{:else}this change{/if}, with this frame waiting in the
      agent's composer.
    </p>
    {#if tourPanel.liveFailed}
      <p class="go-live-failed" role="alert">{tourPanel.liveFailed}</p>
    {/if}
    <div class="go-live-actions">
      <button class="go-live-stay" disabled={tourPanel.goingLive} onclick={stayCommitted}>Not now</button>
      <button class="go-live-do" disabled={tourPanel.goingLive || pull === undefined} onclick={goLiveToDiscuss}>
        {#if tourPanel.goingLive}Going live…{:else}Go live and discuss{/if}
      </button>
    </div>
  </div>
{/if}

<style>
  .go-live-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
    background: color-mix(in srgb, #000 55%, transparent);
  }

  .go-live-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: calc(var(--z-menu) + 1);
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(440px, calc(100vw - 32px));
    padding: 20px 24px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    font-size: 12px;
  }

  .go-live-title {
    font-size: 13px;
    font-weight: 600;
  }

  .go-live-lead {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
  }

  .go-live-lead code {
    color: var(--text);
    font-family: var(--mono);
  }

  .go-live-failed {
    margin: 0;
    color: var(--vscode-errorForeground, #f85149);
    line-height: 1.5;
  }

  .go-live-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .go-live-stay,
  .go-live-do {
    padding: 5px 12px;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }

  .go-live-stay {
    border: 1px solid var(--panel-edge);
    background: transparent;
    color: inherit;
  }

  .go-live-do {
    border: 0;
    background: var(--vscode-button-background, #0a84ff);
    color: var(--vscode-button-foreground, #fff);
  }

  .go-live-stay:disabled,
  .go-live-do:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
