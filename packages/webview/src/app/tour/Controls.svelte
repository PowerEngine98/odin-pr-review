<!--
  The tour's player, along the bottom of the canvas like a video's.

  Play and the frame steps on the left, what is being said in the middle with
  the bar for the topic under it, and the way out on the right. The bar's
  circles are where each frame begins, so a reader who missed a sentence can
  press just before it rather than scrubbing for it.

  It reports how tall it is to the page (`--tour-room`), so the panels that also
  sit along the bottom can stand on it instead of over it.
-->
<script lang="ts">
  import { clock, topicSeconds } from "@odin/core/tour/tour.js";

  import { leaveTour, next, previous, seek, toggle } from "./player.svelte.js";
  import { discussFrame } from "./panel.svelte.js";
  import Jump from "./Jump.svelte";
  import { tour } from "./state.svelte.js";
  import { fractionAt, markerPositions, secondsAt, spokenRuns } from "./timeline.js";

  const topics = $derived(tour.data?.topics ?? []);
  const topic = $derived(topics[tour.topic]);
  const total = $derived(topic ? topicSeconds(topic) : 0);
  const markers = $derived(topic ? markerPositions(topic) : []);
  const runs = $derived(spokenRuns(tour.subtitle, tour.spokenTo));

  /** Where the pointer has the bar while it is being dragged, ahead of the player catching up. */
  let dragAt = $state<number | null>(null);
  const shown = $derived(dragAt ?? (topic ? fractionAt(topic, tour.elapsed) : 0));

  let track: HTMLElement | undefined = $state();
  let height = $state(0);

  $effect(() => {
    if (!tour.active) return;
    const root = document.documentElement;
    root.style.setProperty("--tour-room", `${height + 12}px`);
    return () => root.style.removeProperty("--tour-room");
  });

  function fractionOf(event: PointerEvent): number {
    if (!track) return 0;
    const box = track.getBoundingClientRect();
    return box.width > 0 ? (event.clientX - box.left) / box.width : 0;
  }

  function grab(event: PointerEvent): void {
    if (event.button !== 0 || !topic) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const at = Math.min(1, Math.max(0, fractionOf(event)));
    dragAt = at;
    seek(secondsAt(topic, at));
    event.preventDefault();
  }

  function drag(event: PointerEvent): void {
    if (dragAt === null || !topic) return;
    const at = Math.min(1, Math.max(0, fractionOf(event)));
    dragAt = at;
    seek(secondsAt(topic, at));
  }

  function release(): void {
    dragAt = null;
  }

  /** The bar as a slider from the keyboard: five seconds a press, and taken so the frame keys do not also fire. */
  function nudge(event: KeyboardEvent): void {
    if (!topic) return;
    const step = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
    if (event.key === "Home") seek(0);
    else if (event.key === "End") seek(total);
    else if (step) seek(Math.min(total, Math.max(0, tour.elapsed + step)));
    else return;
    event.preventDefault();
  }
</script>

<Jump />

{#if tour.active && topic}
  <div class="player" bind:offsetHeight={height} role="region" aria-label="Tour player">
    <div class="buttons">
      <button
        class="round main"
        title={tour.playing ? "Pause (Space)" : "Play (Space)"}
        aria-label={tour.playing ? "Pause" : "Play"}
        onclick={toggle}
      >
        {#if tour.playing}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="4" y="3" width="2.6" height="10" rx="0.8" fill="currentColor" />
            <rect x="9.4" y="3" width="2.6" height="10" rx="0.8" fill="currentColor" />
          </svg>
        {:else}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M5 2.8v10.4L13 8z" fill="currentColor" />
          </svg>
        {/if}
      </button>
      <button class="round" title="Previous frame (←)" aria-label="Previous frame" onclick={previous}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button class="round" title="Next frame (→)" aria-label="Next frame" onclick={next}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <div class="middle">
      <!-- What the narrator is saying, with the word the voice is on boxed the
           way a block read aloud in the console is. -->
      <p class="subtitle" aria-live="polite">
        {#each runs as run, at (at)}<span class:now={run.state === "now"} class:ahead={run.state === "ahead"}>{run.text}</span>{/each}
        {#if tour.subtitle}
          <button
            class="discuss"
            title="Discuss this with the agent: pauses here and attaches this frame to its composer"
            aria-label="Discuss this frame with the agent"
            onclick={discussFrame}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
            </svg>
            Discuss
          </button>
        {/if}
      </p>

      <div
        class="bar"
        bind:this={track}
        role="slider"
        tabindex="0"
        aria-label="Position in {topic.title}"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(tour.elapsed)}
        aria-valuetext="{clock(tour.elapsed)} of {clock(total)}"
        onpointerdown={grab}
        onpointermove={drag}
        onpointerup={release}
        onpointercancel={release}
        onkeydown={nudge}
      >
        <span class="track"></span>
        <span class="fill" style:width="{shown * 100}%"></span>
        {#each markers as at, n (n)}
          <span class="marker" class:passed={at <= shown} class:here={n === tour.frame} style:left="{at * 100}%"></span>
        {/each}
        <span class="thumb" class:held={dragAt !== null} style:left="{shown * 100}%"></span>
      </div>

      <div class="meta">
        <span class="time">{clock(dragAt !== null ? dragAt * total : tour.elapsed)} / {clock(total)}</span>
        <span class="topic-name" title={topic.summary}>
          <span class="which">{tour.topic + 1} of {topics.length}</span>
          {topic.title}
        </span>
      </div>
    </div>

    <button class="round close" title="Leave the tour (Esc)" aria-label="Leave the tour" onclick={leaveTour}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </button>
  </div>
{/if}

<style>
  /* Solid, like the consoles: subtitles over code are two texts in one place,
     and the code would win. */
  .player {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: var(--z-hud, 25);
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 880px;
    margin: 0 auto;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    box-shadow: 0 6px 24px color-mix(in srgb, #000 28%, transparent);
    color: var(--text);
  }
  :global(body:has(.terminal-dock.touring)) .player {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .discuss {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 10px;
    padding: 1px 8px;
    vertical-align: middle;
    font: inherit;
    font-size: 0.72em;
    color: var(--status-renamed);
    background: color-mix(in srgb, var(--status-renamed) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--status-renamed) 45%, transparent);
    border-radius: 999px;
    cursor: pointer;
  }
  .discuss:hover { background: color-mix(in srgb, var(--status-renamed) 22%, transparent); }

  .buttons {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .round {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .round:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .round:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .round.main {
    width: 36px;
    height: 36px;
    border: 0;
    background: var(--vscode-button-background, #0a84ff);
    color: var(--vscode-button-foreground, #fff);
  }
  .round.main:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background, #0a84ff)); }
  .round.close { align-self: flex-start; }

  .middle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* The console's prose, a size up: read from further away, and while the
     drawing moves behind it. */
  .subtitle {
    margin: 0;
    min-height: calc(2 * 1.5em);
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .subtitle span {
    border-radius: 3px;
    transition: background 80ms ease, box-shadow 80ms ease;
  }
  .subtitle .ahead { color: color-mix(in srgb, var(--text) 72%, transparent); }
  .subtitle .now {
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #0a84ff);
    background: color-mix(in srgb, var(--vscode-focusBorder, #0a84ff) 18%, transparent);
  }

  .bar {
    position: relative;
    height: 14px;
    cursor: pointer;
    touch-action: none;
  }
  .bar:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 4px; }
  .track,
  .fill {
    position: absolute;
    left: 0;
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 2px;
  }
  .track {
    right: 0;
    background: color-mix(in srgb, var(--text) 16%, transparent);
  }
  .fill { background: var(--vscode-focusBorder, #0a84ff); }
  .marker {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 50%;
    background: var(--panel);
    border: 1.5px solid color-mix(in srgb, var(--text) 40%, transparent);
    box-sizing: border-box;
    pointer-events: none;
  }
  .marker.passed { border-color: var(--vscode-focusBorder, #0a84ff); }
  .marker.here { background: var(--vscode-focusBorder, #0a84ff); }
  .thumb {
    position: absolute;
    top: 50%;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0;
    transition: opacity 120ms ease;
    pointer-events: none;
  }
  .bar:hover .thumb,
  .bar:focus-visible .thumb,
  .thumb.held { opacity: 1; }

  .meta {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 11px;
    color: var(--muted);
  }
  .time {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .topic-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .which {
    margin-right: 6px;
    color: var(--muted);
  }
</style>
