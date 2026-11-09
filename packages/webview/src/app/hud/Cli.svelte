<script lang="ts" module>
  interface XtermTerminal {
    open(element: HTMLElement): void;
    write(data: string): void;
    reset(): void;
    focus(): void;
    dispose(): void;
    loadAddon(addon: unknown): void;
    onData(listener: (data: string) => void): { dispose(): void };
    cols: number;
    rows: number;
  }

  interface Xterm {
    Terminal: new (options: Record<string, unknown>) => XtermTerminal;
    FitAddon: new () => { fit(): void };
  }

  let loading: Promise<Xterm | null> | undefined;

  function script(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(tag);
    });
  }

  export function loadXterm(from: { script: string; fit: string; css: string } | undefined): Promise<Xterm | null> {
    if (loading) return loading;
    loading = (async () => {
      if (!from) return null;
      const sheet = document.createElement("link");
      sheet.rel = "stylesheet";
      sheet.href = from.css;
      document.head.appendChild(sheet);
      try {
        await script(from.script);
        await script(from.fit);
      } catch {
        return null;
      }
      const found = window as unknown as { Terminal?: Xterm["Terminal"]; FitAddon?: { FitAddon: Xterm["FitAddon"] } };
      if (!found.Terminal || !found.FitAddon?.FitAddon) return null;
      return { Terminal: found.Terminal, FitAddon: found.FitAddon.FitAddon };
    })();
    return loading;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { model, notify } from "../state.svelte.js";
  import { inEditor } from "../support/gh.svelte.js";

  let { agent, name }: { agent: string; name: string } = $props();

  let holder: HTMLDivElement | undefined = $state();
  let state = $state<"loading" | "running" | "ended" | "unavailable">("loading");
  let ended = $state("");
  let resumed = $state("");

  let term: XtermTerminal | undefined;
  let fit: { fit(): void } | undefined;
  let asker = "";
  let observer: ResizeObserver | undefined;
  let typed: { dispose(): void } | undefined;
  let sized = "";

  function colour(name: string, fallback: string): string {
    const value = holder ? getComputedStyle(holder).getPropertyValue(name).trim() : "";
    return value || fallback;
  }

  function measure(): void {
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const now = `${term.cols}x${term.rows}`;
    if (now === sized) return;
    sized = now;
    notify("cliResize", { agent, cols: term.cols, rows: term.rows });
  }

  function start(): void {
    if (!term) return;
    asker = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ended = "";
    state = "running";
    term.reset();
    measure();
    notify("cliOpen", { agent, cols: term.cols, rows: term.rows, asker });
    term.focus();
  }

  function stop(): void {
    notify("cliClose", { agent });
  }

  function heard(event: MessageEvent): void {
    const message = event.data as { type?: string; agent?: string; data?: string; for?: string; code?: number; error?: string; resumed?: string };
    if (!message || message.agent !== agent || !term) return;
    if (message.type === "cliData" && state === "running") term.write(message.data ?? "");
    else if (message.type === "cliReplay" && message.for === asker) {
      resumed = message.resumed ?? "";
      if (message.data) term.write(message.data);
    } else if (message.type === "cliExit") {
      state = "ended";
      ended = message.error ?? `${name} exited${message.code ? ` with code ${message.code}` : ""}.`;
    }
  }

  onMount(async () => {
    if (!inEditor) {
      state = "unavailable";
      return;
    }
    const xterm = await loadXterm((model.current as { xterm?: { script: string; fit: string; css: string } }).xterm);
    if (!xterm || !holder) {
      state = "unavailable";
      return;
    }
    term = new xterm.Terminal({
      cursorBlink: true,
      fontFamily: colour("--vscode-editor-font-family", "Menlo, Consolas, monospace"),
      fontSize: 12,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: colour("--bg", "#0d1117"),
        foreground: colour("--text", "#e6edf3"),
        cursor: colour("--text", "#e6edf3"),
        selectionBackground: "rgba(120, 160, 255, 0.35)",
      },
    });
    fit = new xterm.FitAddon();
    term.loadAddon(fit);
    term.open(holder);
    typed = term.onData((data) => notify("cliInput", { agent, data }));
    window.addEventListener("message", heard);
    observer = new ResizeObserver(() => measure());
    observer.observe(holder);
    start();
  });

  onDestroy(() => {
    window.removeEventListener("message", heard);
    observer?.disconnect();
    typed?.dispose();
    term?.dispose();
  });
</script>

<div class="cli">
  {#if state === "unavailable"}
    <p class="cli-note">
      {#if inEditor}
        The terminal could not load. Reload the window and try again.
      {:else}
        The {name} CLI runs in VS Code. Open this reading there to use it.
      {/if}
    </p>
  {:else}
    <div class="cli-bar">
      <span class="cli-what">
        {#if resumed}Continuing Odin's conversation{:else}Interactive {name}{/if}
      </span>
      <span class="cli-fill"></span>
      {#if state === "ended"}
        <span class="cli-ended">{ended}</span>
        <button class="cli-button" onclick={start}>Start again</button>
      {:else}
        <button class="cli-button" title="End this session" onclick={stop}>Stop</button>
      {/if}
    </div>
    <div
      class="cli-screen"
      bind:this={holder}
      role="presentation"
      onkeydown={(event) => event.stopPropagation()}
      onkeyup={(event) => event.stopPropagation()}
    ></div>
  {/if}
</div>

<style>
  .cli {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 220px;
  }

  .cli-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--muted);
    font-size: 10px;
  }

  .cli-fill {
    flex: 1;
  }

  .cli-ended {
    color: var(--text);
  }

  .cli-button {
    padding: 1px 8px;
    border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .cli-screen {
    flex: 1;
    min-height: 0;
    padding: 4px 0 0 6px;
    background: var(--bg);
  }

  .cli-note {
    margin: 12px;
    color: var(--muted);
    font-size: 11px;
  }
</style>
