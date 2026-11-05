<!--
  A block of an agent's answer that can be read aloud.

  The megaphone sits at the end of the block. Pressing it reads the block, and
  pressing it again — or pressing another block's — stops it. While it reads, a
  box follows the word being spoken. Dragging it into the text puts a caret at
  the word under the pointer, and letting go reads from there.
-->
<script lang="ts">
  import { untrack, type Snippet } from "svelte";

  import { settings } from "../state.svelte.js";

  import {
    arrived,
    canNarrate,
    hush,
    narrate,
    narration,
    readableBlock,
    wordUnder,
  } from "./narrator.svelte.js";

  let {
    children,
    live = false,
    text = "",
  }: { children: Snippet; live?: boolean; text?: string } = $props();

  let frame: HTMLElement | undefined = $state();
  let body: HTMLElement | undefined = $state();
  let word = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let caret = $state<{ x: number; y: number; height: number; from: number } | null>(null);
  let grabbed: { x: number; y: number } | null = null;
  let dragged = false;

  const speaking = $derived(body !== undefined && narration.current === body);

  $effect(() => {
    const root = body;
    if (!root) return;
    const forget = readableBlock(root, (from) => narrate(root, boxed, from));
    return () => {
      forget();
      if (narration.current === root) hush();
    };
  });

  $effect(() => {
    void text;
    const root = body;
    if (root && untrack(() => live && settings.autoNarrate)) arrived(root);
  });

  function placed(range: Range) {
    const outer = frame!.getBoundingClientRect();
    const scale = frame!.offsetWidth ? outer.width / frame!.offsetWidth : 1;
    const inner = range.getBoundingClientRect();
    return {
      x: (inner.left - outer.left) / scale,
      y: (inner.top - outer.top) / scale,
      width: inner.width / scale,
      height: inner.height / scale,
    };
  }

  function boxed(range: Range | null): void {
    word = range && frame ? placed(range) : null;
  }

  function grab(event: PointerEvent): void {
    if (event.button !== 0) return;
    grabbed = { x: event.clientX, y: event.clientY };
    dragged = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function drag(event: PointerEvent): void {
    if (!grabbed || !body || !frame) return;
    if (!dragged && Math.hypot(event.clientX - grabbed.x, event.clientY - grabbed.y) < 4) return;
    dragged = true;
    const under = wordUnder(body, event.clientX, event.clientY);
    caret = under && { ...placed(under.caret), from: under.from };
  }

  function drop(): void {
    if (!grabbed) return;
    grabbed = null;
    const at = caret;
    caret = null;
    if (!dragged) {
      press();
      return;
    }
    if (at && body) narrate(body, boxed, at.from);
  }

  function press(): void {
    if (speaking) {
      hush();
      return;
    }
    if (body) narrate(body, boxed);
  }
</script>

<div class="narrated" bind:this={frame}>
  <div bind:this={body}>{@render children()}</div>
  {#if speaking && word}
    <span
      class="word"
      style:left="{word.x - 2}px"
      style:top="{word.y - 1}px"
      style:width="{word.width + 4}px"
      style:height="{word.height + 2}px"
    ></span>
  {/if}
  {#if caret}
    <span
      class="caret"
      style:left="{caret.x - 2}px"
      style:top="{caret.y}px"
      style:height="{caret.height}px"
    ></span>
  {/if}
  {#if canNarrate()}
    <button
      class="speak"
      class:on={speaking}
      type="button"
      title={speaking
        ? "Stop reading aloud"
        : "Read aloud, or drag into the text to start from a word"}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
      onpointerdown={grab}
      onpointermove={drag}
      onpointerup={drop}
      onpointercancel={() => {
        grabbed = null;
        caret = null;
      }}
      onkeydown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          press();
        }
      }}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path
          d="M2 6.2v3.6h2.2L11 13V3L4.2 6.2z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
        <path d="M4.4 9.8l1 3.2h1.8l-.9-2.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        <path d="M13 6.2a2.4 2.4 0 0 1 0 3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .narrated {
    position: relative;
  }
  .word {
    position: absolute;
    pointer-events: none;
    border: 1px solid var(--vscode-focusBorder, #0a84ff);
    border-radius: 3px;
    background: color-mix(in srgb, var(--vscode-focusBorder, #0a84ff) 18%, transparent);
    transition: left 80ms ease, top 80ms ease, width 80ms ease;
  }
  .caret {
    position: absolute;
    width: 4px;
    pointer-events: none;
    border-radius: 2px;
    background: var(--vscode-focusBorder, #0a84ff);
  }
  .speak {
    display: flex;
    margin: 2px 0 6px auto;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--muted, currentColor);
    cursor: pointer;
    touch-action: none;
    opacity: 0.55;
  }
  .speak:hover { opacity: 1; }
  .speak:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .speak.on {
    opacity: 1;
    color: var(--vscode-focusBorder, #0a84ff);
  }
</style>
