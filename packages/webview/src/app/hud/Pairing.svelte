<!--
  The agents that can be paired with, and the order they take work in.

  Only ever over a live reading. A reading of the forge's copy is a picture of
  commits that are already made, in a checkout that is somebody else's — there
  is nothing here for an agent to change, and a panel offering to hand it work
  would be offering a thing that cannot happen. The switch is drawn where the
  work is.

  Order is priority, and that is the whole of the rule: a message goes to the
  first agent that is switched on and not already busy. So the list is
  reorderable, and reordering it is not decoration.
-->
<script lang="ts">
  import { untrack } from "svelte";
  /*
   * The exact module, not the package.
   *
   * `@odin/core` reaches git, spawns processes and reads the filesystem — none
   * of which exists in a browser, and importing the whole of it here drags all
   * of it into a bundle that then refuses to build. The marks are plain data
   * and the one thing in there this page has any business with.
   */
  import { markOf } from "@odin/core/agents/marks.js";
  import type { AgentView } from "../model.js";
  import { model, notify, settings, ui } from "../state.svelte.js";

  const available = $derived(model.current.agents);
  const live = $derived(model.current.meta.worktree === true);
  const folded = $derived(settings.hud.agentsFolded);

  /**
   * Asked for once per live reading, whether or not this panel is on screen.
   *
   * It used to wait for the panel, which sounds thrifty and quietly broke the
   * terminals: a reader who closed the panel and reloaded got a window where
   * nothing had ever looked for an agent, so the page knew of none, so every
   * open terminal — which is drawn for agents the page knows about — vanished
   * with it. Closing a panel is closing a panel, not switching the feature off.
   *
   * The cost is a `which` and a `--version` per known tool, once, and the host
   * remembers the answer for ten minutes across every reading in the window.
   * Asked again on nothing: what is installed does not change while a graph is
   * on screen, and a reader who has just installed something has a refresh
   * button.
   */
  let asked = $state(false);
  let asking = $state(false);

  $effect(() => {
    if (!live) return;
    if (untrack(() => asked) || untrack(() => available !== undefined)) return;
    asked = true;
    asking = true;
    notify("discoverAgents", { again: true });
  });

  // The answer, whatever it was. Read rather than assigned inside the effect
  // above, which would clear the flag in the same tick it was set.
  $effect(() => {
    if (available !== undefined) asking = false;
  });

  function refresh(): void {
    if (asking) return;
    asking = true;
    notify("discoverAgents", { again: true });
  }

  /**
   * The agents, in the order the reader put them.
   *
   * Their stored order first, then anything installed since — appended rather
   * than sorted in, because an agent arriving on the machine should not
   * silently outrank one the reader deliberately put at the top.
   */
  const ordered = $derived.by((): AgentView[] => {
    const found = available ?? [];
    const by = new Map(found.map((agent) => [agent.id, agent]));
    const kept: AgentView[] = [];
    for (const id of settings.pairing ?? []) {
      const agent = by.get(id);
      if (agent) {
        kept.push(agent);
        by.delete(id);
      }
    }
    return [...kept, ...by.values()];
  });

  const enabled = $derived(new Set(settings.pairing ?? []));

  /**
   * Switching one on is also placing it, which is why this writes the order.
   *
   * The list of enabled agents and the priority order are one thing rather than
   * two: an agent nobody enabled has no priority, and a priority for an agent
   * that is off means nothing. Keeping them apart would mean two settings that
   * can disagree, and a reader who reorders a switched-off agent watching
   * nothing happen.
   */
  function toggle(agent: AgentView): void {
    const held = [...(settings.pairing ?? [])];
    const at = held.indexOf(agent.id);
    if (at >= 0) held.splice(at, 1);
    else held.push(agent.id);
    settings.pairing = held;
  }

  /** The one being carried, so the row it came from can say so. */
  let lifted = $state<string | null>(null);

  function lift(id: string, event: DragEvent): void {
    lifted = id;
    // Some hosts refuse a drag that carries nothing at all.
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  /**
   * Where it would land, drawn on the row it would land against.
   *
   * A drag with no mark on it is a guess: the reader lets go and finds out. The
   * line says which side of this row the agent is going, and the drop below
   * uses the same answer — so what was shown is what happens.
   */
  let over = $state<{ id: string; below: boolean } | null>(null);

  function hover(id: string, event: DragEvent): void {
    event.preventDefault();
    if (!lifted || lifted === id) {
      over = null;
      return;
    }
    // Which half of the row the pointer is in, which is the whole question.
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    over = { id, below: event.clientY > box.top + box.height / 2 };
  }

  /**
   * Puts the carried agent on the side of the row the line was drawn on.
   *
   * The queue is rebuilt rather than swapped: dragging from the bottom to the
   * top should move one agent past three, not trade places with whichever
   * happened to be there.
   *
   * The target's index is read *after* the carried one has been taken out.
   * Read before, it is an index into a list that no longer exists — off by one
   * for every drag downwards, which lands the agent one place from where the
   * line said it would.
   */
  function drop(onto: string, event: DragEvent): void {
    event.preventDefault();
    const held = lifted ?? event.dataTransfer?.getData("text/plain") ?? "";
    const below = over?.id === onto ? over.below : false;
    lifted = null;
    over = null;
    if (!held || held === onto) return;

    const queue = ordered.filter((a) => enabled.has(a.id)).map((a) => a.id);
    const from = queue.indexOf(held);
    if (from < 0) return;
    queue.splice(from, 1);

    const to = queue.indexOf(onto);
    if (to < 0) return;
    queue.splice(below ? to + 1 : to, 0, held);
    settings.pairing = queue;
  }

  /** Where this one stands in the queue, or nothing if it is not in it. */
  function rank(agent: AgentView): number {
    return ordered.filter((a) => enabled.has(a.id)).findIndex((a) => a.id === agent.id);
  }

  const on = $derived(ordered.filter((a) => enabled.has(a.id)));

  /** One word for each rung, for a list too narrow to spell them out. */
  /**
   * The rung an agent is actually on.
   *
   * A tool with no word for the rung the reader chose is passed no flag for it
   * and behaves as it does by default, which is to ask. Saying otherwise here
   * would have the list claim a level the agent is not on.
   */
  function agencyOf(id: string): string {
    const wanted = settings.agency?.[id] ?? "edits";
    return (ui.rungs[id] ?? ["ask"]).includes(wanted) ? wanted : "ask";
  }

  const AGENCY_WORD: Record<string, string> = {
    read: "reads",
    ask: "asks",
    edits: "edits",
    full: "full",
  };

  /** Whose session is on screen. */
  const watching = $derived(new Set(settings.terminals ?? []));

  /**
   * Opens or closes an agent's terminal.
   *
   * Offered on every row rather than only on the switched-on ones: the reason
   * to open a terminal is usually that something did not work, and "it was
   * never given anything" is one of the things that can have gone wrong.
   */
  function watch(agent: AgentView): void {
    const held = [...(settings.terminals ?? [])];
    const at = held.indexOf(agent.id);
    if (at >= 0) held.splice(at, 1);
    else held.push(agent.id);
    settings.terminals = held;
  }
</script>

<!--
  Absent rather than empty over a reading of the forge's copy, and absent when
  the reader has dismissed it.
-->
{#if live && settings.hud.agents}
  <div class="pairing-panel" class:folded>
    <div class="pairing-head">
      AI pairing
      {#if on.length > 0}
        <span class="pairing-count">{on.length}</span>
      {/if}
      <!--
        Only once there is something to drop.

        The messages stay: those are the reader's record of what was asked and
        what was answered. What goes is the agents' own memory of how they got
        there, which is sometimes exactly what is wanted — an agent that has
        talked itself into a corner carries that corner into every turn after.
      -->
      {#if ui.carrying.size > 0}
        <button
          class="hud-close"
          title="Start over. The agents forget how they got here; the messages stay."
          aria-label="Start the agents' conversations over"
          onclick={() => notify("forgetSessions")}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M8 2.6v4.2l3 1.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M2.9 6.6A5.4 5.4 0 1 1 2.6 9.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M1.2 4.3 3 6.9l2.7-.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
      <button
        class="hud-close"
        class:asking
        disabled={asking}
        title={asking ? "Looking for agents…" : "Look again for installed agents"}
        aria-label="Look again for installed agents"
        onclick={refresh}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="hud-close"
        title={folded ? "Show the agents" : "Fold the agents away"}
        aria-label={folded ? "Show the agents" : "Fold the agents away"}
        aria-expanded={!folded}
        onclick={() => (settings.hud.agentsFolded = !folded)}
      >
        {#if folded}
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {:else}
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M4 10h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
        {/if}
      </button>
      <button
        class="hud-close"
        title="Hide the agents"
        aria-label="Hide the agents"
        onclick={() => (settings.hud.agents = false)}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    {#if !folded}
      {#if available === undefined}
        <div class="pairing-empty">Looking for installed agents…</div>
      {:else if ordered.length === 0}
        <!-- Looked, and found none. A different thing to say from "not asked
             yet", and a different thing for the reader to do about it. -->
        <div class="pairing-empty">
          No agents on this machine. Odin looks for Claude, Codex, Gemini,
          Cursor, Antigravity, opencode and Aider on your PATH.
        </div>
      {:else}
        {#each ordered as agent, index (agent.id)}
          {@const place = rank(agent)}
          {@const mark = markOf(agent.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="agent-row"
            class:on={place >= 0}
            class:lifted={lifted === agent.id}
            class:over-above={over?.id === agent.id && !over.below}
            class:over-below={over?.id === agent.id && over.below}
            role="listitem"
            ondragover={(event) => { if (place >= 0) hover(agent.id, event); }}
            ondragleave={() => { if (over?.id === agent.id) over = null; }}
            ondrop={(event) => { if (place >= 0) drop(agent.id, event); }}
          >
            <!-- The switch, first: it is what the row is for. -->
            <button
              class="switch"
              class:set={place >= 0}
              role="switch"
              aria-checked={place >= 0}
              aria-label="Pair with {agent.name}"
              title={place >= 0
                ? `${agent.name} takes work from your comments`
                : `Let ${agent.name} take work from your comments`}
              onclick={() => toggle(agent)}
            >
              <span class="knob"></span>
            </button>

            <!-- Its session, which is the log rather than the message: what an
                 agent settled on is in the thread, and this is the working-out
                 on the way there. -->
            <button
              class="hud-close watch"
              class:set={watching.has(agent.id)}
              aria-pressed={watching.has(agent.id)}
              title={watching.has(agent.id)
                ? `Close ${agent.name}'s terminal`
                : `Watch what ${agent.name} is doing`}
              aria-label="Terminal for {agent.name}"
              onclick={() => watch(agent)}
            >
              <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                <rect x="1.6" y="2.8" width="12.8" height="10.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M4.4 6.4 6.6 8l-2.2 1.6M8 10.2h3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>


            <!-- The provider's own colour, which is what actually does the
                 telling apart: a list of six grey rows is six identical rows
                 until each has been read. -->
            <svg
              class="agent-mark"
              class:off={place < 0}
              viewBox="0 0 24 24"
              width="15"
              height="15"
              aria-hidden="true"
            >
              <rect width="24" height="24" rx="12" fill={mark.color} />
              {#if mark.stroke}
                <path d={mark.path} fill="none" stroke={mark.ink} stroke-width="2" stroke-linecap="round" />
              {:else}
                <path d={mark.path} fill={mark.ink} />
              {/if}
            </svg>

            <span
              class="agent-about"
              title={agent.version || agent.name}
            >
              <!--
                The name it answers to, rather than the name it has.

                `@Claude` is what you type in a comment to send something to it,
                and it was said twice: once as a name and once as a tag at the
                far end of the row, where nothing else was. One of those is the
                thing worth knowing, so it is the one that is drawn.
              -->
              <span class="agent-name">
                @{agent.name}
              </span>
              {#if agent.version}
                <span class="agent-version">{agent.version}</span>
              {/if}
            </span>

            <!--
              What it may do, at the end of the row.

              Right-aligned so the tags line up down the list. They are the one
              thing here worth comparing between agents, and a tag that starts
              wherever the version string happened to end cannot be compared at
              a glance.
            -->
            {#if ui.rungs[agent.id]}
              {@const on = agencyOf(agent.id)}
              <span
                class="agent-agency {on}"
                title="What {agent.name} may do. Change it in its terminal."
              >{AGENCY_WORD[on]}</span>
            {/if}

            <!--
              Priority as a thing to pick up, rather than a number to nudge.

              It was a rank with an arrow either side: three controls to say one
              thing, and the number the least useful of them. What a reader
              wants is this one above that one, which is a drag.

              Only on the switched-on rows. An agent nobody enabled has no place
              in the queue, so there is nowhere to drag it to.
            -->
            {#if place >= 0}
              <span
                class="grip"
                role="button"
                tabindex="0"
                aria-label="Reorder {agent.name}"
                title="Drag to change who takes work first"
                draggable="true"
                ondragstart={(event) => lift(agent.id, event)}
                ondragover={(event) => hover(agent.id, event)}
                ondrop={(event) => drop(agent.id, event)}
                ondragend={() => { lifted = null; over = null; }}
              >
                <svg viewBox="0 0 10 16" width="9" height="12" aria-hidden="true">
                  <circle cx="3" cy="4" r="1.1" fill="currentColor" />
                  <circle cx="7" cy="4" r="1.1" fill="currentColor" />
                  <circle cx="3" cy="8" r="1.1" fill="currentColor" />
                  <circle cx="7" cy="8" r="1.1" fill="currentColor" />
                  <circle cx="3" cy="12" r="1.1" fill="currentColor" />
                  <circle cx="7" cy="12" r="1.1" fill="currentColor" />
                </svg>
              </span>
            {/if}
          </div>
          {#if index === on.length - 1 && on.length > 0 && on.length < ordered.length}
            <div class="pairing-rule"></div>
          {/if}
        {/each}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .pairing-panel {
    width: 260px;
    max-height: 34vh;
    overflow-y: auto;
    padding: 8px;
    border-radius: 6px;
    /* Solid, like the terminal and the composer: a panel of small text over
       code is unreadable the moment the code shows through it. */
    background: var(--panel);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    font-size: 11px;
  }

  /*
   * Folded, the head is the whole panel.
   *
   * The gap under it is there to separate it from the list, and with the list
   * away it is a strip of nothing along the bottom — so a box that should be
   * one line tall stands a third taller than its own contents, with the words
   * sitting above the middle of it.
   */
  .pairing-panel.folded { max-height: none; overflow: visible; }
  .pairing-panel.folded .pairing-head { padding-bottom: 0; }

  .pairing-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 6px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 10px;
  }

  .pairing-count {
    margin-left: auto;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    color: var(--added, #3fb950);
  }

  .hud-close {
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .hud-close:hover:not(:disabled) {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .hud-close:disabled {
    opacity: 0.35;
    cursor: default;
  }

  /* On the glyph rather than the button, so the hit area and the hover fill
     stay put: a target that rotates under the cursor moves while it is pressed. */
  .hud-close.asking svg {
    animation: pairing-turning 0.9s linear infinite;
  }

  .hud-close.asking {
    color: var(--text);
    cursor: default;
  }

  @keyframes pairing-turning {
    to { transform: rotate(360deg); }
  }

  .pairing-empty {
    padding: 4px 2px;
    color: var(--muted);
    line-height: 1.5;
  }

  .agent-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 2px;
    border-radius: 4px;
    color: var(--muted);
  }

  .agent-row.on { color: var(--text); }

  .agent-row:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  /* A line, not a gap: the ones above it are in the queue and the ones below
     are not, and that is the only thing separating them. */
  .pairing-rule {
    margin: 4px 2px;
    border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  }

  .switch {
    flex: 0 0 auto;
    width: 22px;
    height: 13px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: color-mix(in srgb, var(--text) 20%, transparent);
    cursor: pointer;
    transition: background 120ms ease;
  }

  .switch.set { background: var(--added, #3fb950); }

  .knob {
    display: block;
    width: 9px;
    height: 9px;
    margin: 2px;
    border-radius: 50%;
    background: var(--bg);
    transition: transform 120ms ease;
  }

  .switch.set .knob { transform: translateX(9px); }

  .agent-mark {
    flex: 0 0 auto;
    border-radius: 50%;
  }

  /* Dimmed rather than greyed. The colour is the name of the thing; draining
     it out entirely would make a switched-off agent unrecognisable, which is
     the state a reader is most likely scanning the list to find. */
  .agent-mark.off { opacity: 0.45; }

  .agent-about {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }

  .agent-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-agency {
    /* Pushed right, so the tags line up down the list rather than starting
       wherever each version string happened to end. */
    margin-left: auto;
    /*
     * Room around the word, the same as the labels in a thread.
     *
     * At `0 4px` the letters sat against the ends of the pill and it read as a
     * highlight over the text rather than as a label. The right side takes an
     * extra pixel because the letter-spacing puts a gap after the last letter
     * that the padding then doubles — without it the word looks pushed left
     * inside its own pill.
     */
    padding: 2px 7px 2px 8px;
    /* An inline box takes no vertical padding. These are laid out in a flex
       row, which makes them blocks, but the rule is worth not depending on. */
    display: inline-block;
    line-height: 1.1;
    border-radius: 7px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--muted);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* The one rung worth seeing from across the room: it hands a program the
     ability to run anything in this checkout. */
  .agent-agency.full {
    background: color-mix(in srgb, var(--warning, #e2b341) 24%, transparent);
    color: var(--warning, #e2b341);
  }

  .agent-carrying {
    color: var(--added, #3fb950);
    font-size: 13px;
    line-height: 0;
    vertical-align: middle;
  }

  .agent-version {
    color: var(--muted);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Beside the switch, at the start of the row.

     It used to be pushed to the right, which lined it up with nothing: the
     rows to its left are a switch and a name of whatever length the provider
     chose, so the button landed in a different place on every row. Next to the
     switch it is in one column down the whole list — and the two controls that
     belong together are together. */

  .watch.set {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }

  .grip {
    display: inline-flex;
    flex: 0 0 auto;
    padding: 2px 1px;
    color: var(--muted);
    cursor: grab;
  }

  .grip:hover { color: var(--text); }
  .grip:active { cursor: grabbing; }

  /* The row being carried, so it is obvious which one will land. */
  .agent-row.lifted {
    opacity: 0.5;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  /*
    Where it is going, on the row it is going against.

    Drawn inside the row rather than as a gap opened between rows: a list that
    reflows under the pointer moves the target the reader was aiming at, and
    with three rows in a small panel that is enough to make the drag feel like
    it is fighting back.
  */
  .agent-row.over-above {
    box-shadow: inset 0 2px 0 var(--action, #0a84ff);
  }

  .agent-row.over-below {
    box-shadow: inset 0 -2px 0 var(--action, #0a84ff);
  }

  .agent-place {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .agent-move {
    display: inline-flex;
    flex: 0 0 auto;
  }
</style>
