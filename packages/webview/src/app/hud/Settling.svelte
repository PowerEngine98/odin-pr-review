<!--
  The drawing, still being worked out, with the reader held off it.

  The cards go up as soon as the diff is read and everything else arrives after:
  the arrows when the references are resolved, the parts when the arrows decide
  them, the colours a file at a time. For those seconds there is a picture that
  looks finished and is not — and a reader who starts reviewing during it is
  reading a drawing that is about to move under them, clicking rows whose
  positions are about to change, and forming an opinion of a change with a third
  of its arrows missing.

  So the page is covered rather than annotated. The cover is thin enough to see
  the drawing settle behind it — which is the honest thing to show, since that
  is what is happening — and solid enough to say plainly that it is not ready.
  It takes every press, so nothing lands on a card that is still moving.

  Only for the first build. A rebuild after a save has a picture that was
  already right and mostly still is; covering the window every time somebody
  saves a file would be the tool interrupting them to say it is keeping up.
-->
<script lang="ts">
  import { ui } from "../state.svelte.js";

  /**
   * Held one beat past the end.
   *
   * The cover fades rather than vanishing, and a fade needs the element to
   * still be there while it runs. Without this the last frame of a build is the
   * cover disappearing between one paint and the next, which reads as a flicker
   * rather than as something finishing.
   */
  let leaving = $state(false);
  let going: ReturnType<typeof setTimeout> | undefined;

  /** What the cover is doing: covering, going, or gone. */
  let covering = $state(false);

  $effect(() => {
    const wanted = ui.settling;
    if (wanted) {
      if (going) clearTimeout(going);
      going = undefined;
      covering = true;
      leaving = false;
      return;
    }
    if (!covering || leaving) return;
    leaving = true;
    going = setTimeout(() => {
      covering = false;
      leaving = false;
      going = undefined;
    }, FADE);
  });

  $effect(() => () => {
    if (going) clearTimeout(going);
  });

  /** How long the cover takes to go. Long enough to read as lifting. */
  const FADE = 420;
</script>

{#if covering}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="settling"
    class:leaving
    role="progressbar"
    aria-busy={!leaving}
    aria-valuenow={ui.at}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={ui.note}
    style="--gone:{FADE}ms"
  >
    <div class="saying">
      <span class="what">{ui.note}</span>
      <div class="track"><i style="width:{Math.max(0, Math.min(100, ui.at))}%"></i></div>
    </div>
  </div>
{/if}

<style>
  /*
   * Over everything, and taking every press.
   *
   * `pointer-events` is the whole point of it: a cover that could be clicked
   * through would be a picture of an interlock rather than one.
   */
  .settling {
    position: fixed;
    inset: 0;
    z-index: var(--z-compose, 23);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 12vh;
    /* Thin enough to watch the drawing settle behind it, which is what is
       actually happening, and solid enough that nobody mistakes it for ready. */
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(0.6px);
    cursor: progress;
    animation: settling-in 160ms ease-out both;
  }

  .settling.leaving {
    /* Lifts rather than disappearing: the drawing coming into focus is the
       thing being said, so it is worth the fifth of a second. */
    animation: settling-out var(--gone, 420ms) ease-in both;
    pointer-events: none;
  }

  @keyframes settling-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes settling-out {
    from { opacity: 1; backdrop-filter: blur(0.6px); }
    to { opacity: 0; backdrop-filter: blur(0); }
  }

  /* A reader who has asked for less movement still gets the cover; what they
     do not get is it animating in and out. */
  @media (prefers-reduced-motion: reduce) {
    .settling, .settling.leaving { animation: none; }
    .settling.leaving { opacity: 0; }
  }

  /*
   * What it says, low on the page.
   *
   * Not in the middle: the middle is where the drawing is, and the point of a
   * cover you can see through is that the reader can watch it fill in.
   */
  .saying {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 260px;
    padding: 10px 16px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    color: var(--text);
    font-size: 12px;
  }

  .what {
    letter-spacing: 0.02em;
    text-align: center;
  }

  .track {
    width: 100%;
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 14%, transparent);
    overflow: hidden;
  }

  .track > i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--action, #007C36);
    /* Long enough to read as filling rather than stepping, short enough to
       have caught up before the next number arrives. */
    transition: width 220ms ease-out;
  }
</style>
