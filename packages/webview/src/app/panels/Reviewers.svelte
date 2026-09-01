<!--
  Who has said something, and where.

  Docked under the chrome on the side the canvas is least busy, because a comment
  on a change is a thing to come back to rather than a thing to find again. Two
  lists, and they answer different questions: the forge's own reviewers say who
  was asked and how far they have got, and the row of faces says who is talking
  about what is on screen right now.
-->
<script lang="ts">
  import { showRemark } from "../canvas/camera.svelte.js";
  import { sideOf } from "../marks/marks.js";
  import { saidOf } from "../pictures.js";
  import { model, settings } from "../state.svelte.js";
  import type { Conversation } from "./Thread.svelte";
  import { faceOf, initialsOf, placeOf, threadsOf } from "./Thread.svelte";

  /** Somebody asked to review the change, as the forge lists them. */
  interface Reviewer {
    login: string;
    /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, or `PENDING`. */
    state: string;
    avatarUrl?: string;
    url: string;
    team?: boolean;
  }

  let {
    reviewers = [],
    /**
     * The files currently on the canvas, by path, or null while everything is.
     *
     * Asked for rather than worked out here: which cards are showing is the
     * canvas's own answer — a part being read, tests hidden, infrastructure off,
     * a file gone quiet because it was ticked — and a second copy of that rule
     * living here would be wrong the first time one of them changed.
     */
    visible = null,
    onshow = () => {},
  }: {
    reviewers?: Reviewer[];
    visible?: Set<string> | null;
    onshow?: (thread: Conversation) => void;
  } = $props();

  const threads = $derived(threadsOf(model.current.comments ?? []));

  /**
   * The conversations about what can actually be seen.
   *
   * The whole section goes away when the part being read has no comments in it.
   * A row of faces whose every entry leads somewhere that is not on the canvas
   * is worse than no row at all: it offers a journey and then refuses to make
   * it.
   */
  /*
   * The canvas publishes node ids, because an id is what everything else in
   * the drawing is keyed by — the boxes, the arrows' endpoints, the
   * arrangement. A comment knows only the path it was left on, so the two are
   * matched through the model rather than by asking the canvas to keep a
   * second set in a second spelling that could disagree with the first.
   */
  const visiblePaths = $derived(
    visible === null
      ? null
      : new Set(
          model.current.nodes
            .filter((node) => visible.has(node.id))
            .map((node) => node.path),
        ),
  );

  const here = $derived(
    threads.filter(
      (thread) =>
        // A question about the change belongs to every view of it: there is no
        // file to be showing or not showing, and hiding it inside a part would
        // be hiding it everywhere except a place it does not live.
        !thread.root.path ||
        visiblePaths === null ||
        visiblePaths.has(thread.root.path),
    ),
  );

  /**
   * A face per person rather than per thread — a name repeated five times says
   * nothing the first one did. Replies count: somebody who answered is in the
   * conversation.
   */
  const talking = $derived.by(() => {
    const order: string[] = [];
    const counts: Record<string, number> = {};
    const first: Record<string, { author: string; avatar?: string }> = {};

    for (const thread of here) {
      for (const comment of thread.comments) {
        const who = comment.author || "?";
        if (!counts[who]) {
          counts[who] = 0;
          order.push(who);
          first[who] = comment;
        }
        counts[who]++;
      }
    }

    // Reversed, so the row reads left to right while each face still overlaps
    // the one after it rather than being overlapped by it.
    return order
      .slice()
      .reverse()
      .map((who) => ({ who, count: counts[who], comment: first[who] }));
  });

  /**
   * Pressing an entry is a journey, not a disclosure.
   *
   * The list is the one place a reader asks for a line they cannot see: the
   * thread they pick may be on a card at the far end of the change, and opening
   * the conversation without moving leaves the box floating at the edge of the
   * window with nothing on screen it could be about. So the camera goes first,
   * and the mark it lands on is what the conversation hangs off — which is the
   * marks' business, and why this says where to go and then hands the thread on
   * rather than placing anything itself.
   *
   * The flight is asked for even when the mark is already in view. It carries
   * the zoom as well as the position, and a remark read at the size a whole
   * change is fitted at is a green rectangle where the words were.
   */
  function goTo(thread: Conversation): void {
    const root = thread.root;
    showRemark(root.path, root.line, sideOf(root.side), root.wholeFile === true);
    onshow(thread);
  }

  let listing = $state(false);
  let dock = $state<HTMLElement | null>(null);

  // Anywhere outside the dock puts the list away, which is what every menu in
  // the page does. Asked of the dock as a whole rather than of each control in
  // it: the list is rebuilt whenever the view changes, and a handler bound to
  // the rows it had last time is a handler bound to nothing.
  $effect(() => {
    const away = (event: MouseEvent) => {
      if (!listing) return;
      if (dock?.contains(event.target as Node)) return;
      listing = false;
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  });

  // Nothing to list once the last thread has left the screen, and a panel that
  // stayed open over an empty canvas would be a list of journeys that no longer
  // go anywhere.
  $effect(() => {
    if (here.length === 0) listing = false;
  });

  /**
   * Under the chrome, wherever the chrome currently ends.
   *
   * Measured rather than assumed: the bar carries a pull request title that
   * wraps on a narrow window, and a constant put the faces behind it there.
   */
  let chromeHeight = $state(0);
  $effect(() => {
    const measure = () => {
      const bar = document.querySelector(".chrome");
      chromeHeight = bar ? bar.getBoundingClientRect().height : 0;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
</script>

{#snippet face(who: { author: string; avatar?: string }, kind: string)}
  {#if faceOf(who)}
    <img class={kind} src={faceOf(who)} alt={who.author} />
  {:else}
    <span class="{kind} initials">{initialsOf(who.author)}</span>
  {/if}
{/snippet}

<div class="reviewers" style="top:{chromeHeight + 14}px" bind:this={dock}>
  {#if settings.hud.reviewers && reviewers.length > 0}
    <!-- The forge's own list, in the forge's own order. A name here is a link to
         the account rather than to anything in this page: the question it
         answers is "who is this person", which this page cannot answer and the
         forge can. -->
    <div class="review-list">
      <div class="review-head">
        Reviewers
        <button
          class="hud-close"
          title="Hide the reviewers"
          aria-label="Hide the reviewers"
          onclick={() => (settings.hud.reviewers = false)}
        >
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      {#each reviewers as who (who.login)}
        <a
          class="reviewer-row"
          href={who.url}
          target="_blank"
          rel="noreferrer"
          title="Open {who.login} on the forge"
        >
          {#if who.avatarUrl}
            <img class="face" src={who.avatarUrl} alt="" />
          {:else}
            <!-- A team has no face and no profile of its own. -->
            <span class="face team">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <circle cx="5.6" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M1.8 13c0-2.1 1.7-3.4 3.8-3.4S9.4 10.9 9.4 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                <path d="M10.6 4.2a2.3 2.3 0 0 1 0 4.4M11.6 9.9c1.6.4 2.6 1.6 2.6 3.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
            </span>
          {/if}
          <span class="login">{who.login}</span>
          {#if who.state === "APPROVED"}
            <span class="state ok" title="Approved">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          {:else if who.state === "CHANGES_REQUESTED"}
            <span class="state warn" title="Changes requested">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </span>
          {:else if who.state === "PENDING"}
            <span class="state waiting" title="Waiting on this review"></span>
          {:else}
            <span class="state said" title="Commented"></span>
          {/if}
        </a>
      {/each}
    </div>
  {/if}

  {#if settings.hud.comments && here.length > 0}
    <!-- The way out sits beside the pill rather than under it: under it is where
         the list of threads opens, and a cross in that space reads as belonging
         to the thread it happens to be nearest. -->
    <div class="faces-row">
      <!-- The row is one control, so it is one control: the faces say who is
           talking and pressing any of them — or the icon, or the space between —
           opens the same list. A menu per person was five menus saying one
           thing. -->
      <div
        class="faces"
        role="button"
        tabindex="0"
        title="{here.length}{here.length === 1 ? ' thread' : ' threads'} on what is on screen"
        onclick={(event) => { event.stopPropagation(); listing = !listing; }}
        onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); listing = !listing; } }}
      >
        <!-- At the head of the row, which is its right in a row that runs
             backwards: the faces say who, the icon says what they are. -->
        <span class="speech">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2.6 3.4h10.8a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H8l-3.4 2.6V11H2.6a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
          </svg>
        </span>
        {#each talking as speaker (speaker.who)}
          {@render face(speaker.comment, "reviewer")}
        {/each}
      </div>

      <button
        class="hud-close"
        title="Hide the comments"
        aria-label="Hide the comments"
        onclick={() => (settings.hud.comments = false)}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    {#if listing}
      <!-- The list is of threads, not of messages: a thread is one place in one
           file and one thing being discussed, and splitting it into its replies
           would offer the reader five ways to arrive at the same line. -->
      <div class="reviewer-panel">
        <span class="who">{here.length}{here.length === 1 ? " thread" : " threads"}</span>
        {#each here as thread (thread.root.id)}
          <button
            class="remark-link"
            onclick={(event) => { event.stopPropagation(); listing = false; goTo(thread); }}
          >
            {@render face(thread.root, "who-face")}
            <!--
              Whether the conversation is finished with.

              A clock rather than an empty space: a hundred and eighty-five rows
              of which some carry a tick says nothing about the rest — they
              could be open, or they could be rows the tick has not been drawn
              on. Two marks, and every row wears one.
            -->
            {#if thread.root.resolved}
              <span class="settled" title="Resolved" aria-label="Resolved">
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <path d="M3.5 8.4 6.4 11.3 12.5 5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            {:else}
              <span class="waiting" title="Not resolved" aria-label="Not resolved">
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4" />
                  <path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            {/if}
            <span class="about">
              <span class="where">
                {placeOf(thread.root)}{thread.comments.length > 1
                  ? "  ·  " + (thread.comments.length - 1) +
                    (thread.comments.length - 1 === 1 ? " reply" : " replies")
                  : ""}
              </span>
              <!-- The picture a remark carries is said rather than spelled
                   out: a thread begun by a pasted screenshot had ninety
                   characters of temporary directory here, which named the
                   thread after a path nobody chose. -->
              <span class="said">{saidOf(thread.root.body).replace(/\s+/g, " ").slice(0, 90)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .reviewers {
    position: fixed;
    right: 14px;
    z-index: var(--z-hud, 25);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  /*
   * The two states a conversation can be in, said in the same place either way.
   *
   * Grey for the one that is waiting, because it is not a warning — most
   * threads on a large review are open and a row of amber would make an
   * ordinary review look like a failing one. The tick takes the colour
   * everything settled on this page takes.
   */
  .settled,
  .waiting {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 14px;
  }
  .settled { color: var(--added); }
  .waiting { color: var(--muted); opacity: 0.75; }

  .review-list {
    width: 220px;
    padding: 8px;
    border-radius: 8px;
    background: var(--panel-veil);
    backdrop-filter: blur(8px);
    border: 1px solid var(--panel-edge);
    font-size: 12px;
  }

  .review-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--muted);
    padding: 0 2px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    margin-bottom: 4px;
  }

  .reviewer-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 2px;
    color: var(--text);
    text-decoration: none;
    border-radius: 5px;
  }

  .reviewer-row:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .reviewer-row .face {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex: 0 0 auto;
    object-fit: cover;
  }

  .reviewer-row .face.team {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .reviewer-row .login {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Approved, changes asked for, spoke without a verdict, or still waiting. */
  .state {
    flex: 0 0 auto;
    display: inline-flex;
  }

  .state.ok {
    color: var(--action);
  }

  .state.warn {
    color: var(--removed);
  }

  .state.waiting,
  .state.said {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warning);
  }

  .state.said {
    background: var(--status-renamed);
  }

  /* The comments pill has no header to put its cross in, so the cross sits
     alongside it — to the right, clear of the space the thread list opens
     into. */
  .faces-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  .faces {
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    cursor: pointer;
    padding: 4px 8px 4px 4px;
    border-radius: 999px;
    background: var(--panel-veil);
    backdrop-filter: blur(8px);
    border: 1px solid var(--panel-edge);
  }

  /* Overlapped, and the one under the pointer comes forward: a row of faces is
     one object saying who is in the conversation, not five separate buttons. */
  .faces .reviewer {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    /*
     * Opaque behind the picture, not merely ringed around it.
     *
     * A face may be a PNG with transparency, and these overlap by nine pixels
     * on purpose — so wherever one is see-through, the face beneath shows
     * through the middle of it and the two read as one smeared circle. Filling
     * the element gives every avatar something of its own to sit on.
     *
     * The ring is the same colour for the same reason: the pill behind is
     * translucent over the drawing, so a border in a flat colour and a fill in
     * a blended one would put a visible edge between them. One colour, and the
     * separator is the shape rather than a difference in tone.
     */
    background-color: var(--bg);
    border: 2px solid var(--bg);
    margin-left: -9px;
    cursor: pointer;
    object-fit: cover;
    transition: transform 120ms ease;
  }

  .faces .reviewer:last-child {
    margin-left: 0;
  }

  .faces .speech {
    display: inline-flex;
    align-items: center;
    order: -1;
    margin-left: 8px;
    color: var(--muted);
  }

  .faces:hover .speech {
    color: var(--text);
  }

  .faces .reviewer:hover {
    transform: translateY(-2px) scale(1.06);
    z-index: 2;
  }

  .faces .reviewer.initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--bg);
    background: var(--status-renamed);
  }

  /* The X on each corner. Always there, quietly: a way out that only appears
     once the pointer is already inside the thing you want rid of is a way out
     you have to know about first. */
  .hud-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 120ms ease, color 120ms ease;
  }

  .reviewers:hover .hud-close {
    opacity: 1;
  }

  .hud-close:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .reviewer-panel {
    width: 320px;
    max-height: 50vh;
    overflow-y: auto;
    padding: 6px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    font-size: 12px;
  }

  .reviewer-panel .who {
    display: block;
    padding: 4px 8px 6px;
    color: var(--muted);
  }

  .remark-link {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .remark-link:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .remark-link .who-face {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex: 0 0 auto;
    object-fit: cover;
  }

  .remark-link .who-face.initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--bg);
    background: var(--status-renamed);
  }

  .about {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .where {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--status-renamed);
  }

  .said {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
