<!--
  Everything that has changed in this checkout, as a list.

  The log beside this is a record of a turn: what one tool thought, what it ran,
  what it said. It is the right shape for watching and the wrong one for
  auditing — an edit appears in it as `Edit(src/media/VideoPreview.tsx)`, which
  says a file was touched and nothing about what happened to it, and a turn that
  edited nine files buries those nine lines under four hundred others.

  This is built from the file watcher instead, which is the only thing in Odin
  that sees every change to a checkout whoever made it. Lifting the entries out
  of the agents' own announcements was the obvious way and the wrong one: only
  some tools narrate their work, none of them narrate a formatter running on
  save, and nothing at all narrates the reader editing a file themselves. A
  record of what happened to this branch that quietly omits most of what
  happened to this branch is worse than none.

  So every change is a row: before, after, when, and the file. Pressing one
  takes the drawing to the line, which is the question a reviewer has about one
  of these rows every time. A row is attributed when a tool announced the same
  file a moment earlier, and left unattributed when nothing did — because that
  is the truth about it, and a guess here would be a guess about who changed
  somebody's code.

  Each row also says whether it is still true. A passage edited and then edited
  again leaves a first entry describing code that is nowhere; so does one the
  reviewer reverted by hand. The entry is worth keeping either way — it is what
  happened — but it cannot know by itself, so the host checks each one against
  the file on disk.
-->
<script lang="ts">
  import { clockOf, linesOf, type Delta } from "@odin/core/agents/deltas.js";

  import { model, notify, travel, ui } from "../state.svelte.js";

  import { nameBlock, type Token } from "../panels/markdown.js";

  let { agent }: { agent: string } = $props();

  /**
   * Every change to this checkout, oldest first.
   *
   * Every one, not this agent's. The list is built from what the file watcher
   * saw, and the watcher does not know or care who was typing: an agent that
   * narrates its work, one that does not, a formatter on save, and the reader's
   * own hands all reach it the same way. A list that showed only the changes
   * one tool admitted to would be a list that is quietly missing most of what
   * happened to the branch — which is the opposite of what a ledger is for.
   *
   * So the console it is opened from decides nothing about what is in it. What
   * the console adds is which rows are its own, and those are marked.
   *
   * In the order things happened, like the log beside it. A ledger is a
   * sequence — this edit, then that one, then the one that undid it — and read
   * newest first that sequence runs backwards, which is a hard way to follow
   * what an afternoon did to a file. The newest is at the end, where the box
   * keeps itself unless the reader has scrolled away.
   */
  const mine = $derived(ui.written);

  /** The file this entry is in, when the change has a card for it. */
  function nodeOf(path: string): { language?: string } | undefined {
    return model.current.nodes.find((node) => node.path === path);
  }

  /**
   * What to colour it as.
   *
   * The card's own answer where there is a card, because then the entry looks
   * like the file it is about. Otherwise the extension, which is what a card
   * would have been given anyway — an agent may well write a file that is not
   * in the change, and colouring it as nothing because nobody laid it out would
   * be a rule about the drawing leaking into a record of what happened.
   */
  function langOf(path: string): string {
    const node = nodeOf(path);
    if (node?.language) return node.language;
    const dot = path.lastIndexOf(".");
    return dot < 0 ? "" : (BY_SUFFIX[path.slice(dot + 1)] ?? "");
  }

  const BY_SUFFIX: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    svelte: "svelte",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cs: "csharp",
    php: "php",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    sh: "bash",
    md: "markdown",
  };

  /** Just the file, for the row's heading. The trail is in the title. */
  function fileOf(path: string): string {
    const at = path.lastIndexOf("/");
    return at < 0 ? path : path.slice(at + 1);
  }

  /** The change itself, as lines to draw. */
  function drawn(delta: Delta) {
    return linesOf(delta.before, delta.after, delta.line);
  }

  /**
   * Where the drawing should go when a row is pressed.
   *
   * The head side always: an agent writes the branch, so the line it wrote is a
   * line of the new file. The base side of a card holds what was there before,
   * which is precisely what this entry replaced.
   */
  function goTo(delta: Delta): void {
    if (delta.line === undefined) return;
    travel.toLine?.(delta.path, delta.line, "head");
  }

  /* --------------------------------------------------------- the colouring */

  /**
   * Tokens the host has sent back, by the number the block was asked under.
   *
   * The same round trip the comment editor makes, for the same reason: the
   * grammars and the theme live with the host, and a passage of Kotlin in this
   * list should look like the Kotlin in the card above it. A page with no host
   * keeps the plain text, which reads perfectly well in grey.
   */
  let painted = $state<Record<number, Token[][]>>({});

  /**
   * A number per entry, since that is what the host echoes back.
   *
   * Minted by the same counter the comment editor's blocks come from. The
   * answers all arrive on one channel, so two components counting from one
   * would paint each other's code.
   */
  const numbers = new Map<string, number>();

  function numberOf(id: string): number {
    let at = numbers.get(id);
    if (at === undefined) {
      at = nameBlock();
      numbers.set(id, at);
    }
    return at;
  }

  /**
   * A colour from the host, reduced to what a colour can be.
   *
   * The theme is the host's own, and it arrives over the same channel as
   * everything else. A style property is the one place in this component where
   * a string still means something to the browser.
   */
  function safeColour(colour: string | undefined): string {
    return String(colour ?? "").replace(/[^#\w(),.% ]/g, "");
  }

  /**
   * Asked for once per entry, and only for entries that are on screen.
   *
   * "On screen" as far as this can tell it, which is the list being open at
   * all: a folded ledger asks for nothing. Four hundred entries would be four
   * hundred round trips otherwise, each one a grammar being run over a passage
   * nobody is looking at.
   */
  /**
   * Which entries are close enough to the view to be worth drawing.
   *
   * A session leaves hundreds of these, and each one is a diff to compute, a
   * table to build and a round trip to the host for its colours. Doing that for
   * four hundred entries so the reader can look at six is most of a second of
   * the page doing nothing useful, every time the list is opened or another
   * edit lands.
   *
   * Kept as a set of ids rather than a window of indexes, because the list
   * grows at the end while the reader is looking at it and an index means
   * something different a moment later.
   */
  let near = $state(new Set<string>());

  /**
   * Watches one entry, and says when it is worth drawing.
   *
   * Generously — a screen and a half either side — so scrolling meets rows that
   * are already there rather than a hole that fills in behind the scrollbar.
   */
  function watch(node: HTMLElement, id: string) {
    if (typeof IntersectionObserver === "undefined") {
      // No observer to ask: draw everything, which is what this did before.
      near = new Set([...near, id]);
      return {};
    }
    const eye = new IntersectionObserver(
      ([seen]) => {
        if (!seen) return;
        const held = new Set(near);
        if (seen.isIntersecting) held.add(id);
        else held.delete(id);
        near = held;
      },
      { root: pane, rootMargin: "600px 0px" },
    );
    eye.observe(node);
    return {
      destroy(): void {
        eye.disconnect();
        const held = new Set(near);
        held.delete(id);
        near = held;
      },
    };
  }

  /**
   * Which heads are currently held at the top rather than sitting on their own
   * entry.
   *
   * There is no way to ask an element whether it is stuck — the state exists in
   * the layout and nowhere in the DOM — so a hairline is put where the head
   * would be if it were not stuck, and the head is stuck exactly when that
   * hairline has scrolled out of the top of the box.
   */
  let stuck = $state(new Set<string>());

  function pin(node: HTMLElement, id: string) {
    if (typeof IntersectionObserver === "undefined") return {};
    const eye = new IntersectionObserver(
      ([seen]) => {
        if (!seen) return;
        const held = new Set(stuck);
        // Above the top of the box, rather than below the bottom of it: an
        // entry scrolled past underneath is not stuck, it is gone.
        if (!seen.isIntersecting && seen.boundingClientRect.top < 0) held.add(id);
        else held.delete(id);
        stuck = held;
      },
      { root: pane, threshold: 0 },
    );
    eye.observe(node);
    return {
      destroy(): void {
        eye.disconnect();
        const held = new Set(stuck);
        held.delete(id);
        stuck = held;
      },
    };
  }

  /** Roughly how tall an entry will be, for the space it holds while away. */
  function roomFor(delta: Delta): number {
    const rows = Math.min(delta.after.split("\n").length + 2, 20);
    return rows * 15;
  }

  $effect(() => {
    for (const delta of mine) {
      if (!near.has(delta.id)) continue;
      const lang = langOf(delta.path);
      if (!lang) continue;
      const at = numberOf(delta.id);
      if (painted[at]) continue;
      notify("highlight", {
        id: at,
        lang,
        code: drawn(delta)
          .map((line) => line.text)
          .join("\n"),
      });
    }
  });

  $effect(() => {
    const answer = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== "highlighted") return;
      if (!Array.isArray(message.lines) || message.lines.length === 0) return;
      // Only the numbers this list minted. Every component doing this listens
      // to the same window, and the editor's block ids are its own counter.
      if (![...numbers.values()].includes(message.id)) return;
      painted = { ...painted, [message.id]: message.lines as Token[][] };
    };
    window.addEventListener("message", answer);
    return () => window.removeEventListener("message", answer);
  });

  /**
   * Following the end, unless the reader has scrolled away from it.
   *
   * The same rule the log beside this uses, and for the same reason: with the
   * newest at the bottom, a list that does not follow leaves the entry somebody
   * is waiting for just below the fold — and one that follows while they are
   * reading further up is a list that cannot be read at all.
   */
  let pane = $state<HTMLElement | null>(null);
  let following = $state(true);

  function scrolled(): void {
    if (!pane) return;
    following = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
  }

  $effect(() => {
    // Read so this runs when another entry arrives.
    mine.length;
    if (!pane || !following) return;
    pane.scrollTop = pane.scrollHeight;
  });

  /**
   * The ledger, asked for when this opens.
   *
   * And asked for again rather than kept: whether an entry still matches the
   * file is a fact about the working tree, which changes without Odin being
   * told — somebody edits the file themselves, or checks out another branch.
   * Looking at the tab is the moment the answer matters, so that is when it is
   * asked for.
   */
  $effect(() => {
    notify("deltas", {});
  });
</script>

{#snippet code(at: number, lines: string[], row: number)}{#if painted[at] && painted[at][row]}{#each painted[at][row] as token}<span style="color:{safeColour(token.color)}">{token.text}</span>{/each}{:else}{lines[row]}{/if}{/snippet}

<div class="ledger" bind:this={pane} onscroll={scrolled}>
  {#if mine.length === 0}
    <!--
      An empty list means one thing now, and it is a true thing.

      It used to mean several: this tool does not narrate, or nobody has asked
      it anything, or it has been asked and wrote nothing — and the reader had
      to guess which. Built from the watcher there is only one answer left:
      nothing in this checkout has changed since the reading opened.
    -->
    <p class="ledger-empty">
      Nothing has changed in this checkout yet. Every edit — by an agent, by a
      tool, or by hand — will be listed here as it happens, in the order it
      happened, with what it replaced.
    </p>
  {:else}
    {#each mine as delta (delta.id)}
      {@const at = numberOf(delta.id)}
      <article class="entry" class:stale={delta.stale} use:watch={delta.id}>
        <!-- Where the head sits when it is not being held at the top. Nothing
             is drawn here; it is watched, and the head reads its answer. -->
        <i class="entry-mark" use:pin={delta.id}></i>
        <div class="entry-head" class:held={stuck.has(delta.id)}>
          <span class="entry-time">{clockOf(delta.at)}</span>
          <!--
            The file, as a button, because going to it is what a reader wants
            from this row nine times out of ten. Dead rather than absent when
            there is no line to go to: the entry still says what was written,
            and a row that silently does nothing when its neighbours all work
            is the worse of the two.
          -->
          <button
            class="entry-file"
            type="button"
            disabled={delta.line === undefined}
            title={delta.line === undefined
              ? `${delta.path} — this passage is no longer in the file, so there is nowhere to go`
              : `${delta.path}:${delta.line} — press to go to it`}
            onclick={() => goTo(delta)}
          >
            {fileOf(delta.path)}{#if delta.line !== undefined}<span class="entry-line">:{delta.line}</span>{/if}
          </button>
          {#if delta.whole}
            <span class="entry-kind" title="The whole file was written or removed">whole</span>
          {/if}
          <!--
            Who did it, where that can be said at all.
            
            A tool that narrates its work announces the files it writes, and an
            announcement a moment before the watcher saw the same file change is
            what makes a row attributable. Most rows are not: nothing announces
            a formatter, and nothing announces a reader typing. Those are shown
            as what they are rather than guessed at or hidden.
          -->
          {#if delta.agent}
            <span
              class="entry-who"
              class:is-mine={delta.agent === agent}
              title="{ui.labels[delta.agent] || delta.agent} said it was writing this file"
            >{ui.labels[delta.agent] || delta.agent}</span>
          {/if}
          <span class="entry-gap"></span>
          {#if delta.stale}
            <!--
              Said plainly rather than by dimming the row. An entry that no
              longer matches the file is not less important — it is often the
              interesting one, because something undid it — and it has to be
              possible to tell that at a glance without reading the code.
            -->
            <span
              class="pill"
              title="The file no longer reads this way. Something changed it after this edit."
            >Outdated</span>
          {/if}
        </div>
        <!--
          The change itself, drawn only while it is somewhere near the view.

          Away from it the entry keeps roughly the height it will have, so the
          scrollbar means what it says and rows do not jump under the reader as
          they arrive. The head stays whatever happens: what a row is *about*
          is the part somebody skims, and it costs nothing.
        -->
        {#if near.has(delta.id)}
          {@const lines = drawn(delta)}
          {@const texts = lines.map((line) => line.text)}
          <table class="entry-code">
            <tbody>
              {#each lines as line, row (row)}
                <tr class={line.kind}>
                  <td class="n">{line.was ?? ""}</td>
                  <td class="n">{line.now ?? ""}</td>
                  <td class="m">{line.kind === "del" ? "−" : line.kind === "add" ? "+" : ""}</td>
                  <td class="t">{@render code(at, texts, row)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="entry-room" style="height:{roomFor(delta)}px"></div>
        {/if}
      </article>
    {/each}
  {/if}
</div>

<style>
  /* Takes the room the log would have taken, and scrolls inside it: this sits
     in the terminal's column between a bar and the ask box, both of which keep
     their height. */
  .ledger {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    /*
     * No padding at the top, because padding is inside the scrollable area:
     * rows scrolled up into it stay visible, so a sticky head at `top: 0` had
     * six pixels of somebody else's code showing above it. The breathing space
     * belongs to the first entry, which scrolls away with it.
     */
    padding: 0 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ledger-empty {
    margin: 10px 4px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.5;
  }

  .entry {
    /*
     * Its own height, and never less.
     *
     * A flex item shrinks by default, and this list is a flex column inside a
     * box with a height of its own — so forty entries did not overflow and
     * scroll, they were squashed to about a pixel each. What the reader got was
     * sixty dashed rules stacked down the panel with nothing legible anywhere,
     * and a count in the tab saying forty-two, which is the most confusing way
     * this could possibly have failed: the data was all there and all of it was
     * one pixel tall.
     */
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    border-radius: 6px;
    /*
     * Not clipped, because clipping is what a sticky head cannot survive.
     *
     * `overflow: hidden` makes this box the nearest scrollport, and a scrollport
     * that never scrolls is one nothing can stick inside — so the head simply
     * did not move. The corners are rounded on the head and the code instead,
     * which is what the clipping was for.
     */
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }

  /* Room kept for a change that is not drawn yet, so the scrollbar means what
     it says while the reader is moving. */
  .entry-room { width: 100%; }

  .entry:first-child { margin-top: 6px; }

  /* Nothing to see: a hairline where the head would be, watched so the head can
     tell whether it is being held at the top. */
  .entry-mark {
    display: block;
    height: 0;
  }

  /* An entry that no longer matches the file is still the record of what
     happened, so it keeps its colours; only the frame says it has been
     overtaken. */
  .entry.stale {
    border-style: dashed;
  }

  /*
   * Which file, kept in view while its change scrolls past.
   *
   * An entry can be twenty rows of diff, and halfway down one the reader has
   * lost the two things that make it mean anything: which file it is and when
   * it happened. Sticky within its own entry, so it goes away with the entry
   * rather than piling up.
   */
  .entry-head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    border-radius: 5px 5px 0 0;
    transition: border-radius 90ms ease;
    /* Solid, because code scrolls underneath it. A translucent head over a
       moving diff is unreadable in exactly the moment it matters. */
    background: color-mix(in srgb, var(--text) 7%, var(--card-bg));
    font-size: 10.5px;
  }

  /*
   * Square while it is held at the top.
   *
   * A rounded corner is a corner: it says the box begins here. Held against the
   * top of the panel with its own code running out from under it, a head that
   * keeps its rounding reads as a floating card rather than as the top of the
   * thing being read — and leaves two slivers of code showing through where the
   * curve cuts away.
   */
  .entry-head.held {
    border-radius: 0;
  }

  .entry-gap { flex: 1; }

  .entry-time {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .entry-file {
    background: none;
    border: 0;
    padding: 0;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-file:hover:not(:disabled) { text-decoration: underline; }

  .entry-file:disabled {
    cursor: default;
    color: var(--muted);
  }

  .entry-line { color: var(--muted); }

  .entry-kind,
  .pill {
    border-radius: 999px;
    padding: 0 6px;
    font-size: 9.5px;
    line-height: 15px;
    white-space: nowrap;
  }

  .entry-kind {
    border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    color: var(--muted);
  }

  /* Whose it was, where anything can say. Quiet by default and lit for the
     console it is being read from, because "which of these are mine" is the
     one thing a per-agent view of a shared list is for. */
  .entry-who {
    flex: 0 0 auto;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--muted);
    font-size: 9.5px;
    line-height: 15px;
    white-space: nowrap;
  }

  .entry-who.is-mine {
    background: color-mix(in srgb, var(--box-set) 22%, transparent);
    color: var(--text);
  }

  .pill {
    border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
    background: color-mix(in srgb, var(--warning) 16%, transparent);
    color: var(--warning);
  }

  .entry-code {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.45;
    /* The code decides the width, and the box scrolls: a long line wrapped is a
       line whose indentation lies about where it sits. */
    display: block;
    overflow-x: auto;
  }

  .entry-code td { padding: 0; vertical-align: top; }

  .entry-code tr:last-child td:first-child { border-bottom-left-radius: 5px; }

  .entry-code .n {
    width: 1%;
    padding: 0 4px;
    text-align: right;
    color: var(--muted);
    opacity: 0.65;
    user-select: none;
    font-variant-numeric: tabular-nums;
  }

  .entry-code .m {
    width: 1%;
    padding: 0 3px;
    text-align: center;
    color: var(--muted);
    user-select: none;
  }

  .entry-code .t { white-space: pre; padding-right: 8px; }

  .entry-code tr.del { background: var(--del-bg); }
  .entry-code tr.add { background: var(--add-bg); }
</style>
