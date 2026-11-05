<!--
  A topic's title, large over the canvas while its title frame plays: the
  numeral is its place in the tour, never part of what the agent wrote. It
  leaves the way it came.
-->
<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { roman } from "@odin/core/tour/tour.js";

  import { tour } from "./state.svelte.js";

  let { top = 0 }: { top?: number } = $props();

  const topic = $derived(tour.data?.topics[tour.topic]);
  const count = $derived(tour.data?.topics.length ?? 0);
  const showing = $derived(tour.active && topic?.frames[tour.frame]?.kind === "title");

  function rise(_: Element, { duration = 420 }: { duration?: number } = {}) {
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 14}px) scale(${0.96 + t * 0.04})`,
    };
  }
</script>

{#if showing && topic}
  {#key tour.topic}
    <div class="tour-title" style:top="{top}px" aria-hidden="true" transition:rise>
      <div class="plate">
        <div class="name">
          <span class="numeral">{roman(tour.topic + 1)}:</span>
          {topic.title}
        </div>
        <div class="count">topic <span class="at">{tour.topic + 1}</span>/{count}</div>
      </div>
    </div>
  {/key}
{/if}

<style>
  .tour-title {
    position: fixed;
    left: 0;
    right: 0;
    margin-top: 18vh;
    padding: 0 48px;
    text-align: center;
    pointer-events: none;
    z-index: 30;
  }
  /* Its own ground, so the title reads over whatever code is behind it. */
  .plate {
    display: inline-block;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0.5em 0.9em 0.55em;
    border-radius: 14px;
    background: color-mix(in srgb, #3c3c3c 88%, transparent);
    border: 1px solid color-mix(in srgb, #fff 10%, transparent);
    box-shadow: 0 10px 40px color-mix(in srgb, #000 45%, transparent);
    font-size: clamp(32px, 5.2vw, 76px);
  }
  .name {
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: var(--status-renamed);
  }
  .numeral { margin-right: 0.15em; }
  .count {
    margin-top: 0.4em;
    font-size: 0.32em;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: #fff;
  }
  .count .at { color: var(--status-renamed); }
</style>
