<!--
  How far a jump through the tour went, at the edge it went towards: "+5s" on
  the right for forwards, "−5s" on the left for back. Comes in, holds a moment
  and goes, the way a video player answers a skip.
-->
<script lang="ts">
  import { tour } from "./state.svelte.js";

  function said(seconds: number): string {
    const whole = Math.abs(seconds);
    const amount = whole >= 60 ? `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, "0")}s` : `${whole}s`;
    return `${seconds > 0 ? "+" : "−"}${amount}`;
  }
</script>

{#if tour.active && tour.flash}
  {#key tour.flash.id}
    <div class="flash" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
        {#if tour.flash.playing}
          <path d="M8 5.5v13l11-6.5z" />
        {/if}
        {#if !tour.flash.playing}
          <rect x="6.5" y="5.5" width="4" height="13" rx="1" />
          <rect x="13.5" y="5.5" width="4" height="13" rx="1" />
        {/if}
      </svg>
    </div>
  {/key}
{/if}

{#if tour.active && tour.jump}
  {#key tour.jump.id}
    <div class="jump" class:back={tour.jump.seconds < 0} aria-live="polite">
      {said(tour.jump.seconds)}
    </div>
  {/key}
{/if}

<style>
  .jump {
    position: fixed;
    top: 50%;
    right: 32px;
    z-index: var(--z-hud, 25);
    pointer-events: none;
    font-size: 72px;
    font-weight: 600;
    line-height: 1;
    color: #fff;
    text-shadow: 0 2px 18px color-mix(in srgb, #000 70%, transparent);
    opacity: 0;
    animation: jump 900ms ease-out forwards;
  }
  .jump.back {
    right: auto;
    left: 32px;
  }
  @keyframes jump {
    0% { opacity: 0; transform: translateY(-50%) translateX(var(--from, 12px)); }
    18% { opacity: 1; transform: translateY(-50%) translateX(0); }
    65% { opacity: 1; transform: translateY(-50%) translateX(0); }
    100% { opacity: 0; transform: translateY(-50%) translateX(0); }
  }
  .jump.back { --from: -12px; }
  .flash {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: var(--z-hud, 25);
    pointer-events: none;
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    border-radius: 50%;
    color: #fff;
    background: color-mix(in srgb, #000 55%, transparent);
    opacity: 0;
    animation: flash 700ms ease-out forwards;
  }
  @keyframes flash {
    0% { opacity: 0.9; transform: translate(-50%, -50%) scale(0.85); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(1.35); }
  }
</style>
