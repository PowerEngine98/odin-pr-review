<!--
  A picture at its own size, over the whole window.

  Everywhere else in the page a picture is the size of the box it arrived in —
  a thumbnail above the ask box, an inline image in an answer — and for a
  screenshot that is no size at all: it is a picture of somebody's screen, so
  every word on it is at a fraction of the size it was written at. Pressing it
  opens it here, where it is as large as the window allows and can be zoomed
  past that.

  Over everything, deliberately. The console it was opened from is a panel and
  panels stack; a viewer that a tab could cover would be a viewer the reader has
  to arrange around. It takes every press for the same reason the settling cover
  does — a click meant for the picture must not land on the drawing behind it.

  The same veil as the loading cover, because it is the same statement: what is
  behind this is still there and is not what you are looking at.
-->
<script lang="ts">
  import { wheelZooms } from "../canvas/apple.js";
  import { hidePicture, shownPicture } from "./picture.svelte.js";

  const shown = $derived(shownPicture());

  /** How far in and out it goes. Past four the pixels are the subject. */
  const MIN = 0.2;
  const MAX = 8;

  let scale = $state(1);
  let x = $state(0);
  let y = $state(0);

  /** The frame the picture is placed in, for zooming about the pointer. */
  let stage: HTMLDivElement | undefined = $state();

  /*
   * A new picture starts fresh.
   *
   * Keeping the last one's zoom would open every picture at whatever the
   * previous reader of it happened to leave — including, most of the time, four
   * times too large and scrolled to a corner.
   */
  $effect(() => {
    void shown?.src;
    scale = 1;
    x = 0;
    y = 0;
  });

  /**
   * Zoomed the way the drawing is zoomed.
   *
   * A reader who has just learned that the wheel zooms the graph should not
   * find that it scrolls the picture. Same rule, and the same reason for it: a
   * trackpad already pinches, so on a Mac the wheel pans and the pinch zooms;
   * everywhere else the wheel is the only gesture there is.
   */
  function wheel(event: WheelEvent): void {
    event.preventDefault();
    if (!wheelZooms(event)) {
      x -= event.deltaX;
      y -= event.deltaY;
      return;
    }

    const rect = stage?.getBoundingClientRect();
    const midX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const midY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    // Where the pointer is, measured from the middle the picture is placed
    // about, so whatever is under the cursor stays under it.
    const px = event.clientX - midX;
    const py = event.clientY - midY;

    const rate = event.ctrlKey || event.metaKey ? 320 : 520;
    const next = Math.min(MAX, Math.max(MIN, scale * Math.exp(-event.deltaY / rate)));
    x = px - ((px - x) * next) / scale;
    y = py - ((py - y) * next) / scale;
    scale = next;
  }

  /** Dragging moves the picture, which is the only thing to do with a pointer here. */
  let dragging = $state(false);
  let held: { x: number; y: number } | null = null;

  function grab(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    held = { x: event.clientX - x, y: event.clientY - y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent): void {
    if (!dragging || !held) return;
    x = event.clientX - held.x;
    y = event.clientY - held.y;
  }

  function drop(event: PointerEvent): void {
    dragging = false;
    held = null;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* nothing was captured */
    }
  }

  /** Back to how it opened, for a reader who has zoomed themselves into a corner. */
  function fit(): void {
    scale = 1;
    x = 0;
    y = 0;
  }

  function keys(event: KeyboardEvent): void {
    if (!shown) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      hidePicture();
    }
  }
</script>

<svelte:window onkeydown={keys} />

{#if shown}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="viewer"
    role="dialog"
    aria-modal="true"
    aria-label={shown.alt || "Picture"}
    onwheel={wheel}
    onclick={(event) => {
      // The backdrop puts it away; the picture itself does not, or a reader who
      // misses the edge of it while dragging loses what they were looking at.
      if (event.target === event.currentTarget) hidePicture();
    }}
  >
    <button class="close" type="button" title="Close (Esc)" aria-label="Close" onclick={hidePicture}>
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>

    <div class="stage" bind:this={stage}>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <img
        class="shown"
        class:dragging
        src={shown.src}
        alt={shown.alt}
        draggable="false"
        style="transform: translate({x}px, {y}px) scale({scale})"
        onpointerdown={grab}
        onpointermove={move}
        onpointerup={drop}
        onpointercancel={drop}
        ondblclick={fit}
      />
    </div>

    <div class="said">
      <span class="what">{shown.alt || "Picture"}</span>
      <span class="how">{Math.round(scale * 100)}%</span>
      <button class="reset" type="button" onclick={fit}>Fit</button>
    </div>
  </div>
{/if}

<style>
  /*
   * Over every panel, and taking every press.
   *
   * The console is a panel and the threads are panels above it; a viewer opened
   * from one has to be over both or it is a picture the reader must first dig
   * out from under the thing they opened it from.
   */
  .viewer {
    position: fixed;
    inset: 0;
    z-index: var(--z-picture, 60);
    display: flex;
    align-items: center;
    justify-content: center;
    /* The same veil as the cover shown while the drawing settles, because it is
       the same statement: what is behind this is still there and is not what
       you are looking at. */
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(0.6px);
    animation: picture-in 140ms ease-out both;
  }

  @keyframes picture-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .stage {
    /* The picture is placed about the middle of this and moved from there, so
       the arithmetic above has one origin rather than two. */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .shown {
    max-width: 92vw;
    max-height: 88vh;
    /* Its own pixels, not the browser's idea of a nice blur: a screenshot read
       at four times its size is being read for the text on it. */
    image-rendering: -webkit-optimize-contrast;
    border-radius: 4px;
    box-shadow: 0 18px 60px color-mix(in srgb, #000 60%, transparent);
    cursor: grab;
    user-select: none;
    transform-origin: center center;
  }

  .shown.dragging { cursor: grabbing; }

  .close {
    position: absolute;
    top: 14px;
    right: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--panel-edge);
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
  }

  .close:hover { background: color-mix(in srgb, var(--panel) 70%, var(--text) 12%); }

  /* What it is and how far in, low on the screen where the settling cover puts
     its own line — the one place on this page that is always free. */
  .said {
    position: absolute;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: var(--panel);
    color: var(--text);
    font-size: 11px;
  }

  .what {
    max-width: 40vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .how { opacity: 0.7; font-variant-numeric: tabular-nums; }

  .reset {
    padding: 2px 8px;
    border: 1px solid var(--panel-edge);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .reset:hover { background: color-mix(in srgb, var(--panel) 70%, var(--text) 12%); }

  @media (prefers-reduced-motion: reduce) {
    .viewer { animation: none; }
  }
</style>
