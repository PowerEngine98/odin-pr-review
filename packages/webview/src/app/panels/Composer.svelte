<!--
  Where a new line comment is written.

  Kept out of the card on purpose. A box that opened inside the card would change
  that card's height, and every arrow in the column is anchored to a row — so
  beginning to type would set the whole picture moving, which is the one moment a
  reviewer needs it to stand still. It floats over the canvas instead, pinned
  under the line that was clicked, at the card's own left edge: the way an inline
  comment box sits in a diff, rather than floating wherever the cursor happened
  to be.
-->
<script lang="ts">
  import { model, notify, settings, view } from "../state.svelte.js";
  import { sideOf } from "../marks/marks.js";
  import type { Anchor } from "./Thread.svelte";
  import { initialsOf } from "./Thread.svelte";
  import type { Draft, Where } from "./drafts.js";
  import { composerKey, fileDrafts, forget, load, remember } from "./drafts.js";
  import Editor from "./Editor.svelte";

  let {
    /** The lines being talked about, or null when nothing is being written. */
    where = null,
    /**
     * The code under the pick, for a suggestion to fill itself with. Read off
     * the rows by the canvas, because a row folded into a gap is not there to
     * be read and a suggestion built from memory gets the indentation wrong.
     */
    lines = [],
    /**
     * Where the bar across the top ends.
     *
     * The box floats over the canvas, and the canvas runs underneath the
     * chrome — so a passage near the top of the drawing put the box over the
     * tabs, hiding the one row that says which part of the change is on
     * screen. It stops below them instead.
     */
    chromeBottom = 0,
    /**
     * The row the box hangs from and the card it belongs to, in screen
     * coordinates. Both come from the canvas: it is the one that knows which of
     * the picked rows is actually on screen.
     */
    anchor = null,
    drafts = $bindable([]),
    oncancel = () => {},
    onadded = () => {},
  }: {
    where?: Where | null;
    lines?: string[];
    chromeBottom?: number;
    anchor?: { row: Anchor; card: Anchor } | null;
    drafts?: Draft[];
    oncancel?: () => void;
    onadded?: () => void;
  } = $props();

  const open = $derived(where !== null && anchor !== null);
  const key = $derived(where ? composerKey(where) : "");

  let text = $state("");
  let height = $state(0);

  // Read back when the box opens on a new pick, and filed on every keystroke:
  // the event this guards against is the page going away without warning, and a
  // timer that had not fired yet is exactly as good as no timer at all.
  $effect(() => {
    const which = key;
    text = which ? (load(model.current.review).unsent[which] ?? "") : "";
  });

  $effect(() => {
    const which = key;
    const held = text;
    if (which) remember(model.current.review, which, held);
  });

  /**
   * Where this is, in the forge's own notation.
   *
   * R for the head side and L for the base, which is the only way of writing it
   * that tells line 40 of the file as it was from line 40 of the file as it will
   * be.
   */
  const heading = $derived.by(() => {
    if (!where) return "";
    const file = where.path.split("/").pop() ?? where.path;
    if (where.line === undefined) return "Add a comment on " + file;
    const mark = where.side === "RIGHT" ? "R" : "L";
    const start = where.startLine ?? where.line;
    return start === where.line
      ? "Add a comment on line " + mark + where.line
      : "Add a comment on lines " + mark + start + "–" + mark + where.line;
  });

  /**
   * The row the box hangs under, found again every time the camera moves.
   *
   * Deliberately looked up rather than remembered. A card past the zoom at
   * which its code can be read stops building rows at all and draws its shape
   * instead, so the element the box was hanging from is destroyed — and a
   * remembered reference is then dead for good, which is why the box came
   * loose when the reader zoomed out and never found its line again on the way
   * back in.
   *
   * Asking the drawing where the line is has neither problem: while the lines
   * are there the box hangs under them, and while they are not there is
   * nothing to hang under, so it waits out of sight until they return.
   */
  const placed = $derived.by(() => {
    void view.x;
    void view.y;
    void view.scale;
    if (!where) return null;

    const node = model.current.nodes.find((one) => one.path === where.path);
    const card = node
      ? document.querySelector<HTMLElement>(`.card[data-id="${node.id}"]`)
      : null;
    if (!card) return null;

    const body = card.querySelector<HTMLElement>(".card-body") ?? card;
    const attribute = sideOf(where.side) === "base" ? "data-old" : "data-new";
    const row = body.querySelector<HTMLElement>(
      `.row[${attribute}="${where.line}"]`,
    );
    // Folded away, held back by the card's cap, or not drawn at this zoom.
    if (!row || row.offsetParent === null) return null;

    /*
     * The pane the remark is about, when the card is showing two.
     *
     * A split card is two checkouts side by side, and a remark on the head is
     * about the right-hand one. The box hung off the card's left edge either
     * way, so writing about a line on the right meant a box that began under
     * the other pane entirely — pointing, as far as the eye is concerned, at
     * the code it is not about.
     *
     * Only for a card actually split in two: a one-sided file has a single
     * pane, and a unified reading has one column carrying both numberings.
     * There the card's edge is the pane's edge and this changes nothing.
     */
    const pane = row.classList.contains("split")
      ? row.querySelector<HTMLElement>(`.side.${sideOf(where.side)}`)
      : null;

    return {
      row: row.getBoundingClientRect(),
      card: card.getBoundingClientRect(),
      ...(pane && pane.offsetParent !== null
        ? { pane: pane.getBoundingClientRect() }
        : {}),
    };
  });

  const language = $derived(
    model.current.nodes.find((one) => one.path === where?.path)?.language ?? "",
  );

  /**
   * The code the suggestion starts from, and never anything else.
   *
   * Guarded because what arrives here is only as good as whoever filled it in,
   * and the preview walks it and joins it — so anything that is not a list of
   * lines throws inside an effect, which in Svelte takes the component down.
   * A composer that has lost its own render cannot be typed in, submitted or
   * cancelled, and the reader's only way out is to reload the window.
   */
  const picked = $derived(
    Array.isArray(lines) ? lines.filter((line) => typeof line === "string") : [],
  );

  const context = $derived(
    where
      ? { before: picked, startLine: where.startLine ?? where.line ?? 0, language }
      : null,
  );

  /**
   * Wide enough for the toolbar to sit on one row, and no wider than the file it
   * belongs to unless that file is narrower than the tools: a box that writes
   * markdown and hides half its buttons is worse than one that never offered
   * them.
   */
  /** As wide as what it hangs from — a pane where there are two, within reason. */
  const width = $derived(
    placed
      ? Math.max(320, Math.min(placed.pane?.width ?? placed.card.width, 680))
      : 520,
  );

  /*
   * Left with the card, top just under the last line, and nothing else.
   *
   * Every clamp that used to keep this inside the window has gone. They were
   * what made it slide: as the reader panned, the box stopped following the
   * code and started crawling along the edge of the screen instead, which is
   * the one place it means nothing.
   */
  const left = $derived(
    placed ? Math.round(placed.pane?.left ?? placed.card.left) : 8,
  );
  const top = $derived(placed ? Math.round(placed.row.bottom + 6) : 0);

  /**
   * The forge's wording, and it earns its place: the first remark starts
   * something, the rest join it, and a reviewer who has forgotten whether they
   * already have a review going can read the answer off the button.
   */
  const primary = $derived(drafts.length === 0 ? "Start a review" : "Add review comment");

  /**
   * Whether there is anything to add.
   *
   * A suggestion put into an empty box is a fence with nothing between its
   * lines, and the forge has no use for it — so `add` refused it and said
   * nothing, leaving the reader pressing a button that did not work while the
   * passage stayed picked underneath. The button now says so itself.
   */
  const sayable = $derived(worthSending(text));

  /** The text with an empty suggestion fence discounted. */
  function worthSending(said: string): boolean {
    const body = said.trim();
    if (!body) return false;
    // ```suggestion … ``` with only blank lines inside it is an empty remark
    // wearing a fence.
    const fenced = /^```suggestion\s*\n([\s\S]*?)\n?```$/.exec(body);
    return fenced ? fenced[1]!.trim().length > 0 : true;
  }

  /**
   * Whether asking an agent is a thing that can be done from here.
   *
   * A live reading with at least one agent switched on. Both halves matter: an
   * agent works on the files on disk, so over a reading of the forge's copy it
   * would be changing a checkout the reader is not looking at — and a button
   * that hands work to nobody is a button that does nothing.
   */
  const canAsk = $derived(
    model.current.meta.worktree === true &&
      (settings.pairing ?? []).length > 0 &&
      (model.current.agents ?? []).length > 0,
  );

  /**
   * Sends what was written to the agents, and keeps it here.
   *
   * Not a draft and not a review: it goes into the conversation immediately as
   * a local remark, and the forge is never told. That is the whole difference
   * between the two buttons — one is a note to the team about code that exists,
   * the other is a message to somebody who is about to change it.
   */
  function ask(): void {
    const body = text.trim();
    if (!sayable || !where || !canAsk) return;

    notify("askAgents", {
      path: where.path,
      line: where.line,
      ...(where.startLine !== undefined && where.line !== undefined && where.startLine < where.line
        ? { startLine: where.startLine }
        : {}),
      side: where.side,
      body,
    });

    forget(model.current.review, key);
    text = "";
    onadded();
  }

  function add(): void {
    // The fence, when there is one, is already in the text: the suggestion
    // button puts it there along with the lines it replaces, so what goes to the
    // forge is what the reviewer read back before pressing this.
    const body = text.trim();
    if (!sayable || !where) return;

    drafts = fileDrafts(model.current.review, [
      ...drafts,
      {
        path: where.path,
        line: where.line,
        startLine:
          where.line !== undefined &&
          where.startLine !== undefined &&
          where.startLine < where.line
            ? where.startLine
            : undefined,
        side: where.side,
        body,
      },
    ]);

    forget(model.current.review, key);
    text = "";
    onadded();
  }
</script>

<!-- Nothing to hang under, nothing shown. Zoomed out past the point where a
     card draws its code, the lines this is about do not exist on screen; the
     box waits rather than floating somewhere that means nothing, and comes
     back with them. What was written is kept — it lives in `text`, which this
     block does not own. -->
{#if open && where && placed}
  <!-- Its own clicks are its own: a click in the box is not a click on the
       canvas, which is what would drop the pick it is written against. There is
       no keyboard equivalent to add, because there is no gesture here to
       perform — the handler exists to stop one from travelling further. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="composer"
    style="left:{left}px;top:{top}px;width:{width}px"
    bind:clientHeight={height}
    onclick={(event) => event.stopPropagation()}
    onwheel={(event) => {
      /*
       * A pinch over the box is refused, and nothing else is.
       *
       * Left alone, a pinch nobody claims falls through to the editor's own
       * frame, which answers it by zooming the entire document — the bar, the
       * tabs and the graph all change size because the reader rolled a wheel
       * over a text box.
       *
       * Deliberately not stopping the event from travelling. The drawing
       * decides whose a gesture is by where it *began*, and it listens at the
       * window to do it — so a pan that carries the cursor across this box has
       * to keep arriving. Stopping propagation here would kill exactly that,
       * and the drawing would halt under a hand that was still moving. A scroll
       * that began over this box still scrolls the preview, because the drawing
       * will not claim what it did not start.
       */
      if (event.ctrlKey) event.preventDefault();
    }}
    role="dialog"
    aria-label={heading}
    tabindex="-1"
  >
    <div class="composer-head">
      <!-- The writer's own face, the size a remark's is: every other remark in
           the page carries the face of whoever wrote it, and a composer without
           one reads as somebody else's box. -->
      {#if model.current.viewer}
        <span class="composer-face">
          {#if model.current.viewerFace}
            <img class="writer" src={model.current.viewerFace} alt={model.current.viewer} />
          {:else}
            <span class="writer initials">{initialsOf(model.current.viewer)}</span>
          {/if}
        </span>
      {/if}
      <span class="composer-where">{heading}</span>
      <!-- Always in the head, and the head is always at the top of a box that
           can no longer be taller than the window. Whatever else goes wrong
           further down, there is one thing on screen that closes this. -->
      <button
        class="composer-close"
        title="Close without saying anything"
        aria-label="Close"
        onclick={oncancel}>×</button>
    </div>

    <!-- Re-keyed on the span: the same box moved to another line would arrive
         showing the previous line's sentence and the previous tab. -->
    <!-- The one part that may grow, and therefore the one part that scrolls.
         Switching to preview renders whatever was written — a suggestion comes
         back as a table of the lines it replaces — and the box grew with it,
         past the bottom of the window, taking Cancel and the verdict with it.
         The reader could then neither send the remark nor abandon it. -->
    <div class="composer-body">
      {#key key}
        <Editor bind:value={text} placeholder="Leave a comment" rows={5} {context} autofocus />
      {/key}
    </div>

    <div class="composer-actions">
      <button class="composer-cancel" onclick={oncancel}>Cancel</button>
      <!-- Beside the review button rather than instead of it. The same passage
           is worth both: a note for whoever reads this later, and a message to
           somebody who is about to change it. Which one is meant is the
           reader's to say, and a box that guessed would post half of them to
           the wrong place. -->
      {#if canAsk}
        <button
          class="composer-ask"
          disabled={!sayable}
          title={sayable
            ? "Send this to the agents. It stays on this machine."
            : "Write something first"}
          onclick={ask}
        >
          <!-- The one press on this box that does not go to the forge. Marked
               as such rather than only worded as such: a colour and a shape
               are read before any label is. -->
          <svg class="sparks" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M6.4 1.8 7.5 4.6 10.3 5.7 7.5 6.8 6.4 9.6 5.3 6.8 2.5 5.7 5.3 4.6z"
              fill="currentColor"
            />
            <path
              d="M11.6 8.6 12.2 10.2 13.8 10.8 12.2 11.4 11.6 13 11 11.4 9.4 10.8 11 10.2z"
              fill="currentColor"
            />
          </svg>
          Ask agents
        </button>
      {/if}
      <button
        class="composer-add primary"
        disabled={!sayable}
        title={sayable ? undefined : "Write something first"}
        onclick={add}>{primary}</button>
    </div>
  </div>
{/if}

<style>
  /* Not the primary, deliberately. Reviewing is what this box is for, and the
     agents are a second thing it can also do — drawn as an alternative rather
     than as the obvious press. */
  /*
   * Purple, which is the one colour on this box that does not mean the forge.
   *
   * Everything else here posts to the pull request. This does not: it sends the
   * passage to a tool on this machine, and what comes back stays local until
   * somebody says otherwise. That is worth being able to see without reading —
   * hence a colour and a mark, not only a different word.
   */
  .composer-actions .composer-ask {
    border-color: color-mix(in srgb, var(--ai, #a371f7) 55%, transparent);
    color: var(--ai, #a371f7);
  }

  .composer-actions .composer-ask:hover:not(:disabled) {
    color: var(--ai, #a371f7);
    border-color: var(--ai, #a371f7);
    background: color-mix(in srgb, var(--ai, #a371f7) 12%, transparent);
  }

  .composer-ask .sparks {
    flex: 0 0 auto;
  }

  .composer-actions .composer-ask:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Never taller than the window it hangs in.
     The box is placed against a row and flips above it when it will not fit
     below; with nothing bounding its height, a preview that ran long simply
     hung off the bottom of the screen with its buttons on the far side of the
     edge. Capped here, so the head and the actions are always on screen and
     the middle takes whatever room is left. */
  .composer {
    display: flex;
    flex-direction: column;
    /* Whatever room there is where it is standing, so it never runs off
       the edge and never has to move to avoid doing so. */
    max-height: var(--composer-room, calc(100vh - 16px));
    position: fixed;
    /* Above the bar, not under it.
       The scale puts a panel at 40 and the chrome at 30, which ought to be
       enough — but the box rides with the code now, so it passes beneath the
       tabs whenever the passage it is about scrolls up there, and a composer
       hidden behind the bar is a composer the reader cannot finish. It sits at
       the level a conversation sits at, which is what it is: the thread panel
       is already there for the same reason. */
    z-index: var(--z-compose, 23);
    padding: 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    font-size: 12px;
  }

  .composer-close {
    margin-left: auto;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .composer-close:hover { background: var(--hover); color: var(--text); }

  .composer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 9px;
  }

  .composer-face {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .writer {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
  }

  .writer.initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--bg);
    background: var(--status-renamed);
  }

  .composer-where {
    color: var(--text);
    font-weight: 600;
    font-size: 13px;
  }

  /* The middle gives way, and only the middle.
     Deliberately not scrollable: the tabs and the formatting tools live at the
     top of the editor inside it, so scrolling the body carried them out of
     sight — a reader who had scrolled to read their own preview could no
     longer get back to Write. What may scroll is the rendered preview alone,
     which is inside the editor and below its tools. */
  .composer-body {
    flex: 0 1 auto;
    min-height: 0;
  }

  .composer-head { flex: 0 0 auto; }

  .composer-actions {
    flex: 0 0 auto;
    display: flex;
    /* Stretched rather than centred, so three buttons of different lengths are
       still one row of the same height. */
    align-items: stretch;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 8px;
  }

  /*
   * One height for all three.
   *
   * They were sized by their text: on a narrow card "Ask agents" and "Start a
   * review" wrapped onto two lines and grew, while "Cancel" stayed one line and
   * sat short beside them — a row of buttons at three different heights. The
   * words stay on one line and the box has a floor, so the row is a row.
   */
  .composer-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 26px;
    white-space: nowrap;
    font: inherit;
    color: var(--muted);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    border-radius: 5px;
    padding: 3px 10px;
    cursor: pointer;
  }

  .composer-actions button:hover {
    color: var(--text);
  }

  .composer-cancel {
    font-weight: 600;
    color: var(--text);
  }

  .composer-actions button.primary {
    color: var(--action-ink);
    background: var(--action);
    border-color: color-mix(in srgb, #000 22%, var(--action));
    font-weight: 600;
  }

  /* Nothing to send yet, and said plainly. A button that looks pressable and
     does nothing is how a reader ends up wondering whether the tool is broken —
     which is exactly what happened, with the passage still picked underneath
     and no way out but a reload. */
  .composer-actions button.primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .composer-actions button.primary:not(:disabled):hover {
    color: var(--action-ink);
    filter: brightness(1.08);
  }
</style>
