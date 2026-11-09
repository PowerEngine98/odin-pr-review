<script lang="ts">
  import { inEditor, openGhWizard } from "./gh.svelte.js";
  import { host, notify } from "../state.svelte.js";
  import Editor from "../panels/Editor.svelte";
  import { forHost, type Attached } from "../panels/attached.js";
  import { closeSupport, openLink, support, SUPPORT_NEW_ISSUE, type SupportKind } from "./support.svelte.js";

  const KINDS: { kind: SupportKind; label: string; hint: string }[] = [
    { kind: "bug", label: "Bug", hint: "Something is broken or wrong" },
    { kind: "suggestion", label: "Suggestion", hint: "Something could work better" },
    { kind: "feature", label: "Ask for features", hint: "Something Odin does not do yet" },
  ];

  let kind = $state<SupportKind>("bug");
  let title = $state("");
  let body = $state("");
  let attachments = $state<Attached[]>([]);
  let at = $state({ x: 0, y: 0 });
  let placed = $state(false);
  let box = $state<HTMLDivElement | null>(null);
  let dragging: { dx: number; dy: number } | null = null;

  const label = $derived(KINDS.find((one) => one.kind === kind)?.label ?? "Bug");
  const ready = $derived(title.trim().length > 0 && body.trim().length > 0 && !support.sending);
  const signedIn = $derived(!host || support.gh?.ok === true);

  $effect(() => {
    if (!box || placed) return;
    const rect = box.getBoundingClientRect();
    at = { x: Math.max(12, (window.innerWidth - rect.width) / 2), y: Math.max(12, (window.innerHeight - rect.height) / 3) };
    placed = true;
  });

  function grab(event: PointerEvent) {
    if ((event.target as HTMLElement).closest("button")) return;
    dragging = { dx: event.clientX - at.x, dy: event.clientY - at.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (!dragging || !box) return;
    const width = box.offsetWidth;
    at = {
      x: Math.min(Math.max(event.clientX - dragging.dx, 8 - width + 80), window.innerWidth - 80),
      y: Math.min(Math.max(event.clientY - dragging.dy, 0), window.innerHeight - 40),
    };
  }

  function drop() {
    dragging = null;
  }

  function send() {
    if (!ready) return;
    if (!host) {
      const query = new URLSearchParams({ title: title.trim(), body: body.trim(), labels: label });
      openLink(`${SUPPORT_NEW_ISSUE}?${query}`);
      closeSupport();
      return;
    }
    support.sending = true;
    support.error = "";
    const files = forHost(attachments);
    notify("supportIssue", { kind, title: title.trim(), body: body.trim(), ...(files ? { attachments: files } : {}) });
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") closeSupport();
  }}
/>

<div
  class="support"
  role="dialog"
  aria-label="Contact Odin's maintainers"
  tabindex="-1"
  bind:this={box}
  style="left:{at.x}px; top:{at.y}px; visibility:{placed ? 'visible' : 'hidden'}"
>
  <div class="support-head" role="toolbar" tabindex="-1" onpointerdown={grab} onpointermove={move} onpointerup={drop} onpointercancel={drop}>
    <span class="support-title">Support</span>
    <span class="support-where">Opens an issue on PowerEngine98/odin-pr-review</span>
    <button class="support-close" title="Close (Esc)" aria-label="Close" onclick={closeSupport}>×</button>
  </div>

  <div class="support-kinds" role="radiogroup" aria-label="What is it">
    {#each KINDS as one (one.kind)}
      <button
        type="button"
        role="radio"
        aria-checked={kind === one.kind}
        class="support-kind"
        class:on={kind === one.kind}
        title={one.hint}
        onclick={() => (kind = one.kind)}
      >
        {one.label}
      </button>
    {/each}
  </div>

  <input class="support-title-field" placeholder="Title" bind:value={title} maxlength="200" />
  {#if host}
    <Editor bind:value={body} bind:attachments placeholder="What happened, or what you would like…" rows={7} />
  {:else}
    <Editor bind:value={body} placeholder="What happened, or what you would like…" rows={7} />
  {/if}

  {#if host && support.gh && !support.gh.ok}
    <p class="support-gate">
      {#if support.gh.problem === "missing"}
        Posting needs the <strong>GitHub CLI</strong>.
      {:else if support.gh.problem === "outdated"}
        Posting needs GitHub CLI 2.99.0 or newer{support.gh.version ? `; this one is ${support.gh.version}` : ""}.
      {:else}
        Posting needs a GitHub account linked to the GitHub CLI.
      {/if}
      {#if inEditor}
        <button class="support-guide" onclick={() => { closeSupport(); openGhWizard(); }}>Set it up step by step</button>
      {:else}
        Run <code>gh auth login</code> on the machine running VS Code, then open this again.
      {/if}
    </p>
  {/if}
  {#if support.error}
    <p class="support-error">{support.error}</p>
  {/if}

  <div class="support-actions">
    <span class="support-as">
      {#if host && support.gh?.login}Posting as @{support.gh.login} · labelled {label}{:else if !host}Opens GitHub to finish{/if}
    </span>
    <button class="support-cancel" onclick={closeSupport}>Cancel</button>
    <button class="support-send" disabled={!ready || !signedIn} onclick={send}>
      {support.sending ? "Posting…" : "Open issue"}
    </button>
  </div>
</div>

<style>
  .support {
    position: fixed;
    z-index: var(--z-picture, 60);
    width: min(560px, calc(100vw - 24px));
    display: grid;
    gap: 10px;
    padding: 0 14px 14px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, #1f2428);
    color: var(--vscode-foreground, #e6edf3);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    font-family: var(--vscode-font-family, system-ui);
    font-size: 13px;
  }

  .support-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 -14px;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .support-head:active {
    cursor: grabbing;
  }

  .support-title {
    font-weight: 600;
  }

  .support-where {
    color: var(--vscode-descriptionForeground, #8b949e);
    font-size: 11px;
  }

  .support-close {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .support-kinds {
    display: flex;
    gap: 6px;
  }

  .support-kind {
    padding: 4px 10px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .support-kind.on {
    border-color: var(--vscode-focusBorder, #388bfd);
    background: color-mix(in srgb, var(--vscode-focusBorder, #388bfd) 20%, transparent);
  }

  .support-title-field {
    padding: 6px 8px;
    border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
    border-radius: 4px;
    background: var(--vscode-input-background, #0d1117);
    color: var(--vscode-input-foreground, inherit);
    font: inherit;
  }

  .support-gate,
  .support-error {
    margin: 0;
    font-size: 12px;
  }

  .support-error {
    color: var(--vscode-errorForeground, #f85149);
  }

  .support-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .support-as {
    margin-right: auto;
    color: var(--vscode-descriptionForeground, #8b949e);
    font-size: 11px;
  }

  .support-cancel,
  .support-send {
    padding: 5px 12px;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }

  .support-cancel {
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    background: transparent;
    color: inherit;
  }

  .support-send {
    border: 0;
    background: var(--vscode-button-background, #238636);
    color: var(--vscode-button-foreground, #fff);
  }

  .support-guide {
    margin-left: 6px;
    padding: 2px 8px;
    border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .support-send:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
