<!--
  One conversation, as a face in the margin beside the line it is about.

  A remark is about a line but it is not part of the code, so it is not threaded
  through the diff: the mark stands out in the empty canvas to the left of the
  file, with a tail pointing back at the row, and opens the conversation when it
  is pressed. Whose face it is is the point — a reviewer scanning a change reads
  "three people have been through this file" from the margin without opening
  anything.

  It is placed by the layer rather than by itself. Where it goes is a screen
  coordinate over a canvas that moves, and a mark that measured its own position
  would be measuring it once per mark per frame.
-->
<script lang="ts">
  import type { CommentView } from "../model.js";
  import { faceOf, initialsOf, placeOf } from "../panels/Thread.svelte";
  import { hintOf } from "./marks.js";
  // The exact module, not the package: `@odin/core` reaches git and spawns
  // processes, none of which exists in a browser.
  import { avatarFor } from "@odin/core/agents/marks.js";

  const agentFace = (id: string): string => avatarFor(id);

  let {
    /** The remark that began the conversation: whose face, and where it points. */
    root,
    /** How many remarks are on it, counting the first. */
    count = 1,
    left = 0,
    top = 0,
    size = 26,
    /** This is the conversation on screen. */
    open = false,
    onopen = () => {},
    /**
     * The agent working in this conversation, and how its turn is going.
     *
     * Null for a thread with no agent in it, which is every thread on the
     * forge. Drawn below the mark rather than on it: the mark says whose
     * conversation this is, and this says who is acting in it — two facts, and
     * stacking one on the other would lose the first.
     */
    working = null,
    /**
     * Pressing the agent's face rather than the reader's.
     *
     * The same conversation either way — there is only one — but opened at the
     * end rather than the top, because somebody pressing an agent's face is
     * asking what it said.
     */
    onagent = () => {},
  }: {
    root: CommentView;
    count?: number;
    left?: number;
    top?: number;
    size?: number;
    open?: boolean;
    onopen?: () => void;
    working?: { agent: string; task: string } | null;
    onagent?: () => void;
  } = $props();

  /**
   * What each state is called and how it reads.
   *
   * Colour carries the state and the word carries the detail, so neither has to
   * be learned from the other. Amber for something in progress, blue for
   * something waiting on a person — which is a different kind of not-finished,
   * and the only one where the reader is the thing holding it up — and green
   * for done.
   */
  const SAYS: Record<string, string> = {
    queued: "waiting",
    working: "working",
    asking: "asking you",
    stopped: "stopped",
    failed: "failed",
    done: "done",
  };

  /**
   * Opening a conversation must not also be the click that closes it.
   *
   * The thread puts itself away on any click that did not land inside it, from
   * a listener on the document — which sees this one too, after the thread has
   * opened. Without this the thread appeared and vanished in the same gesture,
   * and the mark looked like a button that did nothing.
   */
  function press(event: MouseEvent): void {
    event.stopPropagation();
    onopen();
  }

  /**
   * Whether this is a turn actually running, which is the only state that moves.
   *
   * Queued counts: nothing is being done about it yet, but something is going
   * to be, and from the reader's side those are the same "come back later".
   */
  const turning = $derived(
    working?.task === "working" || working?.task === "queued",
  );

  /** The badge's own press, which must not also be the mark's. */
  function pressAgent(event: MouseEvent): void {
    event.stopPropagation();
    onagent();
  }
</script>

<button
  class="mark"
  class:is-open={open}
  style="left:{left}px;top:{top}px;--mark-size:{size}px"
  title={hintOf(root)}
  aria-label="{count === 1 ? '1 remark' : count + ' remarks'} on {placeOf(root)}"
  onclick={press}
>
  <span class="tail"></span>
  <!--
    The author's picture, or their initials when the page has none. The forge's
    own text either way: an alt attribute and a run of characters, never markup.
  -->
  {#if faceOf(root)}
    <img class="face" src={faceOf(root)} alt={root.author} />
  {:else}
    <span class="face initials">{initialsOf(root.author)}</span>
  {/if}
  {#if count > 1}
    <span class="bubble">{count}</span>
  {/if}
</button>

<!--
  Who is acting in this conversation, and what they are doing.

  Outside the mark's button on purpose: two facts, and stacking one on the other
  would lose the first. The arrow points back up at the face it belongs to,
  because at a glance the two are a sentence: this agent, on that conversation.

  The word is a report and stays one. The face is a control, because readers
  press faces — it opens the same conversation the mark does, at the end, where
  what the agent said is.
-->
{#if working}
  <div class="doing {working.task}" style="left:{left}px;top:{top}px;--mark-size:{size}px">
    <!--
      A turn in progress says so by turning, not by saying "working".

      The word and the ring are the same fact twice, and the ring is the one
      that reads at a glance and at any zoom — the word is set in a fraction of
      the mark's size and is unreadable on a drawing fitted to the window,
      which is exactly when a reader is scanning for what is happening. States
      that are not motion keep their word, because none of them can be drawn as
      one: "asking you" and "failed" are things to read.
    -->
    {#if !turning}
      <span class="says">{SAYS[working.task] ?? working.task}</span>
    {/if}
    <button
      class="agent"
      class:turning
      title={turning ? `${working.agent} is working` : `What ${working.agent} said`}
      aria-label={turning ? `${working.agent} is working` : `What ${working.agent} said`}
      onclick={pressAgent}
    >
      <img src={agentFace(working.agent)} alt="" />
      {#if turning}
        <!-- Around the face rather than beside it: one thing to look at, and it
             stays whole however small the mark is drawn. -->
        <svg class="ring" viewBox="0 0 32 32" aria-hidden="true">
          <circle class="track" cx="16" cy="16" r="14" />
          <circle class="run" cx="16" cy="16" r="14" />
        </svg>
      {/if}
    </button>
    <span class="arrow" aria-hidden="true">
      <svg viewBox="0 0 16 12" width="13" height="10">
        <path d="M1 6h11.5M9 2.2 13 6l-4 3.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  </div>
{/if}

<style>
  /*
    Under the mark, pointing back at it.

    Positioned from the same left and top the mark uses and pushed down by its
    own size, so the two move together at every zoom without the badge having to
    know anything about where the card is.
  */
  /*
    To the left of the mark, in a row, pointing at it.

    It sat underneath to begin with, which is where the next mark down is: on a
    file with several conversations the badges landed on their neighbours'
    count bubbles and the column became unreadable. Marks stack vertically and
    nothing else uses the room to their left, so that is where this goes — and
    reading right-to-left it is already a sentence: working, this agent, on that
    conversation.
  */
  .doing {
    position: fixed;
    z-index: 30;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    /* Its own width, laid out from the mark's left edge leftwards. */
    width: max-content;
    transform: translate(calc(-100% - 5px), calc(var(--mark-size) * 0.2));
    pointer-events: none;
    color: var(--warning, #e2b341);
  }

  /* The one part of the badge that takes a click. The row is transparent to
     the pointer, so the word beside it does not swallow clicks meant for the
     drawing underneath. */
  .doing .agent {
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    /*
     * The state's colour, carried into the button.
     *
     * A button does not inherit `color` — it takes the browser's own, which
     * here is near-white — and everything drawn inside this one is drawn in
     * `currentColor`: the ring around the face, and the ring the face wears
     * when the turn is over. So the badge said amber in its word and drew a
     * white circle beside it.
     */
    color: inherit;
    line-height: 0;
    pointer-events: auto;
    cursor: pointer;
  }

  .doing .agent img {
    display: block;
    width: calc(var(--mark-size) * 0.62);
    height: calc(var(--mark-size) * 0.62);
    border-radius: 50%;
    /* A ring in the state's own colour, so the face and the word agree without
       the reader having to look twice. */
    box-shadow: 0 0 0 2px currentColor;
  }

  /* While it turns, the moving ring is the ring: a static one underneath it
     reads as two rings, and the gap between them as a mistake. */
  .doing .agent.turning {
    position: relative;
    /* Room for the ring, which is drawn outside the face. */
    padding: calc(var(--mark-size) * 0.1);
  }

  .doing .agent.turning img {
    box-shadow: none;
  }

  .doing .ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* Turning the element rather than the stroke: one transform on one node,
       which the compositor can carry on its own. */
    animation: agent-turning 1.1s linear infinite;
  }

  .doing .ring circle {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
  }

  /* The whole circle, faint: without it the arc looks like a piece of something
     missing rather than a pass around a ring. */
  .doing .ring .track {
    stroke: color-mix(in srgb, currentColor 22%, transparent);
  }

  /*
   * A quarter of the way round, in the state's own colour.
   *
   * The circumference of r=14 is 88; a 22 dash on a 66 gap is one quarter lit.
   * Written as numbers rather than as a keyframe that animates the dash, so
   * nothing recomputes a path per frame.
   */
  .doing .ring .run {
    stroke: currentColor;
    stroke-dasharray: 22 66;
  }

  @keyframes agent-turning {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /*
   * Something still has to say it is running.
   *
   * A reader who has asked for less motion has not asked to be told less, so
   * the ring stops turning and stays a broken circle — which is still not the
   * whole ring a finished turn would draw.
   */
  @media (prefers-reduced-motion: reduce) {
    .doing .ring {
      animation: none;
    }
  }

  .doing .agent:hover img {
    box-shadow: 0 0 0 2px currentColor, 0 0 0 4px color-mix(in srgb, currentColor 35%, transparent);
  }

  .doing .says {
    max-width: calc(var(--mark-size) * 3.4);
    font-size: calc(var(--mark-size) * 0.3);
    line-height: 1.1;
    text-align: center;
    white-space: nowrap;
    text-shadow: 0 1px 3px var(--bg);
  }

  /* A running turn draws its ring and nothing else moves. The badge used to
     breathe as well, which with the ring is the same thing said twice and
     makes the face hard to look at. */

  @keyframes mark-breathing {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Waiting on a person is its own kind of unfinished, and the only one where
     the reader is what is holding it up. */
  .doing.asking {
    color: var(--vscode-textLink-foreground, #4aa3ff);
    animation: mark-breathing 1.6s ease-in-out infinite;
  }

  .doing.done { color: var(--added, #3fb950); }
  .doing.failed { color: var(--removed, #f85149); }
  .doing.stopped { color: var(--muted); }

  /*
    Fixed, and sized in screen pixels rather than canvas ones: the mark follows
    the card it belongs to but never shrinks with it. Everything inside is drawn
    from --mark-size, so the layer sets one number and the face, the tail and
    the bubble stay in proportion to each other at any zoom.
  */
  .mark {
    position: fixed;
    pointer-events: auto;
    --mark-size: 26px;
    width: var(--mark-size);
    height: var(--mark-size);
    /* A button for the keyboard's sake, stripped back to the face it draws:
       the reader can reach a conversation without a pointer, and the browser's
       own chrome for one would be a grey box behind a round portrait. */
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  /* A pointer back to the line, so the mark belongs to something rather than
     floating beside the card. */
  .mark .tail {
    position: absolute;
    /* Clear of the face rather than growing out of it: the two are a pointer
       and a portrait, and touching they read as one lopsided shape. */
    right: calc(var(--mark-size) * -0.5);
    top: 50%;
    width: 0;
    height: 0;
    margin-top: calc(var(--mark-size) * -0.19);
    border: calc(var(--mark-size) * 0.19) solid transparent;
    border-left-color: color-mix(in srgb, var(--text) 34%, transparent);
  }

  .mark .face {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    background: color-mix(in srgb, var(--text) 14%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--text) 34%, transparent);
    box-sizing: border-box;
  }

  /* No picture: the author's initials, which say who without pretending to be a
     photograph. */
  .mark .face.initials {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(var(--mark-size) * 0.38);
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.02em;
  }

  .mark:hover .face,
  .mark:focus-visible .face,
  .mark.is-open .face {
    border-color: var(--status-renamed);
  }

  /* How many remarks are on the thread, when there is more than one. A single
     remark says so by being one face; a number on it would be noise. */
  /*
    Under the face, not over it.

    It sat on the lower-right corner, which is on the face — and the face is the
    one thing the mark exists to show: whose conversation this is. A count is
    worth knowing second. Centred below instead, where the mark has room and
    covers nothing.
  */
  .mark .bubble {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    /* Its own height and then some, so the top edge clears the face rather
       than resting on it. */
    bottom: calc(var(--mark-size) * -0.72);
    min-width: calc(var(--mark-size) * 0.55);
    height: calc(var(--mark-size) * 0.55);
    padding: 0 calc(var(--mark-size) * 0.14);
    border-radius: 999px;
    background: var(--status-renamed);
    color: #fff;
    font-size: calc(var(--mark-size) * 0.34);
    font-weight: 700;
    line-height: calc(var(--mark-size) * 0.55);
    text-align: center;
    /* A ring of the page's own colour, so a bubble over a card border is still
       a bubble rather than part of the frame. */
    box-shadow: 0 0 0 2px var(--bg);
  }
</style>
