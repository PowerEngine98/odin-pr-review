<script lang="ts">
  import Pull from "../sidebar/Pull.svelte";
  import type { PullView } from "../sidebar/model.js";
  import { ago } from "../panels/Thread.svelte";
  import { notify } from "../state.svelte.js";
  import { askStack, stack } from "./stack.svelte.js";

  let { number }: { number: number } = $props();

  let open = $state(false);
  let pinned = $state(false);
  let leaving: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    askStack();
  });

  const view = $derived(stack.view);
  const position = $derived(view ? view.pulls.findIndex((pr) => pr.number === number) + 1 : 0);
  const rows = $derived<PullView[]>(
    view
      ? [...view.pulls].reverse().map((pr) => ({
          pr,
          current: pr.number === number,
          moved: false,
          when: ago(pr.updatedAt ?? pr.createdAt),
          opened: ago(pr.createdAt),
        }))
      : [],
  );

  function enter(): void {
    if (leaving) clearTimeout(leaving);
    if (!open) askStack();
    open = true;
  }

  function leave(): void {
    if (pinned) return;
    leaving = setTimeout(() => (open = false), 180);
  }

  function send(_type: string, payload: Record<string, unknown>): void {
    if (payload.number === number) return;
    notify("stackRead", payload);
    open = false;
    pinned = false;
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && open) {
      open = false;
      pinned = false;
    }
  }}
/>

{#if view && position > 0}
  <span class="stack" role="group" onmouseenter={enter} onmouseleave={leave}>
    <button
      class="stack-chip"
      class:on={open}
      title="Part of a stack of {view.pulls.length} pull requests: this is number {position}, counting up from {view.base}"
      aria-expanded={open}
      onclick={() => {
        pinned = !pinned;
        open = pinned;
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M8 1.6 14.2 4.8 8 8 1.8 4.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M1.8 8 8 11.2 14.2 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M1.8 11.2 8 14.4 14.2 11.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {position}/{view.pulls.length}
    </button>
    {#if open}
      <div class="stack-pop" role="dialog" aria-label="Stacked pull requests">
        <div class="stack-head">Stack of {view.pulls.length}</div>
        <div class="stack-rows">
          {#each rows as row (row.pr.number)}
            <div class="stack-row" class:here={row.current}>
              <span class="stack-rail" aria-hidden="true"></span>
              <Pull pull={row} {send} />
            </div>
          {/each}
          <div class="stack-base">
            <span class="stack-dot" aria-hidden="true"></span>
            <code>{view.base}</code>
          </div>
        </div>
      </div>
    {/if}
  </span>
{/if}

<style>
  .stack {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
  }

  .stack-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 999px;
    background: color-mix(in srgb, var(--text, #e6edf3) 6%, transparent);
    color: var(--text, #e6edf3);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .stack-chip:hover,
  .stack-chip.on {
    background: color-mix(in srgb, var(--text, #e6edf3) 12%, transparent);
  }

  .stack-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 70;
    width: min(440px, calc(100vw - 24px));
    padding: 8px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, #1f2428);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }

  .stack-head {
    padding: 2px 6px 8px;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.8;
  }

  .stack-rows {
    display: flex;
    flex-direction: column;
    max-height: min(420px, 70vh);
    overflow-y: auto;
  }

  .stack-row {
    position: relative;
    display: flex;
    padding-left: 10px;
    border-radius: 6px;
  }

  .stack-row > :global(.pull) {
    flex: 1 1 auto;
    min-width: 0;
  }

  .stack-rail {
    position: absolute;
    left: 3px;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 2px;
    background: transparent;
  }

  .stack-row.here {
    background: color-mix(in srgb, var(--vscode-focusBorder, #1f6feb) 12%, transparent);
  }

  .stack-row.here .stack-rail {
    background: var(--vscode-focusBorder, #1f6feb);
  }

  .stack-base {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 4px;
    font-size: 12px;
  }

  .stack-dot {
    width: 8px;
    height: 8px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    opacity: 0.7;
  }

  .stack-base code {
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--vscode-focusBorder, #1f6feb) 18%, transparent);
    color: var(--vscode-textLink-foreground, #4493f8);
    font-size: 11px;
  }
</style>
