<!--
  The terminals that are open, stacked in the corner opposite the change list.

  A column rather than each placing itself, for the same reason the checks and
  the agents share one: two panels both measuring from the same edge sit on top
  of each other the moment either has a height that is not a guess.

  Newest at the bottom, so the one just opened is the one nearest the eye and
  the older ones ride up out of the way.
-->
<script lang="ts">
  import type { AgentView } from "../model.js";
  import { model, settings } from "../state.svelte.js";
  import Terminal from "./Terminal.svelte";

  const live = $derived(model.current.meta.worktree === true);

  /**
   * The open terminals, and only for agents that still exist.
   *
   * A terminal for something uninstalled since is a box that can never say
   * anything again. The setting keeps the id — somebody who removes a tool for
   * an afternoon should not lose their arrangement — and this drops it from the
   * screen until it is back.
   */
  const open = $derived.by((): AgentView[] => {
    const found = model.current.agents ?? [];
    return (settings.terminals ?? [])
      .map((id) => found.find((agent) => agent.id === id))
      .filter((agent): agent is AgentView => agent !== undefined);
  });

  /* ------------------------------------------------------- room to grow in */

  /**
   * How much of the window this column may have.
   *
   * It used to be the whole of it less a guess — `100vh - 140px` — which is
   * wrong in both directions. With nothing else on that side the logs ran to
   * within a few pixels of the bar and read as a wall; with the list of threads
   * open they grew straight up into it, one panel over another.
   *
   * So it is measured instead. Whatever furniture stands above this column has
   * a bottom edge, and the room is what is left under the lowest of them. Panels
   * that come and go — the threads, the checks, the agents — change the answer
   * by appearing, which is the whole point.
   */
  const GAP = 16;

  /** Nothing worth calling a log. Below this the column stops shrinking. */
  const LEAST = 160;

  /** What a folded console costs: its bar, and nothing else. */
  const BAR = 38;

  /**
   * How many logs can be open at once without any of them being a sliver.
   *
   * A second agent used to be given whatever was left after the first, which on
   * a short window is eleven pixels of log under a title nobody can read — a
   * console that is present, unreadable, and easy to mistake for a rendering
   * fault. A folded console says the same thing in a bar: this agent is here,
   * press to read it.
   *
   * The first stays open whatever happens. A column of nothing but bars would
   * be a page with no log on it at all, which is not what anybody opened.
   */
  const fits = $derived.by(() => {
    if (open.length < 2) return open.length;
    const spare = room - open.length * BAR;
    const many = Math.floor(spare / Math.max(1, LEAST - BAR));
    return Math.min(open.length, Math.max(1, many));
  });

  let dock = $state<HTMLElement | null>(null);
  let room = $state(0);

  /**
   * The lowest edge of anything standing over this column.
   *
   * Only what actually overlaps it: the map and the file list are fixed to the
   * other side of the window, and a page-wide maximum would have them pushing
   * a column they are nowhere near.
   */
  const ABOVE = ".reviewers, .checks-panel, .pairing-panel, .chrome";

  function measure(): void {
    if (!dock) return;
    const mine = dock.getBoundingClientRect();
    // Its own width even when empty of any measurable child, so the overlap
    // test means something on the first pass.
    const left = mine.width ? mine.left : window.innerWidth - 380;
    const right = mine.width ? mine.right : window.innerWidth;

    let top = 0;
    const standing = document.querySelectorAll(ABOVE);
    for (const panel of standing) {
      const box = panel.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (box.right <= left || box.left >= right) continue;
      top = Math.max(top, box.bottom);
    }
    room = Math.max(LEAST, window.innerHeight - top - GAP * 2);

    /*
     * Watched for size as well as for existence.
     *
     * A panel that is already on screen and simply grows — the list of threads
     * taking a second thread, the checks going from one line to four — moves
     * its own bottom edge without adding or removing anything. Measured once on
     * the way past, this column kept whatever room the tallest moment had left
     * it: 649 pixels of a 900-pixel window, for a list that had since shrunk
     * back to a strip.
     */
    sizes?.disconnect();
    for (const panel of standing) sizes?.observe(panel);
  }

  /** Kept across measurements: what is watched changes with what is on screen. */
  let sizes: ResizeObserver | undefined;

  $effect(() => {
    /*
     * Throttled to the end of the current beat, and it has to be: measuring
     * writes this column's height, which is a mutation and a resize, which the
     * observers below see. Answering each one as it arrives is a loop.
     */
    let soon: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      if (soon) return;
      soon = setTimeout(() => {
        soon = undefined;
        measure();
      }, 60);
    };

    sizes = new ResizeObserver(later);
    measure();

    /*
     * Panels appear and disappear without telling anybody, so the document is
     * watched rather than each of them subscribed to. Sizes are watched
     * separately, in `measure`, because a panel that grows where it stands
     * moves its bottom edge without the document changing at all.
     */
    const watch = new MutationObserver(later);
    watch.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener("resize", later);
    return () => {
      if (soon) clearTimeout(soon);
      watch.disconnect();
      sizes?.disconnect();
      sizes = undefined;
      window.removeEventListener("resize", later);
    };
  });
</script>

{#if live && open.length > 0}
  <div
    class="terminal-dock"
    bind:this={dock}
    style={room ? `max-height:${room}px` : undefined}
  >
    {#each open as agent, at (agent.id)}
      <Terminal id={agent.id} name={agent.name} cramped={at >= fits} />
    {/each}
  </div>
{/if}

<style>
  .terminal-dock {
    position: fixed;
    /* One edge, said explicitly. A fixed element given both a left and a right
       is stretched between them rather than positioned twice. */
    right: 12px;
    left: auto;
    bottom: 12px;
    /*
     * Under the rest of the furniture, deliberately.
     *
     * Every panel here sat at the same level, so the order they happen to be
     * written in decided which covered which — and the terminals, written last,
     * covered the list of threads. A log is the most background thing on this
     * page: it is left open for minutes while the reader does other things, and
     * anything they deliberately opened on top of it is the thing they are
     * looking at.
     */
    z-index: calc(var(--z-hud, 25) - 1);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    /* A floor under the measurement above, for the moment before it has run and
       for a page rendered by Node, where there is nothing to measure. Bounded
       either way, so opening a fourth terminal does not push the first off the
       top of the window with no way to reach it. */
    max-height: calc(100vh - 200px);
    overflow-y: auto;
    /* The column is as wide as a terminal and as tall as the room it has: a
       transparent strip that swallowed pans would be a drawing that will not
       move where nothing is drawn. */
    pointer-events: none;
  }

  .terminal-dock > :global(*) {
    pointer-events: auto;
  }
</style>
