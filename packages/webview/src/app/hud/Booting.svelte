<!--
  The drawing assembling itself.

  What a large change used to show while it was being built was a covered
  window with a percentage on it: the same picture whether the tool was reading
  a diff, resolving a reference or painting a row. This is the same seconds
  spent saying what is actually happening — each file and each tab flies out
  from the middle to the place it belongs, in the colour of what happened to it,
  and the mark in the middle beats while there is work left.

  It draws nothing that is not true. A square leaves only when something has
  actually become ready, so a build that stalls shows a middle with nothing
  leaving it, which is exactly what is going on.
-->
<script lang="ts">
  import { ODIN_MARK } from "../../mark.js";
  import { ui } from "../state.svelte.js";
  import {
    bootDoing,
    booting,
    doing,
    driveBoot,
    flights,
    roadsDone,
    PACE,
  } from "./boot.svelte.js";

  /*
   * The clock and the frame, handed to the sequence.
   *
   * It holds the state and does the arithmetic and has no window of its own —
   * which is what lets the tests and the written document import it without
   * either of them growing an animation.
   */
  $effect(() => {
    driveBoot(
      () => performance.now(),
      (go) => requestAnimationFrame(go),
    );
  });

  /*
   * What the build says it is doing, in the build's own words.
   *
   * The host already reports its stage for the progress line — reading the
   * diff, resolving references, colouring — and saying something different
   * here would be a second account of the same seconds.
   */
  $effect(() => {
    const note = ui.note;
    if (note) bootDoing(note.toLowerCase());
  });

  const on = $derived(booting());
  const going = $derived(flights());
  const roads = $derived(roadsDone());

  /** The middle of the window, which is where everything leaves from. */
  let wide = $state(0);
  let tall = $state(0);

  $effect(() => {
    const measure = () => {
      wide = window.innerWidth;
      tall = window.innerHeight;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
</script>

{#if on}
  <div class="booting" aria-hidden="true">
    <!-- The mark, beating while there is anything left to arrive. -->
    <div class="heart">
      <span class="mark">{@html ODIN_MARK}</span>
      <span class="said">{doing()}</span>
      {#if roads.total > 0}
        <span class="roads">{roads.done} of {roads.total} roads</span>
      {/if}
    </div>

    <!--
      One square per thing on its way. Placed at the middle and moved to where
      the thing belongs: the transform is what animates, so this is the
      compositor's work rather than the layout's — two hundred of them at once
      is the ordinary case.
    -->
    {#each going as flight (flight.id)}
      <div
        class="flying {flight.kind}"
        style="
          --to-x: {flight.x + flight.width / 2 - wide / 2}px;
          --to-y: {flight.y + flight.height / 2 - tall / 2}px;
          --w: {Math.max(6, Math.min(flight.width, 260))}px;
          --h: {Math.max(6, Math.min(flight.height, 180))}px;
          --tone: {flight.tone};
          --flight: {PACE[flight.kind].flight}ms;
        "
      ></div>
    {/each}
  </div>
{/if}

<style>
  /*
   * Over the drawing and under everything that can be pressed.
   *
   * It takes no clicks at all: the page underneath is being built, the cover
   * that holds the reader off it is a separate thing with its own reasons, and
   * a decoration that swallowed a press would be a bug in both.
   */
  .booting {
    position: fixed;
    inset: 0;
    z-index: var(--z-hud, 25);
    pointer-events: none;
    overflow: hidden;
  }

  /* The mark, in the middle, beating. */
  .heart {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    transform: translate(-50%, -50%);
    color: var(--action, #007C36);
  }

  .mark {
    display: block;
    width: 72px;
    height: 72px;
    opacity: 0.9;
    animation: beat 1600ms ease-in-out infinite;
  }

  .mark :global(svg) {
    width: 100%;
    height: 100%;
  }

  @keyframes beat {
    0%, 100% { transform: scale(1); opacity: 0.55; filter: drop-shadow(0 0 0 transparent); }
    50% { transform: scale(1.08); opacity: 1; filter: drop-shadow(0 0 14px color-mix(in srgb, var(--action, #007C36) 55%, transparent)); }
  }

  .said {
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
  }

  .roads {
    color: var(--muted);
    font-size: 10px;
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
  }

  /*
   * One arrival.
   *
   * It starts as a point in the middle and ends the size and place of the
   * thing it is delivering, so what the reader sees is the drawing's own shape
   * appearing rather than a shower of identical dots.
   */
  .flying {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--w);
    height: var(--h);
    margin-left: calc(var(--w) / -2);
    margin-top: calc(var(--h) / -2);
    border-radius: 2px;
    border: 1px solid var(--tone);
    background: color-mix(in srgb, var(--tone) 22%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--tone) 35%, transparent);
    animation: arrive var(--flight) cubic-bezier(0.16, 0.84, 0.44, 1) both;
  }

  /* A tab is a place rather than a file: it takes its time, and it arrives
     square rather than growing into a card's shape. */
  .flying.tab {
    animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  @keyframes arrive {
    from {
      transform: translate(0, 0) scale(0.06);
      opacity: 0;
    }
    12% { opacity: 1; }
    to {
      transform: translate(var(--to-x), var(--to-y)) scale(1);
      opacity: 0.9;
    }
  }

  /* A reader who has asked for less movement gets the mark and the words and
     none of the flying: the sequence is a way of watching, and watching is
     exactly what they have said they do not want. */
  @media (prefers-reduced-motion: reduce) {
    .flying { display: none; }
    .mark { animation: none; }
  }
</style>
