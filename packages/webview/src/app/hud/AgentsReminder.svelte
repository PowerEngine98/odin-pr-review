<script lang="ts">
  import { model, notify, settings } from "../state.svelte.js";
  import Pairing from "./Pairing.svelte";

  let skipped = $state(false);
  let looked = false;

  const live = $derived(model.current.meta.worktree === true);
  const found = $derived(model.current.agents);
  const anyOn = $derived(
    (found ?? []).some((agent) => (settings.pairing ?? []).includes(agent.id)),
  );
  const asking = $derived(
    live && settings.hud.agents !== false && !skipped && found !== undefined && found.length > 0 && !anyOn,
  );

  $effect(() => {
    if (!live || looked || found !== undefined) return;
    looked = true;
    notify("discoverAgents", {});
  });

  function skip() {
    skipped = true;
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (asking && event.key === "Escape") skip();
  }}
/>

{#if asking}
  <div class="reminder-backdrop" role="presentation" onclick={skip}></div>
  <div class="reminder" role="dialog" aria-modal="true" aria-label="Pair an AI agent">
    <span class="reminder-title">Pair an AI agent</span>
    <p class="reminder-lead">
      No agent is switched on, so AI pairing, tours and asking about a line are off. Switch on
      at least one; you can change this any time in Settings → AI agents.
    </p>
    <Pairing embedded />
    <div class="reminder-actions">
      <button class="reminder-skip" onclick={skip}>Skip for now</button>
    </div>
  </div>
{/if}

<style>
  .reminder-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
    background: color-mix(in srgb, #000 55%, transparent);
  }

  .reminder {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: calc(var(--z-menu) + 1);
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(460px, calc(100vw - 32px));
    max-height: min(85vh, 640px);
    overflow-y: auto;
    padding: 20px 24px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    font-size: 12px;
  }

  .reminder-title {
    font-size: 13px;
    font-weight: 600;
  }

  .reminder-lead {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
  }

  .reminder-actions {
    display: flex;
    justify-content: flex-end;
  }

  .reminder-skip {
    padding: 5px 12px;
    border: 1px solid var(--panel-edge);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
</style>
