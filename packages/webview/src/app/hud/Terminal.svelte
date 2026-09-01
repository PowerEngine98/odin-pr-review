<!--
  One agent's session, as it prints.

  Read-only, and that is a rule rather than an omission. Every message to an
  agent goes through the comment composer, so that every instruction it was ever
  given is in a thread somebody can audit later. A box here that accepted typing
  would be a second channel with no record of itself, and the conversation would
  stop being the whole story the moment anybody used it.

  What is shown is the log, not the message: the reply an agent settled on is in
  the thread, and this is the working-out — tool calls, warnings, and whatever
  it printed on the way past.
-->
<script lang="ts">
  import { markOf } from "@odin/core/agents/marks.js";
  import { showRemark } from "../canvas/camera.svelte.js";
  import { sideOf } from "../marks/marks.js";
  import Editor from "../panels/Editor.svelte";
  import { initialsOf, threadsOf } from "../panels/Thread.svelte";
  import { model, notify, settings, ui } from "../state.svelte.js";
  import { showPicture } from "./picture.svelte.js";

  let { id, name }: { id: string; name: string } = $props();

  const mark = markOf(id);

  /**
   * How long the log may lag the process.
   *
   * Long enough that a burst of output is one redraw rather than fifty, short
   * enough that it still reads as watching something happen.
   */
  const SETTLE = 250;
  const text = $derived(ui.transcripts[id] ?? "");

  /**
   * The transcript as the reader sees it, a few times a second rather than a
   * few hundred.
   *
   * What draws this is the same component that draws a comment: markdown, with
   * fenced code sent to the host to be coloured by the grammars the cards are
   * drawn with. That is what makes an agent's output readable — these tools
   * write markdown, and a wall of asterisks and backticks is what it looks like
   * unparsed.
   *
   * It is also why this cannot follow the stream directly. Every chunk that
   * arrives would re-parse the whole log and ask the host to colour every code
   * block in it again, and chunks arrive by the hundred. A trailing beat costs
   * a fifth of a second of freshness on a log that takes minutes.
   */
  let shown = $state("");
  let settling: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const latest = text;
    if (settling) return;
    // The first chunk lands immediately; the ones behind it wait for the beat.
    if (shown === "") {
      shown = latest;
      return;
    }
    settling = setTimeout(() => {
      settling = undefined;
      shown = ui.transcripts[id] ?? "";
    }, SETTLE);
  });

  $effect(() => () => {
    if (settling) clearTimeout(settling);
  });
  const working = $derived(ui.busyAgents.has(id));

  /**
   * What is written and waiting, as far as this terminal is concerned.
   *
   * A message addressed to an agent can only be taken by that agent, so it
   * belongs in that agent's terminal and nowhere else. One addressed to nobody
   * goes to whoever is free first, which is not knowable until it happens — so
   * it is shown in every terminal, because every one of them might be the one
   * that takes it. Showing it in none was the state before this, and the reader
   * had nowhere at all to see that four questions were stacked up behind the
   * one they were watching.
   */
  const waiting = $derived(
    ui.queued.filter((ask) => ask.addressee === undefined || ask.addressee === id),
  );

  /** The first line of an ask, which is what a queued row has room for. */
  function gist(body: string): string {
    const line = body.split("\n").find((one) => one.trim() !== "") ?? "";
    return line.trim();
  }

  /**
   * The session so far, asked for once when the terminal appears.
   *
   * A terminal opened halfway through a turn — or after a window reload — has
   * whatever streamed in since it opened, which is the middle of a sentence.
   * The host has the whole of it.
   */
  let asked = $state(false);
  $effect(() => {
    if (asked) return;
    asked = true;
    notify("agentTranscript", { agent: id });
  });

  /**
   * Following the output, unless the reader has scrolled away from it.
   *
   * A log that jumps to the bottom while somebody is reading further up is a
   * log that cannot be read at all — which is the state it is in for exactly as
   * long as the turn it is showing, and that is the whole time anybody wants to
   * look at it.
   */
  let pane = $state<HTMLElement | null>(null);
  let following = $state(true);

  function scrolled(): void {
    if (!pane) return;
    const room = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
    following = room < 24;
  }

  $effect(() => {
    // Read so the effect runs when more is drawn. What matters here is what
    // the box actually holds, which is the settled copy rather than the stream.
    shown.length;
    if (!pane || !following) return;

    /*
     * Straight away, and not inside an animation frame.
     *
     * An effect already runs after the document has been updated, so the box
     * is its full height by the time this reads it. Deferring to a frame looked
     * more careful and was less reliable: a frame is only guaranteed before a
     * paint, and a view nobody is looking at — a hidden tab, a window behind
     * another — may not paint for minutes. The log then sat wherever it was
     * when the reader last looked at it, which is indistinguishable from an
     * agent that has stopped printing.
     */
    pane.scrollTop = pane.scrollHeight;
  });

  /**
   * How much this agent may do without being asked.
   *
   * Per agent, and here rather than in the list, because this is the window
   * where somebody is watching what it actually does — which is the moment the
   * question "should it be allowed to do that" comes up.
   */
  const LADDER: { level: string; label: string; why: string }[] = [
    { level: "read", label: "Read", why: "Looks and reports. Changes nothing." },
    { level: "ask", label: "Ask", why: "Stops for approval — which has nowhere to go here." },
    { level: "edits", label: "Edit", why: "Writes files in this checkout. Asks before running commands." },
    { level: "full", label: "Full", why: "Writes files and runs commands. No sandbox, no confirmation." },
  ];

  /** Only the rungs this tool has a word for. */
  const rungs = $derived(new Set(ui.rungs[id] ?? ["ask"]));
  const wanted = $derived(settings.agency?.[id] ?? "edits");

  /**
   * What this agent is actually on, which is not always what was asked for.
   *
   * A tool with no word for a rung is passed no flag for it and behaves as it
   * does by default, which is to ask. Showing the asked-for rung as though it
   * had taken would be a control that reads as set and is not — and the whole
   * reason this is per agent is that the tools differ.
   */
  const level = $derived(rungs.has(wanted) ? wanted : "ask");

  function allow(next: string): void {
    settings.agency = { ...(settings.agency ?? {}), [id]: next as never };
  }

  /** The conversation this agent is carrying here, when it is carrying one. */
  const conversation = $derived(ui.sessions[id] ?? "");
  const named = $derived(ui.labels[id] ?? "");

  /** Renaming, which is Odin's name for it rather than the tool's. */
  let renaming = $state(false);
  let draft = $state("");

  function startRename(): void {
    draft = named;
    renaming = true;
  }

  function commit(): void {
    renaming = false;
    notify("renameSession", { agent: id, name: draft });
  }

  /* ---------------------------------------------------- asking about it all */

  /**
   * A question with no line under it.
   *
   * Architecture, naming, where a thing belongs, whether two files should be
   * one: real questions about a change that no passage in it is the right place
   * for. This is the box for those, and it does exactly what a comment does —
   * the text is written into the conversation as a remark first, and the agent
   * is handed the remark. Nothing reaches an agent that is not in the record.
   */
  let prompt = $state("");

  /**
   * The box is as tall as what is written in it.
   *
   * It was one row with a cap, which is two different failures at once: a
   * question of three lines was read through a slot two lines high, and the
   * slot scrolled — so the line somebody was in the middle of typing sat half
   * cut off against the top edge. A textarea has no opinion about its own
   * content height, so it is measured and set.
   *
   * Reset to `auto` before measuring, because `scrollHeight` on an element with
   * a height already set is that height, not the height it needs: without it
   * the box grows and never shrinks again.
   */
  const TALLEST = 132;
  let askBox = $state<HTMLTextAreaElement | null>(null);

  function grow(): void {
    const box = askBox;
    if (!box) return;
    box.style.height = "auto";
    /*
     * The content, plus the border the content is measured without.
     *
     * `scrollHeight` is the padding box: it counts the text and the padding and
     * stops at the border. The box is `border-box`, so a height taken straight
     * from it is two pixels short of holding what it was measured from — and a
     * box two pixels short of its own content scrolls, which puts a line half
     * behind the top edge exactly as somebody is typing it. Measured: `clipped`
     * went from 2 at every size to 0.
     *
     * Rounded up for the same reason: a fractional height leaves the last line
     * a fraction short, and the browser makes that up by scrolling.
     */
    const edges = box.offsetHeight - box.clientHeight;
    const needed = Math.ceil(box.scrollHeight) + edges;
    box.style.height = `${Math.min(needed, TALLEST)}px`;
    // Past the cap it scrolls, and only then: a box that always scrolls hides
    // the first line of everything ever written in it.
    box.style.overflowY = needed > TALLEST ? "auto" : "hidden";
  }

  // Sizes on every change of the text, including the one that empties it after
  // a message is sent — a box left three lines tall with nothing in it reads as
  // a box that has swallowed something.
  $effect(() => {
    prompt;
    grow();
  });

  /**
   * Pictures on their way to the agent, shown while they are on their way.
   *
   * A screenshot is the fastest way to say what is wrong with something drawn
   * — a layout that is off, a chart that is unreadable, an error dialog — and
   * every one of these tools can look at one. Pasting into the box did nothing
   * at all before this: a textarea takes the text on the clipboard and drops
   * the rest without a word, so the reader pasted, saw an empty box, and had
   * no way to tell whether it had failed or whether nothing had been copied.
   *
   * Held as data URIs because that is what the page can draw. They travel to
   * the host on send and become files there, since an agent takes a path.
   */
  let pasted = $state<{ id: number; url: string; name: string }[]>([]);
  let nextImage = 0;

  function paste(event: ClipboardEvent): void {
    const items = [...(event.clipboardData?.items ?? [])].filter((item) =>
      item.type.startsWith("image/"),
    );
    if (items.length === 0) return;
    // Only when there is actually an image: a paste carrying text as well —
    // which is what copying from a browser gives you — must still paste the
    // text.
    event.preventDefault();

    for (const item of items) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result ?? "");
        if (!url.startsWith("data:image/")) return;
        pasted = [...pasted, { id: ++nextImage, url, name: file.name || "pasted" }];
      };
      reader.readAsDataURL(file);
    }
  }

  /** Named for what it does to the picture, not the pointer: `drop` is taken
      by the end of a resize drag, a few hundred lines down. */
  function unpaste(id: number): void {
    pasted = pasted.filter((one) => one.id !== id);
  }

  function send(): void {
    const said = prompt.trim();
    // A picture on its own is a message: "look at this" is the whole of what a
    // reader usually means by pasting one.
    if (!said && pasted.length === 0) return;
    const images = pasted.map((one) => ({ name: one.name, data: one.url }));
    pasted = [];
    prompt = "";
    /*
     * No path and no line, and addressed to this agent.
     *
     * The address is the box itself: somebody typing into Claude's terminal is
     * talking to Claude, and writing `@Codex` in the text still overrules it —
     * that is the reader saying so in as many words, and the words win.
     */
    notify("askAgents", {
      body: said,
      to: id,
      ...(images.length > 0 ? { images } : {}),
    });
  }

  /* ------------------------------------------------------------ its size */

  /**
   * How much room a log needs, which is not something to decide for somebody.
   *
   * The box is anchored to the bottom right, so the two edges that face the
   * drawing are the ones that move: pulling the left edge left widens it,
   * pulling the top edge up makes it taller. The other two are against the
   * window and have nothing to give.
   *
   * One size for every terminal, because they stack in a column against one
   * edge and differing widths would be a ragged line down the side of the
   * picture.
   */
  const LEAST = { width: 240, height: 140 };

  let dragging = $state<{
    edge: "left" | "top" | "corner";
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  function grab(edge: "left" | "top" | "corner", event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging = {
      edge,
      x: event.clientX,
      y: event.clientY,
      width: settings.terminalWidth ?? 360,
      height: settings.terminalHeight ?? 320,
    };
  }

  function drag(event: PointerEvent): void {
    if (!dragging) return;
    const held = dragging;
    // Away from the anchored corner is bigger, which is why both are negated:
    // the box grows leftwards and upwards because it is pinned bottom-right.
    if (held.edge !== "top") {
      settings.terminalWidth = Math.max(
        LEAST.width,
        Math.min(held.width - (event.clientX - held.x), Math.round(window.innerWidth * 0.8)),
      );
    }
    if (held.edge !== "left") {
      settings.terminalHeight = Math.max(
        LEAST.height,
        Math.min(held.height - (event.clientY - held.y), Math.round(window.innerHeight * 0.9)),
      );
    }
  }

  function drop(event: PointerEvent): void {
    if (!dragging) return;
    dragging = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /**
   * The log, split into what the agent said and what Odin noted.
   *
   * Odin's own lines — the invocation, a conversation that could not be
   * resumed — were going through the markdown renderer along with everything
   * else, and markdown joins adjacent lines into one paragraph. So a note
   * landed mid-sentence in the agent's prose, in the same weight and the same
   * colour, reading as something the agent had said.
   *
   * Kept in order and kept in the log: they are the answer to "what was this
   * actually run with", which is the question they exist for. They are simply
   * not the agent talking, and are not drawn as though they were.
   */
  const ASKED = /^\[odin:ask (-?\d+)\] ?/;

  /**
   * The agent working, as opposed to the agent answering.
   *
   * Two marks, both put there by the reader of the stream: `…` for what it was
   * thinking and `→` for a tool it called. Everything else on standard output
   * is the agent talking.
   */
  const WORKING = /^\s*(…|→) /;

  const blocks = $derived.by(() => {
    const out: {
      kind: "note" | "asked" | "said" | "work";
      text: string;
      thread?: number;
    }[] = [];
    for (const line of shown.split("\n")) {
      const asked = ASKED.exec(line);
      const kind = asked
        ? "asked"
        : line.startsWith("[odin]")
          ? "note"
          : WORKING.test(line)
            ? "work"
            : "said";
      const text = asked ? line.slice(asked[0].length) : line;
      const thread = asked ? Number(asked[1]) : undefined;

      const last = out[out.length - 1];
      if (last && last.kind === kind && last.thread === thread) {
        last.text += `\n${text}`;
      } else {
        out.push({ kind, text, ...(thread !== undefined ? { thread } : {}) });
      }
    }
    return out
      // An invocation Odin used to write into the log. The host takes these out
      // on the way in now, but a page can be older than the host it is talking
      // to, and a line of flags in the middle of a conversation is noise either
      // way.
      .filter((block) => !(block.kind === "note" && /^\[odin\] \S+ --/m.test(block.text)))
      .filter((block) => block.text.trim().length > 0);
  });

  /**
   * Back to the conversation this came from.
   *
   * Two halves, and I had only written the second. Naming the thread opens it
   * where its mark already is; the camera has to be asked separately to go
   * there, which is exactly what the list of threads does before it names one.
   * Without the flight, pressing a question in a log about a file on the far
   * side of the drawing opened a conversation nobody could see.
   *
   * The flight first, so the panel waits for it to land and appears where the
   * mark finally is rather than where it was as the drawing set off.
   */
  /** Who wrote the remark this block is quoting, and their face. */
  function asker(thread: number | undefined): { name: string; avatar: string } {
    const root = (model.current.comments ?? []).find(
      (comment) => Number(comment.id) === thread,
    );
    return {
      name: root?.author || model.current.viewer || "",
      avatar: root?.avatar || model.current.viewerFace || "",
    };
  }

  /** The remark a block is quoting, if the page still holds it. */
  function remarkOf(thread: number | undefined) {
    return (model.current.comments ?? []).find(
      (comment) => Number(comment.id) === thread,
    );
  }

  /**
   * Whether the turn this question asked for ever finished.
   *
   * `stopped` is something ending it from outside — the window went away
   * mid-turn. `failed` is the tool coming back with nothing. Both leave a
   * question standing with no answer under it, which is the only state here
   * worth offering to do something about.
   */
  function unfinished(thread: number | undefined): boolean {
    const task = remarkOf(thread)?.task;
    return task === "stopped" || task === "failed";
  }

  /**
   * Asks it again, as a new remark rather than by rerunning the old one.
   *
   * The thread is the record: a question asked twice was asked twice, and a
   * silent re-run would leave a conversation where an answer appeared under a
   * question that had already been marked as having failed to get one.
   */
  function again(thread: number | undefined): void {
    const root = remarkOf(thread);
    if (!root) return;
    notify("askAgents", {
      path: root.path,
      line: root.line,
      ...(root.startLine !== undefined && root.startLine < root.line
        ? { startLine: root.startLine }
        : {}),
      side: root.side,
      body: root.body,
      inReplyTo: Number(root.id),
    });
  }

  /**
   * Back to the conversation a line of the log came from.
   *
   * What is opened is the conversation, not the remark: a log writes the id of
   * the message it was given, which is often a reply somebody added to a thread
   * that started further up. The mark in the margin belongs to the root, and
   * the mark is what the panel hangs off.
   *
   * That is also where this was wrong. The id arrives from `[odin:ask -1]` as a
   * number and went into the page's "which conversation is open" slot as one,
   * while the mark holds the id the host sent — so `one.id === thread.id` was
   * comparing a number against whatever the host's id happens to be, the mark
   * never handed over its rectangle, and a conversation without a rectangle
   * does not open. The camera flew to the line and nothing appeared.
   *
   * Taking the id off the thread's own root means it is the same value by
   * construction, whatever its type.
   */
  function goTo(asked: number): void {
    const conversation = threadsOf(model.current.comments ?? []).find((one) =>
      one.comments.some((comment) => Number(comment.id) === asked),
    );
    if (!conversation) return;

    const root = conversation.root;
    showRemark(root.path, root.line, sideOf(root.side), root.wholeFile === true);
    ui.thread = { id: root.id, anchor: null };
  }

  /**
   * Folded to its head, rather than closed.
   *
   * Closing throws away the one thing worth keeping: that this agent is here,
   * what it may do, and what its conversation is called. A reader reading the
   * code an agent is changing wants all of that and none of the log.
   */
  const folded = $derived((settings.terminalsFolded ?? []).includes(id));

  function fold(): void {
    const held = [...(settings.terminalsFolded ?? [])];
    const at = held.indexOf(id);
    if (at >= 0) held.splice(at, 1);
    else held.push(id);
    settings.terminalsFolded = held;
  }

  function close(): void {
    settings.terminals = (settings.terminals ?? []).filter((held) => held !== id);
  }
</script>

<div
  class="terminal"
  class:sizing={dragging !== null}
  class:folded
  style="width:{settings.terminalWidth ?? 360}px;max-height:{settings.terminalHeight ?? 320}px"
>
  <!--
    The two edges that face the drawing. The other two are against the window
    and have nothing to give.

    Wider than they look: an edge exactly as wide as its own line is a target
    nobody can hit, so each strip reaches a few pixels either side of the
    border it draws.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="grip left"
    onpointerdown={(event) => grab("left", event)}
    onpointermove={drag}
    onpointerup={drop}
    onpointercancel={drop}
  ></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="grip top"
    onpointerdown={(event) => grab("top", event)}
    onpointermove={drag}
    onpointerup={drop}
    onpointercancel={drop}
  ></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="grip corner"
    onpointerdown={(event) => grab("corner", event)}
    onpointermove={drag}
    onpointerup={drop}
    onpointercancel={drop}
  ></div>

  <!--
    Folded, the whole bar opens it.

    All that is left on screen is this strip, so it is what a reader aims at —
    and asking them to find a ten-pixel chevron on it to get their log back is
    a target the size of the thing itself, minus everything else.

    Only while it is folded. Open, the bar carries a name that can be renamed
    and buttons that mean other things, and a click anywhere on it collapsing
    the log would be a trap.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="terminal-head"
    class:pressable={folded}
    onclick={(event) => {
      if (!folded) return;
      // The controls on the bar are their own presses — the cross especially,
      // which would otherwise close and reopen in one gesture.
      if ((event.target as Element).closest?.("button, input")) return;
      fold();
    }}
  >
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <rect width="24" height="24" rx="12" fill={mark.color} />
      {#if mark.stroke}
        <path d={mark.path} fill="none" stroke={mark.ink} stroke-width="2" stroke-linecap="round" />
      {:else}
        <path d={mark.path} fill={mark.ink} />
      {/if}
    </svg>
    <span class="terminal-name">{name}</span>
    {#if named && !renaming}
      <span class="terminal-label" title="What you call this conversation">{named}</span>
    {/if}
    <!--
      Everything after this goes to the far end.

      The controls used to be pushed right by whichever badge happened to be
      there — so with no turn running and nothing to follow, the minimize and
      close buttons sat against the conversation's name in the middle of the
      bar, moving every time an agent started or stopped.
    -->
    <span class="head-gap"></span>

    {#if working}
      <span class="terminal-state">working</span>
    {/if}
    {#if !following}
      <!-- Only while it is actually behind. A button offering to do what is
           already happening teaches nothing. -->
      <button
        class="terminal-follow"
        title="Follow the output again"
        onclick={() => {
          following = true;
          if (pane) pane.scrollTop = pane.scrollHeight;
        }}
      >follow</button>
    {/if}
    <!-- Before the cross, and the cross stays last: the one that ends things is
         the one that should be hardest to hit by accident. -->
    <button
      class="terminal-close"
      title={folded ? "Show the log" : "Fold the log away"}
      aria-label={folded ? "Show the log" : "Fold the log away"}
      aria-expanded={!folded}
      onclick={fold}
    >
      {#if folded}
        <!-- Up, because a chevron says where the press goes and not where the
             box currently is. Folded, the press opens the log upwards; pointing
             down at a bar with nothing under it read as "there is more below",
             and there is nothing below. -->
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4 10 8 6 12 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4 10h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
      {/if}
    </button>
    <button
      class="terminal-close"
      title="Close {name}'s terminal"
      aria-label="Close {name}'s terminal"
      onclick={close}
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </button>
  </div>

  {#if !folded}
  <!--
    What this agent is allowed, and what its conversation is called.

    Under the head rather than in it: the head is a name and the controls that
    close things, and a row of switches wedged into it made both hard to find.
  -->
  <div class="terminal-bar">
    <span class="rungs" role="group" aria-label="What {name} may do">
      {#each LADDER as rung}
        {#if rungs.has(rung.level)}
          <button
            class="rung"
            class:set={level === rung.level}
            class:loud={rung.level === "full" && level === "full"}
            aria-pressed={level === rung.level}
            title={rung.why}
            onclick={() => allow(rung.level)}
          >{rung.label}</button>
        {/if}
      {/each}
    </span>

    {#if conversation}
      <!-- Odin's name for the conversation, not the tool's: a tool that lets a
           session be named takes that name when the session is made and cannot
           change it after, so a rename that had to reach the tool would work
           exactly once. -->
      <button
        class="terminal-act"
        title={named ? "Rename this conversation" : "Name this conversation"}
        aria-label="Name this conversation"
        onclick={startRename}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M11.4 2.6a1.6 1.6 0 0 1 2.3 2.3L6 12.5l-3 .7.7-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="terminal-act"
        title="Copy the conversation id — {conversation}"
        aria-label="Copy the conversation id"
        onclick={() => notify("copySession", { agent: id })}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d="M10.6 3.4A1.5 1.5 0 0 0 9.1 2.4H3.9a1.5 1.5 0 0 0-1.5 1.5v5.2a1.5 1.5 0 0 0 1 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    {/if}
  </div>

  {#if renaming}
    <!-- A name rather than an instruction: it never leaves this side and no
         agent is ever shown it. -->
    <div class="terminal-rename">
      <input
        class="rename-box"
        value={draft}
        placeholder="What to call this conversation"
        oninput={(event) => (draft = event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") renaming = false;
        }}
      />
      <button class="terminal-act" title="Save" aria-label="Save the name" onclick={commit}>done</button>
    </div>
  {/if}

  <!--
    The same decision, where the reader is already watching.

    Answering here and answering in the thread are the same act — the thread
    keeps the record either way. Both exist because the moment a permission
    question matters is the moment somebody is staring at the log wondering why
    nothing is happening.
  -->
  {#each ui.pending as asked (asked.id)}
    <div class="asked">
      <span class="asked-what">May I {asked.what}?</span>
      <button class="approve" onclick={() => notify("answerApproval", { id: asked.id, allow: true })}>Allow</button>
      <button class="refuse" onclick={() => notify("answerApproval", { id: asked.id, allow: false })}>Deny</button>
    </div>
  {/each}

  <!--
    Drawn by the same component that draws a comment, and safe for the same
    reason: it parses markdown into elements and prints every leaf as text, so
    nothing an agent writes can become markup in this page. There is no `@html`
    anywhere under it — an agent quoting markup out of the branch it is reading
    stays quoted.

    Which also buys the colours. A fenced block goes to the host and comes back
    tokenised by the grammars the cards are drawn with, so SQL an agent quotes
    at you looks like the SQL in the file beside it.
  -->
  <div class="terminal-body" bind:this={pane} onscroll={scrolled}>
    {#if shown}
      {#each blocks as block, at (at)}
        {#if block.kind === "note"}
          <p class="note">{block.text}</p>
        {:else if block.kind === "work"}
          <!--
            The working-out: what it was thinking, and what it ran.

            Drawn as a machine's own record rather than as prose — dim,
            monospace, against a rail. It was rendered as markdown beside the
            answer, in the same face at the same size, so a page of a turn read
            as one long statement in which "Bash(cd /Users/…)" was a sentence.
            The two are not the same kind of thing: one is how it got there and
            the other is what it says.

            Deliberately not rendered as markdown. This is a transcript of
            commands and half-formed reasoning; passing it through a parser
            turns an underscore in a path into emphasis.
          -->
          <div class="work">
            {#each block.text.split("\n") as line, n (n)}
              <p class="step">{line.replace(/^\s*/, "")}</p>
            {/each}
          </div>
        {:else if block.kind === "asked"}
          {@const wrote = asker(block.thread)}
          <!--
            What the reader asked, with their face on it.

            A log that opens with an invocation and runs to eight paragraphs of
            answer is missing the question — and the question is the one thing
            in it they wrote. Pressing it goes back to the conversation, the way
            pressing a row in the list of threads does.
          -->
          <!--
            The question and what to do about it, on one line.

            The retry used to hang below the quote as a row of its own, which
            read as a third thing in the log rather than as part of the
            question — and left a gap under every unfinished turn. It belongs
            to the ask, so it sits in the ask's row, against the far end.
          -->
          <div class="ask-row">
          <!--
            The rail says how the turn went.

            Blue-green is Odin's "this is a thing you can press" colour and it
            was on every question in the log, finished or not — so a turn that
            was stopped halfway looked exactly like one that answered. Red for a
            turn that never finished, which is the state a reader is scanning a
            log to find.
          -->
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <div
            class="quoted"
            class:unfinished={unfinished(block.thread)}
            role="button"
            tabindex="0"
            title="Go to this conversation"
            onkeydown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (block.thread !== undefined) goTo(block.thread);
            }}
            onclick={(event) => {
              /*
               * Opening a conversation must not also be the click that closes
               * it. The page puts an open thread away on any click that did not
               * land inside it, from a listener on the document — which sees
               * this one too, a moment after the thread has opened. Without
               * this the panel appeared and vanished inside one gesture, and
               * pressing a question in the log looked like a button that flew
               * the camera somewhere and did nothing else.
               */
              event.stopPropagation();
              if (block.thread !== undefined) goTo(block.thread);
            }}
          >
            <!--
              Whoever asked, and something recognisable when the forge has not
              said who that is. An empty grey circle reads as an image that
              failed rather than as a person without a picture.
            -->
            <!--
              The face the remark itself carries, before the page's idea of who
              is reading. They are usually the same, and when they are not the
              remark is right: it was signed when it was written, and the page's
              copy is whatever the forge had last said by the time it was built.
            -->
            {#if wrote.avatar}
              <img class="quoted-face" src={wrote.avatar} alt={wrote.name} />
            {:else if wrote.name}
              <span class="quoted-face initials">{initialsOf(wrote.name)}</span>
            {:else}
              <span class="quoted-face initials" title="You">
                <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                  <circle cx="8" cy="5.4" r="2.8" fill="currentColor" />
                  <path d="M2.6 14.2a5.4 5.4 0 0 1 10.8 0z" fill="currentColor" />
                </svg>
              </span>
            {/if}
            <!--
              Drawn the way the composer draws it, rather than as the markdown
              it is written in.

              A question that carries a suggestion is mostly the suggestion, and
              in a log it arrived as a fenced block with the backticks showing —
              the one thing in the conversation the reader is most likely to be
              checking, printed as source. Same renderer as the answer below it
              and as the preview the reader wrote it in, so a suggestion looks
              like a change everywhere it appears.
            -->
            <div class="quoted-what"><Editor readonly value={block.text} /></div>
          </div>
          <!--
            A turn that never finished.

            Stopped means something ended it from outside — the window went
            away mid-turn, or the reading was closed. Failed means the tool
            came back with nothing. Either way the question still stands and
            the conversation is intact, so asking again carries on from where
            it stopped rather than starting over.
          -->
          <!--
            The mark alone, with the words in the tooltip.

            A log is narrow and its questions are long; a button spelling "Ask
            again" beside one took a third of the row and pushed the question
            into a second line. The same circle-and-arrow every tool uses for
            "go round again" says it in eleven pixels, and what it does in full
            is a hover away.
          -->
          {#if unfinished(block.thread)}
            <button
              class="quoted-again"
              title="Ask again. The conversation is intact, so this carries on from where it stopped."
              aria-label="Ask again"
              onclick={() => again(block.thread)}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          {/if}
          </div>
        {:else}
          <Editor readonly value={block.text} />
        {/if}
      {/each}
      <!--
        Something is still happening, said at the end of the log where the next
        line will appear.

        Without it a turn that has printed its first line and is thinking looks
        exactly like a turn that has stopped — the log is a page of text either
        way, and the only difference is whether anything more is coming.
      -->
      {#if working}
        <p class="still">
          <span class="caret"></span>
          <span class="still-what">working</span>
        </p>
      {/if}
      {@render queue()}
    {:else}
      <!--
        Three different nothings, said as three different things.

        A conversation with no log is not the same as no conversation, and
        telling a reader "ask something from a comment" when they already have
        is how a tool teaches them not to read it.
      -->
      {@render queue()}
      <p class="terminal-empty">
        {#if working}
          Starting…
        {:else if ui.carrying.has(id)}
          This conversation carries on from earlier, but nothing of that session
          was written down. Whatever happens next will be.
        {:else}
          Nothing yet. Ask about a line from its comment, or about the change
          from the box below.
        {/if}
      </p>
    {/if}
  </div>

  <!--
    A question about the change rather than about a line.

    Everything else an agent is told is written against a passage, which is
    right for "this loop is wrong" and impossible for "these two files should be
    one" — the question is about the shape of the thing, and there is no line to
    hang it off. Those went unasked, or were smuggled into a remark on a line
    that had nothing to do with them.

    It is not a second channel. What is typed here becomes a remark in the
    conversation before any agent sees it, exactly as a comment does: same
    record, same thread, same audit. What it lacks is a file and a line, so it
    leaves no mark in any margin — which is the truth about it.
  -->
  <form
    class="terminal-ask"
    onsubmit={(event) => {
      event.preventDefault();
      send();
    }}
  >
    <!--
      What has been pasted and not yet sent.

      The picture itself rather than a filename, because the reader is checking
      that the right thing is on its way — half the time a clipboard holds the
      screenshot before last, and a chip saying "pasted.png" cannot tell them
      that. Above the box, where an attachment goes, and gone the moment it is
      sent.
    -->
    {#if pasted.length > 0}
      <ul class="pasted">
        {#each pasted as image (image.id)}
          <li>
            <!-- The thumbnail is a button: it is a hundred pixels of a
                 screenshot, and checking that the right thing is on its way is
                 exactly what it is for. -->
            <button
              class="pasted-open"
              type="button"
              title="See this picture full size"
              onclick={() => showPicture(image.url, image.name)}
            >
              <img src={image.url} alt={image.name} />
            </button>
            <button
              class="pasted-drop"
              type="button"
              title="Do not send this picture"
              aria-label="Remove this picture"
              onclick={() => unpaste(image.id)}
            >
              <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <textarea
      class="ask-box"
      bind:this={askBox}
      bind:value={prompt}
      rows="1"
      placeholder="Ask {name} about the change…"
      onpaste={paste}
      onkeydown={(event) => {
        // Enter sends, because this is a message rather than a document. A
        // newline is still available for somebody laying out a list.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          send();
        }
      }}
    ></textarea>
    <!--
      Ending a turn, next to starting one.
      
      Only while there is one to end. A stop button on an idle agent is a
      control that does nothing, and a reader who has pressed it once and seen
      nothing happen will not trust it when it matters — which is three minutes
      into work they have just changed their mind about.
    -->
    {#if working}
      <button
        class="ask-stop"
        type="button"
        title="Stop {name}. What it has printed stays, and the question can be asked again."
        aria-label="Stop {name}"
        onclick={() => notify("stopAgent", { agent: id })}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <rect x="4" y="4" width="8" height="8" rx="1.4" fill="currentColor" />
        </svg>
      </button>
    {/if}
    <button class="ask-send" type="submit" disabled={!prompt.trim()} title="Ask {name}">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M2.5 13.5 14 8 2.5 2.5l2.2 5.5z" fill="currentColor" />
      </svg>
    </button>
  </form>
  {/if}
</div>

<!--
  What is stacked up behind whatever is running.

  At the foot of the log, under the line that says something is still happening,
  because that is the reader's answer to "what now" — first what is running,
  then what is waiting, in the order it will be taken.

  The same face as everywhere else, on yellow: this is the agent that will do
  the work, and yellow is what this page already uses for work that has not
  started. A face in the agent's own colour would say it was under way.
-->
{#snippet queue()}
  {#if waiting.length > 0}
    <ul class="queue">
      {#each waiting as ask (ask.id)}
        <li class="queued">
          <svg class="queued-face" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <rect width="24" height="24" rx="12" fill="var(--warning)" />
            {#if mark.stroke}
              <path d={mark.path} fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" />
            {:else}
              <path d={mark.path} fill="var(--bg)" />
            {/if}
          </svg>
          <span class="queued-what" title={ask.body}>{gist(ask.body)}</span>
          <button
            class="queued-drop"
            title="Take this back. Nothing has run, and it can be asked again."
            aria-label="Cancel this queued message"
            onclick={() => notify("cancelAsk", { id: ask.id })}
          >
            <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<style>
  /* Folded, it is its own head and nothing else — so the height it was dragged
     to must not hold a box open around it. */
  .terminal.folded {
    max-height: none;
  }

  .terminal {
    position: relative;
    display: flex;
    flex-direction: column;
    /* Both are set on the element from the reader's own answer; these are what
       a page rendered with no browser to drag in gets. */
    width: 360px;
    max-height: 320px;
    border-radius: 6px;
    /* Solid, not a wash over the drawing.
       Code showed through it — a log about code, over code, in the same
       monospace at nearly the same weight — and the two read as one column of
       nonsense. The composer sits on the same opaque mix for the same reason. */
    background: var(--panel);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    overflow: hidden;
  }

  .grip {
    position: absolute;
    z-index: 2;
    /* Nothing drawn until the pointer is on it: a box with visible handles on
       two sides reads as a control rather than as a log. */
    background: transparent;
  }

  .grip.left {
    top: 0;
    bottom: 0;
    left: -3px;
    width: 7px;
    cursor: ew-resize;
  }

  .grip.top {
    left: 0;
    right: 0;
    top: -3px;
    height: 7px;
    cursor: ns-resize;
  }

  .grip.corner {
    top: -3px;
    left: -3px;
    width: 13px;
    height: 13px;
    cursor: nwse-resize;
  }

  /* Grey, not the accent. The accent means "this is the thing to press" all
     over this page, and an edge being dragged is not a thing being chosen — it
     is a border saying where it currently is. A green line down the side of a
     log reads as a status, and there is no status here. */
  .grip:hover,
  .terminal.sizing .grip {
    background: color-mix(in srgb, var(--text) 32%, transparent);
  }

  /* Nothing selects while an edge is being pulled: a drag that starts on a
     border and wanders across the log would otherwise highlight half of it. */
  .terminal.sizing {
    user-select: none;
  }

  .terminal-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 5px 6px 5px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* Folded, the bar is the control. Said with the cursor as well, or it is a
     thing that happens to work rather than a thing that offers to. */
  .terminal-head.pressable {
    cursor: pointer;
  }

  .terminal-head.pressable:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .terminal-name {
    margin-right: 2px;
    color: var(--text);
    letter-spacing: 0;
    text-transform: none;
    font-size: 11px;
  }

  .terminal-state {
    color: var(--warning, #e2b341);
    animation: terminal-breathing 1.6s ease-in-out infinite;
  }

  @keyframes terminal-breathing {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  .terminal-follow {
    padding: 1px 6px;
    border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 9px;
    text-transform: uppercase;
    cursor: pointer;
  }

  .terminal-follow:hover { color: var(--text); }

  .head-gap { flex: 1 1 auto; }

  .terminal-close {
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .terminal-close:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 4px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }

  .rungs {
    display: inline-flex;
    margin-right: auto;
    border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    border-radius: 4px;
    overflow: hidden;
  }

  .rung {
    padding: 1px 7px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .rung:hover { color: var(--text); }

  .rung.set {
    background: color-mix(in srgb, var(--text) 14%, transparent);
    color: var(--text);
  }

  /* The top rung, marked as what it is. Every other level is a preference;
     this one hands a program the ability to run anything in this checkout, and
     the reader should be able to see which one is on from across the room. */
  .rung.loud {
    background: color-mix(in srgb, var(--warning, #e2b341) 26%, transparent);
    color: var(--warning, #e2b341);
  }

  .terminal-act {
    display: inline-flex;
    align-items: center;
    padding: 2px 4px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .terminal-act:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .terminal-label {
    padding: 1px 7px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--muted);
    letter-spacing: 0;
    text-transform: none;
    font-size: 10px;
  }

  .terminal-rename {
    display: flex;
    gap: 4px;
    flex: 0 0 auto;
    padding: 5px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }

  .rename-box {
    flex: 1 1 auto;
    min-width: 0;
    padding: 2px 6px;
    border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 11px;
  }

  .asked {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 5px 7px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    background: color-mix(in srgb, var(--warning, #e2b341) 12%, transparent);
    font-size: 10.5px;
  }

  .asked-what {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .approve,
  .refuse {
    flex: 0 0 auto;
    padding: 1px 8px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .approve {
    border-color: transparent;
    background: var(--action, #0a84ff);
    color: var(--action-ink, #fff);
  }

  /* Against the foot of the box, out of the log's scroll: a log that scrolled
     its own input away would hide the thing somebody came to type in. */
  .terminal-ask {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    /* So the pictures take a line of their own above the box rather than
       standing in the row beside it, squeezing the thing being typed in. */
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px;
    border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  }

  /* What has been pasted and not yet sent. Small enough to be a row of
     attachments and large enough to tell one screenshot from another, which is
     the entire question a reader has about it. */
  .pasted {
    flex: 1 0 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pasted li {
    position: relative;
    line-height: 0;
  }
  .pasted img {
    max-width: 96px;
    max-height: 64px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    /* A screenshot of a dark window on a dark panel needs an edge to be a
       thing rather than a hole. */
    background: color-mix(in srgb, var(--text) 6%, transparent);
    object-fit: cover;
  }
  .pasted-open {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    line-height: 0;
    cursor: zoom-in;
  }
  .pasted-open:hover img {
    border-color: color-mix(in srgb, var(--text) 45%, transparent);
  }
  .pasted-open:focus-visible {
    outline: 2px solid var(--action, #007C36);
    outline-offset: 2px;
  }
  .pasted-drop {
    position: absolute;
    top: -5px;
    right: -5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--panel-edge);
    border-radius: 50%;
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
  }
  .pasted-drop:hover { color: var(--removed); }

  .ask-box {
    flex: 1 1 auto;
    min-width: 0;
    /* Grows with what is written, to a point: a paragraph is a fair thing to
       ask and half the window is not. The height itself is set from the
       content; this is the ceiling that measurement is clamped to. */
    max-height: 132px;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 5%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    line-height: 1.45;
    /* Nothing to drag: it is already the size of what is in it, and a handle
       that fights the measurement is a handle that loses on the next keystroke. */
    resize: none;
    /* Set by the measurement above; here so the first paint has one. */
    overflow-y: hidden;
  }

  /* Grey, not the action colour. That colour is the same green this page uses
     for "added" and for the button that posts a review, and a box wearing it
     reads as a thing that has been approved rather than a thing being typed
     in. Focus is about where the cursor is, which is not a verdict. */
  .ask-box:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--text) 45%, transparent);
  }

  .ask-send {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  /* The same square as the send, in the colour of a thing that interrupts. */
  .ask-stop {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--removed, #f85149) 45%, transparent);
    border-radius: 4px;
    background: transparent;
    color: var(--removed, #f85149);
    cursor: pointer;
  }

  .ask-stop:hover {
    background: color-mix(in srgb, var(--removed, #f85149) 14%, transparent);
  }

  .ask-send:hover:not(:disabled) {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  /* Nothing written yet, said plainly rather than by a button that looks
     pressable and does nothing. */
  .ask-send:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .terminal-body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 7px 8px;
    /*
     * Down, and only down.
     *
     * `auto` gave the box a sideways axis as well, and the blocks inside it
     * clip rather than scroll — so dragging right moved the prose and the notes
     * while the code stayed exactly where it was, and stopped dead against
     * whichever block was widest. One direction is one context.
     */
    overflow-y: auto;
    overflow-x: hidden;
    /* No compositing hint. One was added to chase a tearing report and never
       demonstrated to help; a hint that promotes this box to its own layer is
       not free, and an unverified fix for an unreproduced bug is a guess left
       in the code. */
    /* Wrapped rather than scrolled sideways. A log is read by scanning down it,
       and a horizontal scrollbar means every long line is a second gesture. */
    overflow-wrap: anywhere;
    color: var(--text);
    /* Selectable, because copying a stack trace out of here is the whole
       reason to have it open. */
    user-select: text;
  }

  /* Smaller than a comment, because this is a log beside the code rather than
     a remark about it — and a terminal that takes a comment's leading shows
     half as much of what an agent is doing. */
  .terminal-body :global(.rendered) {
    font-size: 11px;
    line-height: 1.45;
  }

  /*
    One thing that scrolls, and it scrolls one way.

    A comment renders each fenced block in its own horizontal scroller, which is
    right there: a suggestion is code, and code read beside code has to keep its
    columns. A log is not that. Stacked, those scrollers turned a session into
    three independent horizontal contexts with unscrollable prose wedged between
    them — dragging one sideways left the next where it was, and the reader had
    to find and drag each in turn to read one wide line.

    So the code wraps here and nothing scrolls sideways. What is lost is the
    alignment of a long line; what is gained is a log that is read by scanning
    down it, once.
  */
  /*
    No `overflow` here, and that is the point.

    Declaring `overflow-x: hidden` makes an element a scroll container — the
    spec forces the other axis to `auto` alongside it — so every block in the
    log became its own scrollable box, clipped at top and bottom, scrolling
    independently of the one above it. What was meant to stop sideways
    scrolling created a scroller per answer.

    Wrapping is enough on its own: content that cannot exceed the width has
    nothing to scroll, and an element with no `overflow` of its own is not a
    container to begin with.
  */
  .terminal-body :global(.rendered pre) {
    font-size: 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /*
    Everything inside the rendered log wraps, whatever it is.
    
    A comment sets `pre` on a suggestion's cells and `nowrap` on its line
    numbers, both for good reasons over there — source does not reflow, and a
    three-digit number must not break across two rows. Neither reason survives
    in a box a quarter the width with no room to scroll: what does not wrap here
    simply leaves.
  */
  .terminal-body :global(.rendered td),
  .terminal-body :global(.rendered code),
  .terminal-body :global(.rendered span) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /*
    A table is as wide as its widest cell unless it is told otherwise.
    
    Wrapping the cells is not enough on its own: the default layout sizes
    columns to their content first and only then honours the box, so a
    suggestion stayed wider than the terminal however its text was allowed to
    break. Fixed layout makes the box the authority and the columns fit inside
    it, which is the whole point of a log that does not scroll sideways.
  */
  .terminal-body :global(.suggestion table) {
    table-layout: fixed;
    width: 100%;
  }

  /* A suggestion's own cells set `pre` at a specificity of their own. */
  .terminal-body :global(.suggestion td),
  .terminal-body :global(.suggestion th),
  .terminal-body :global(.suggestion pre),
  .terminal-body :global(.suggestion code) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /*
    Except the two columns beside a suggestion, which are not prose.

    Given widths rather than left to `width: 1%`: fixed layout takes that
    literally, and a column one per cent wide is narrower than the character in
    it — so the marker spilled past its own cell by a pixel or two and the box
    counted as overflowing.
  */
  .terminal-body :global(.rendered .n),
  .terminal-body :global(.rendered .m) {
    white-space: nowrap;
  }

  .terminal-body :global(.suggestion .n) { width: 3.4em; }
  .terminal-body :global(.suggestion .m) { width: 1.6em; }

  /*
    Every box a comment gives its own sideways scroller.
    
    There are several — the fenced block, the suggestion table, the wrapper
    around them — and each one is a place the log stops moving while everything
    around it keeps going. Named rather than swept up with a wildcard: setting
    `overflow-x` on everything forces an `overflow-y` alongside it, which would
    hand a scrollbar to every paragraph in the log.
  */
  /*
    The cap that made every answer its own window.

    A comment renders inside a box capped at a fraction of the viewport with
    its own scrollbar — right there, where one long remark must not swallow the
    thread it sits in. In a log it is the whole complaint: each answer became a
    scrollable window of its own, clipped at top and bottom, scrolling
    independently of the one above it.

    A log has one box and it is the terminal.
  */
  .terminal-body :global(.rendered) {
    max-height: none;
    overflow: visible;
  }

  /*
    Everything else left alone, deliberately.
    
    Setting `overflow: visible` here took away the block formatting context
    these boxes rely on for their own height, and blocks began painting on top
    of one another — which is worse than any scrollbar. And setting
    `overflow-x: hidden` makes them scroll containers, which is what created a
    scroller per answer.
    
    Neither is needed. With the content wrapped there is nothing to scroll
    sideways, so the box the comment renderer already declares never becomes a
    scrollbar and never clips anything.
  */

  .terminal-body :global(.rendered > *:first-child) {
    margin-top: 0;
  }

  .still {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 0;
    color: var(--warning, #e2b341);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* The messages waiting behind the one being worked on.

     A stack rather than a count: four questions asked in a row are four things
     the reader may want to take back, and "3 queued" is a number they would
     have to go and decode somewhere else. */
  .queue {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }
  .queued {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--warning) 10%, transparent);
    color: var(--muted);
    font-size: 11px;
  }
  .queued-face {
    flex: 0 0 auto;
    /* Waiting, not running: the same shape everywhere else in the page draws
       for this agent, on the colour this page already uses for work that has
       not started. */
    opacity: 0.9;
  }
  .queued-what {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Only the row it belongs to. A cross that acts on the queue rather than on
     one message would be a control nobody presses twice. */
  .queued-drop {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .queued-drop:hover {
    color: var(--removed);
    background: color-mix(in srgb, var(--removed) 16%, transparent);
  }

  /* A block where the next character would go, which is what a terminal does
     while it waits and what nothing else in this page looks like. */
  .caret {
    display: inline-block;
    width: 6px;
    height: 12px;
    background: currentColor;
    animation: caret-blink 1.1s steps(1, end) infinite;
  }

  @keyframes caret-blink {
    0%, 55% { opacity: 1; }
    56%, 100% { opacity: 0.15; }
  }

  .still-what {
    animation: still-breathing 1.7s ease-in-out infinite;
  }

  @keyframes still-breathing {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  /* Odin talking about the agent, rather than the agent talking. Dim, narrow
     and monospace, so it reads as a machine's note in the margin of a
     conversation — which is what it is. */
  .note {
    margin: 6px 0;
    padding: 3px 6px;
    border-left: 2px solid color-mix(in srgb, var(--text) 18%, transparent);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 9.5px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /*
    How it got there, kept apart from what it says.

    Against a rail and set back, so a reader skimming for the answer can run
    their eye down the left edge and skip it — and a reader who wants to know
    what it actually ran has it in order, in a face that does not pretend a
    shell command is a sentence.

    Dimmer than the note beside it, because Odin's own remarks are about the
    conversation and this is the agent muttering.
  */
  .work {
    margin: 6px 0;
    padding: 2px 0 2px 8px;
    /* Neutral on purpose: the drawing's action colour is the same green that
       means "added" all over this page, and a rail in it reads as a verdict on
       work that has not finished. */
    border-left: 2px dotted color-mix(in srgb, var(--text) 26%, transparent);
  }

  .step {
    margin: 1px 0;
    color: color-mix(in srgb, var(--muted) 85%, transparent);
    font-family: var(--mono);
    font-size: 10px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* The thinking and the tool calls read differently and are marked
     differently: one is the agent talking to itself, the other is something it
     did to the checkout. */
  .step:first-letter {
    color: color-mix(in srgb, var(--text) 55%, transparent);
  }

  /*
    The reader's own question, said back to them.

    A button because it goes somewhere, and drawn as a quote because that is
    what it is: the thing that started this, sitting above the answer to it.
  */
  /* The quote takes the room, the retry takes what it needs at the end. */
  .ask-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0 6px;
  }

  /*
   * A question quoted in the log.
   *
   * Named for itself rather than sharing `.asked` with the permission row above
   * — they are two different things that happened to be called the same, and
   * the row's own rules reached in here: its `nowrap` and its ellipsis, which
   * are right for one line of "May I …?" and wrong for a question of any
   * length. What that looked like was a prompt running off the right edge of
   * the console with no way to read the end of it.
   */
  .quoted {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: 5px 7px;
    border: 0;
    border-left: 2px solid var(--action, #0a84ff);
    border-radius: 0 4px 4px 0;
    background: color-mix(in srgb, var(--text) 7%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .quoted:hover {
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .quoted.unfinished {
    border-left-color: var(--removed, #f85149);
  }

  /* Square, because it holds a mark rather than a word. */
  .quoted-again {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .quoted-again:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .quoted-face {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    border-radius: 50%;
  }

  .quoted-face.initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--text) 20%, transparent);
    font-size: 8px;
    font-weight: 700;
  }

  .quoted-what {
    flex: 1 1 auto;
    min-width: 0;
    /* Wrapped, and said here rather than left to be inherited: `white-space`
       comes down from whatever is above, and a question is as long as somebody
       felt like making it. The renderer inside brings its own paragraphs, so
       this is `normal` rather than `pre-wrap` — a `pre-wrap` around it would
       put the markdown's own newlines back on top of the paragraphs it has
       already made. */
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.4;
    text-align: left;
  }
  /* A quoted question is a line or two of a log, so what is inside it sits
     tighter than an answer does: no margin above the first thing in it, and
     none below the last. */
  .quoted-what :global(.rendered > *:first-child) { margin-top: 0; }
  .quoted-what :global(.rendered > *:last-child) { margin-bottom: 0; }

  .terminal-empty {
    margin: 0;
    color: var(--muted);
    font-size: 10.5px;
  }
</style>
