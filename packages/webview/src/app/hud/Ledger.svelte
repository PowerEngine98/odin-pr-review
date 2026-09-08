<!--
  What one agent has actually written, as a list of changes.

  The log beside this is a record of a turn: what it thought, what it ran, what
  it said. It is the right shape for watching and the wrong one for auditing —
  an edit appears in it as `Edit(src/media/VideoPreview.tsx)`, which says a file
  was touched and nothing at all about what happened to it, and a turn that
  edited nine files buries those nine lines under four hundred others.

  So the edits are lifted out and kept as what they are: a passage that was
  replaced, at a time, in a file. Each one is drawn as the change it is, and
  pressing it takes the drawing to the line — which is the question a reviewer
  has when they read one of these rows, every time.

  Each row also says whether it is still true. An agent that edited a passage,
  then edited it again, leaves a first entry describing code that is no longer
  anywhere; so does a reviewer who reverted it by hand. The entry is worth
  keeping either way — it is what happened — but it has to say so, and it cannot
  know by itself: the host checks each one against the file on disk.
-->
<script lang="ts">
  import { clockOf, linesOf, type Delta } from "@odin/core/agents/deltas.js";

  import { model, notify, travel, ui } from "../state.svelte.js";

  import { nameBlock, type Token } from "../panels/markdown.js";

  let { agent }: { agent: string } = $props();

  /**
   * This agent's entries, newest first.
   *
   * Newest first, unlike the log under it. A log is read downwards because it
   * is a narrative; a ledger is read to find out what just happened, and the
   * thing that just happened is at the bottom of a list that is four hundred
   * rows long by the end of an afternoon.
   */
  const mine = $derived(
    ui.written.filter((delta) => delta.agent === agent).slice().reverse(),
  );

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
  $effect(() => {
    for (const delta of mine) {
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

<div class="ledger">
  {#if mine.length === 0}
    <p class="ledger-empty">
      {#if !ui.narrating.has(agent)}
        <!--
          Said rather than left as an empty list. This tool has no streaming
          mode to ask for: it prints its answer when it is finished and nothing
          before that, so there are no tool calls to read edits out of. A blank
          panel here would read as "it changed nothing", which may be the
          opposite of the truth.
        -->
        This tool does not say what it is doing as it works, so there is nothing
        to list. What it changed is in its answer, in the thread.
      {:else}
        Nothing written yet. What this agent changes will be listed here, newest
        first, with what it replaced.
      {/if}
    </p>
  {:else}
    {#each mine as delta (delta.id)}
      {@const lines = drawn(delta)}
      {@const at = numberOf(delta.id)}
      {@const texts = lines.map((line) => line.text)}
      <article class="entry" class:stale={delta.stale}>
        <div class="entry-head">
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
            <span class="entry-kind" title="The whole file was written">new</span>
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
    padding: 6px 8px 10px;
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
    border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    border-radius: 6px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }

  /* An entry that no longer matches the file is still the record of what
     happened, so it keeps its colours; only the frame says it has been
     overtaken. */
  .entry.stale {
    border-style: dashed;
  }

  .entry-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    font-size: 10.5px;
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
