<!--
  Drawings the reader pinned to the change.

  An agent asked how something is put together answers with a picture, and the
  picture belongs beside the thing it is about rather than at the bottom of a log
  that scrolls. Dragging one out of a terminal and dropping it on the canvas
  keeps it there: in the drawing's own coordinates, so it stays with the cards it
  was put next to however the camera moves, and until the reader throws it away.

  Inside the canvas layer, which is what makes that true. Anywhere above it and
  a pinned drawing would stand still while the change moved under it.
-->
<script lang="ts">
  import type { PinnedDiagram } from "../model.js";
  import { model, notify, view } from "../state.svelte.js";
  import { pinHere, pinnedHere } from "./pins.js";
  import Diagram from "../panels/Diagram.svelte";
  import { legibleAt } from "./legible.js";

  const pinned = $derived(pinnedHere());

  /**
   * Too far out to read, so not drawn as something to read.
   *
   * The same cut a card makes, from the same number: past it a card stops
   * building rows and stands as a block, and a diagram whose every node is a
   * word is in exactly the same position — a picture nobody can make anything
   * out of, laid out and painted on every frame of every pan. Drawn as a plain
   * grey shape instead, which is what it looks like from that distance anyway
   * and what a reader is navigating by at that zoom.
   */
  const legible = $derived(legibleAt(model.current.charWidth));
  const far = $derived(view.scale < legible);

  /** The one being moved or stretched, and where the gesture began. */
  let holding = $state<{
    id: string;
    what: "move" | "size";
    x: number;
    y: number;
    was: { x: number; y: number; width: number; height: number };
  } | null>(null);

  /**
   * Where it is *while* it is being dragged, kept here rather than in settings.
   *
   * Every write to the reader's settings is posted to the host and written to
   * the editor's storage. Writing the position on each pointer move meant a
   * message and a disk write per frame of a drag — for a number that is wrong
   * a sixtieth of a second later anyway. The gesture moves this; landing writes
   * it down once.
   */
  let live = $state<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );

  /** Where a given drawing is right now, gesture included. */
  function at(one: PinnedDiagram): PinnedDiagram {
    return holding?.id === one.id && live ? { ...one, ...live } : one;
  }

  function change(id: string, part: Partial<PinnedDiagram>): void {
    pinHere(pinnedHere().map((one) => (one.id === id ? { ...one, ...part } : one)));
  }

  function grab(one: PinnedDiagram, what: "move" | "size", event: PointerEvent): void {
    /*
     * Kept from the canvas underneath, which would otherwise start a pan: the
     * drawing and the thing pinned to it both take pointers, and the one under
     * the cursor is the one being moved.
     */
    event.preventDefault();
    event.stopPropagation();
    const was = { x: one.x, y: one.y, width: one.width, height: one.height };
    holding = { id: one.id, what, x: event.clientX, y: event.clientY, was };
    live = { ...was };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function drag(event: PointerEvent): void {
    if (!holding) return;
    // Screen pixels into canvas units: a drag of forty pixels at a tenth of
    // life size is four hundred units of the drawing.
    const dx = (event.clientX - holding.x) / view.scale;
    const dy = (event.clientY - holding.y) / view.scale;

    if (holding.what === "move") {
      live = {
        ...holding.was,
        x: Math.round(holding.was.x + dx),
        y: Math.round(holding.was.y + dy),
      };
      return;
    }
    live = {
      ...holding.was,
      width: Math.round(Math.max(160, holding.was.width + dx)),
      height: Math.round(Math.max(120, holding.was.height + dy)),
    };
  }

  function drop(event: PointerEvent): void {
    if (!holding) return;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* nothing was captured */
    }
    // Written down once, where it was let go.
    if (live) change(holding.id, live);
    holding = null;
    live = null;
  }

  function throwAway(id: string): void {
    pinHere(pinnedHere().filter((one) => one.id !== id));
  }

  /**
   * The drawing as the agent wrote it, on the clipboard.
   *
   * As markdown rather than bare mermaid: what comes off this button is meant
   * to be pasted somewhere — a pull request description, an issue, a document —
   * and every one of those renders a fenced block and none of them renders a
   * loose `graph TD`.
   *
   * Through the host, because a webview's own clipboard is refused often
   * enough, and silently enough, that the button would do nothing more often
   * than it worked.
   */
  let copied = $state<string | null>(null);

  function copy(one: PinnedDiagram): void {
    notify("copyText", {
      text: `\`\`\`mermaid\n${one.code}\n\`\`\``,
      said: "copied the diagram",
    });
    copied = one.id;
    setTimeout(() => (copied = copied === one.id ? null : copied), 1200);
  }
</script>

{#each pinned as pin (pin.id)}
  {@const one = at(pin)}
  <div
    class="pin"
    class:held={holding?.id === one.id}
    style="left:{one.x}px;top:{one.y}px;width:{one.width}px;height:{one.height}px"
  >
    <!-- The bar is the handle, so the drawing inside can be read and selected
         without the whole thing sliding away under the pointer. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pin-bar"
      onpointerdown={(event) => grab(one, "move", event)}
      onpointermove={drag}
      onpointerup={drop}
      onpointercancel={drop}
    >
      <span class="pin-what">{copied === one.id ? "copied" : "diagram"}</span>
      <button
        class="pin-close"
        title="Copy the markdown for this diagram"
        aria-label="Copy the markdown for this diagram"
        onpointerdown={(event) => event.stopPropagation()}
        onclick={() => copy(one)}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d="M10.6 3.4A1.5 1.5 0 0 0 9.1 2.4H3.9a1.5 1.5 0 0 0-1.5 1.5v5.2a1.5 1.5 0 0 0 1 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        class="pin-close"
        title="Throw this away"
        aria-label="Throw this away"
        onpointerdown={(event) => event.stopPropagation()}
        onclick={() => throwAway(one.id)}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="pin-body">
      {#if far}
        <div class="pin-shape" aria-hidden="true"></div>
      {:else}
        <Diagram code={one.code} />
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pin-grip"
      onpointerdown={(event) => grab(one, "size", event)}
      onpointermove={drag}
      onpointerup={drop}
      onpointercancel={drop}
    ></div>
  </div>
{/each}

<style>
  .pin {
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 8px;
    /* Solid, like a card: a picture with the drawing showing through it is two
       drawings on top of each other. */
    background: var(--bg);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
    overflow: hidden;
  }

  /* Nothing animated while it is being dragged: a transition on position turns
     a drag into the box trailing the pointer. */
  .pin.held {
    box-shadow: 0 10px 26px rgb(0 0 0 / 0.5);
  }

  .pin-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: grab;
    /* The bar is dragged, not selected. */
    user-select: none;
  }

  .pin.held .pin-bar {
    cursor: grabbing;
  }

  .pin-what {
    flex: 1 1 auto;
    min-width: 0;
  }

  .pin-close {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .pin-close:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  /* What a diagram looks like from far enough away: a shape where something is.
     Flat rather than a rendering held at arm's length, because that is the
     honest picture of a thing too small to read. */
  .pin-shape {
    width: 100%;
    height: 100%;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 20%, transparent);
  }

  .pin-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 4px;
  }

  /* The corner, wider than the line it draws so it can actually be hit. */
  .pin-grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    background: linear-gradient(
      135deg,
      transparent 50%,
      color-mix(in srgb, var(--text) 28%, transparent) 50%
    );
  }
</style>
