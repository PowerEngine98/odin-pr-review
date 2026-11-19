<script lang="ts">
  import { notify } from "../state.svelte.js";
  import { closeLog, odinLog } from "./support.svelte.js";

  const shown = $derived(odinLog.clean ? odinLog.anonymized : odinLog.raw);
  const count = $derived(shown ? shown.split("\n").length : 0);
  let body = $state<HTMLPreElement | null>(null);
  let copied = $state(false);

  $effect(() => {
    shown;
    if (body) body.scrollTop = body.scrollHeight;
  });

  function copy(): void {
    notify("copyText", {
      text: shown,
      said: odinLog.clean ? "Copied the anonymized Odin log" : "Copied the Odin log",
    });
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") closeLog();
  }}
/>

<div class="log-backdrop" role="presentation" onclick={closeLog}></div>
<div class="log" role="dialog" aria-label="Odin log" tabindex="-1">
  <div class="log-head">
    <span class="log-title">Odin log</span>
    <div class="log-modes" role="radiogroup" aria-label="Which log">
      <button
        type="button"
        role="radio"
        aria-checked={odinLog.clean}
        class:on={odinLog.clean}
        title="Repository, branch, user and file names, paths, links, tokens and commits replaced, safe to share"
        onclick={() => (odinLog.clean = true)}
      >Anonymized</button>
      <button
        type="button"
        role="radio"
        aria-checked={!odinLog.clean}
        class:on={!odinLog.clean}
        title="Exactly what Odin wrote, for your own eyes"
        onclick={() => (odinLog.clean = false)}
      >Actual</button>
    </div>
    <span class="log-count">{count} {count === 1 ? "line" : "lines"}</span>
    <button class="log-copy" disabled={!shown} onclick={copy}>{copied ? "Copied" : "Copy"}</button>
    <button class="log-close" title="Close (Esc)" aria-label="Close" onclick={closeLog}>×</button>
  </div>
  {#if !odinLog.clean}
    <p class="log-warn">The actual log names your repositories, branches, files and people. Share the anonymized one.</p>
  {/if}
  {#if odinLog.loading}
    <p class="log-empty">Reading the log…</p>
  {:else if !shown}
    <p class="log-empty">Nothing logged yet in this window.</p>
  {:else}
    <pre class="log-body" bind:this={body}>{shown}</pre>
  {/if}
</div>

<style>
  .log-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-picture, 60);
    background: rgba(0, 0, 0, 0.35);
  }

  .log {
    position: fixed;
    z-index: calc(var(--z-picture, 60) + 1);
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(920px, calc(100vw - 32px));
    height: min(640px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, #1f2428);
    color: var(--vscode-foreground, #e6edf3);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    font-family: var(--vscode-font-family, system-ui);
    font-size: 13px;
    overflow: hidden;
  }

  .log-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
  }

  .log-title {
    font-weight: 600;
  }

  .log-modes {
    display: flex;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    overflow: hidden;
  }

  .log-modes button {
    padding: 3px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    opacity: 0.75;
  }

  .log-modes button.on {
    background: color-mix(in srgb, var(--vscode-focusBorder, #1f6feb) 30%, transparent);
    opacity: 1;
  }

  .log-count {
    margin-left: auto;
    font-size: 12px;
    opacity: 0.65;
  }

  .log-copy {
    padding: 3px 12px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .log-copy:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .log-close {
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.7;
  }

  .log-warn {
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 14px;
    font-size: 12px;
    color: var(--warning, #d29922);
    background: color-mix(in srgb, var(--warning, #d29922) 10%, transparent);
  }

  .log-empty {
    margin: auto;
    opacity: 0.7;
  }

  .log-body {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 10px 14px;
    overflow: auto;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    user-select: text;
  }
</style>
