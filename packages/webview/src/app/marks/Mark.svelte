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
  }: {
    root: CommentView;
    count?: number;
    left?: number;
    top?: number;
    size?: number;
    open?: boolean;
    onopen?: () => void;
  } = $props();

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

<style>
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
  .mark .bubble {
    position: absolute;
    right: calc(var(--mark-size) * -0.16);
    bottom: calc(var(--mark-size) * -0.14);
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
