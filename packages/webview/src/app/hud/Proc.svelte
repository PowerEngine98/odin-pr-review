<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { model, notify } from "../state.svelte.js";
  import { loadXterm } from "./Cli.svelte";
  import { procs, type ProcView } from "./processes.svelte.js";

  let { agent, proc }: { agent: string; proc: ProcView } = $props();

  let holder: HTMLDivElement | undefined = $state();
  let readable = $state(true);
  let term: { write(data: string): void; dispose(): void; loadAddon(addon: unknown): void; open(element: HTMLElement): void } | undefined;
  let fit: { fit(): void } | undefined;
  let observer: ResizeObserver | undefined;
  const pid = proc.pid;

  function colour(name: string, fallback: string): string {
    const value = holder ? getComputedStyle(holder).getPropertyValue(name).trim() : "";
    return value || fallback;
  }

  function heard(event: MessageEvent): void {
    const message = event.data as { type?: string; agent?: string; pid?: number; data?: string; readable?: boolean };
    if (message?.agent !== agent || message.pid !== pid) return;
    if (message.type === "procReplay") {
      readable = message.readable !== false;
      if (message.data) term?.write(message.data.replace(/\r?\n/g, "\r\n"));
    } else if (message.type === "procData" && message.data) {
      term?.write(message.data.replace(/\r?\n/g, "\r\n"));
    }
  }

  onMount(async () => {
    window.addEventListener("message", heard);
    const xterm = await loadXterm((model.current as { xterm?: { script: string; fit: string; css: string } }).xterm);
    if (xterm && holder) {
      const made = new xterm.Terminal({
        disableStdin: true,
        cursorBlink: false,
        convertEol: false,
        fontFamily: colour("--vscode-editor-font-family", "Menlo, Consolas, monospace"),
        fontSize: 12,
        scrollback: 10000,
        theme: { background: colour("--bg", "#0d1117"), foreground: colour("--text", "#e6edf3") },
      });
      fit = new xterm.FitAddon();
      made.loadAddon(fit);
      made.open(holder);
      term = made;
      observer = new ResizeObserver(() => {
        try {
          fit?.fit();
        } catch {
          return;
        }
      });
      observer.observe(holder);
    }
    notify("procAttach", { pid });
  });

  onDestroy(() => {
    window.removeEventListener("message", heard);
    notify("procDetach", { pid });
    observer?.disconnect();
    term?.dispose();
  });
</script>

<div class="proc-view">
  <div class="proc-head">
    {#if procs.icons[proc.icon]}<img class="proc-head-icon" src={procs.icons[proc.icon]} alt="" />{/if}
    <code class="proc-command" title={proc.command}>{proc.command}</code>
    <span class="proc-pid">PID {proc.pid}</span>
    {#each proc.ports as port (port)}
      <span class="proc-pid" title="Listening on port {port}">port {port}</span>
    {/each}
    <span class="proc-state {proc.status}">{proc.status}</span>
    {#if proc.status !== "terminated"}
      <button class="proc-kill" title="Stop this process and everything it started" onclick={() => notify("procKill", { pid })}>Kill</button>
    {/if}
  </div>
  {#if !readable}
    <p class="proc-note">
      This process writes to {agent === "claude" ? "Claude" : "the agent"} directly rather than to a file, so its output cannot be followed
      from here. Processes started in the background can be.
    </p>
  {/if}
  <div class="proc-screen" bind:this={holder}></div>
</div>

<style>
  .proc-view {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  .proc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--muted);
    font-size: 10px;
  }
  .proc-head-icon {
    width: 14px;
    height: 14px;
  }
  .proc-command {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .proc-pid {
    font-variant-numeric: tabular-nums;
  }
  .proc-state.running { color: var(--proc-running); }
  .proc-state.idle { color: var(--proc-idle); }
  .proc-state.stopped { color: var(--proc-stopped); }
  .proc-state.terminated { color: var(--proc-terminated); }
  .proc-kill {
    padding: 1px 8px;
    border: 1px solid color-mix(in srgb, var(--proc-terminated) 60%, transparent);
    border-radius: 4px;
    background: transparent;
    color: var(--proc-terminated);
    font: inherit;
    cursor: pointer;
  }
  .proc-note {
    margin: 8px;
    color: var(--muted);
    font-size: 11px;
  }
  .proc-screen {
    flex: 1;
    min-height: 0;
    padding: 4px 0 4px 6px;
    background: var(--bg);
  }
</style>
