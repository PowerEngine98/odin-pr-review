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
  import { model } from "../state.svelte.js";
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

  const language = $derived(
    model.current.nodes.find((one) => one.path === where?.path)?.language ?? "",
  );

  const context = $derived(
    where
      ? { before: lines, startLine: where.startLine ?? where.line ?? 0, language }
      : null,
  );

  /**
   * Wide enough for the toolbar to sit on one row, and no wider than the file it
   * belongs to unless that file is narrower than the tools: a box that writes
   * markdown and hides half its buttons is worse than one that never offered
   * them.
   */
  const width = $derived(anchor ? Math.max(520, Math.min(anchor.card.width, 680)) : 520);

  const left = $derived(
    anchor
      ? Math.round(Math.min(Math.max(8, anchor.card.left), window.innerWidth - width - 8))
      : 8,
  );

  /** Below the line where there is room for it, above where there is not. */
  const top = $derived.by(() => {
    if (!anchor) return 0;
    const below = anchor.row.bottom + 6;
    return Math.round(
      below + height > window.innerHeight - 8
        ? Math.max(8, anchor.row.top - height - 6)
        : below,
    );
  });

  /**
   * The forge's wording, and it earns its place: the first remark starts
   * something, the rest join it, and a reviewer who has forgotten whether they
   * already have a review going can read the answer off the button.
   */
  const primary = $derived(drafts.length === 0 ? "Start a review" : "Add review comment");

  function add(): void {
    // The fence, when there is one, is already in the text: the suggestion
    // button puts it there along with the lines it replaces, so what goes to the
    // forge is what the reviewer read back before pressing this.
    const body = text.trim();
    if (!body || !where) return;

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

{#if open && where}
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
    </div>

    <!-- Re-keyed on the span: the same box moved to another line would arrive
         showing the previous line's sentence and the previous tab. -->
    {#key key}
      <Editor bind:value={text} placeholder="Leave a comment" rows={5} {context} autofocus />
    {/key}

    <div class="composer-actions">
      <button class="composer-cancel" onclick={oncancel}>Cancel</button>
      <button class="composer-add primary" onclick={add}>{primary}</button>
    </div>
  </div>
{/if}

<style>
  .composer {
    position: fixed;
    z-index: 40;
    padding: 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    font-size: 12px;
  }

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

  .composer-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .composer-actions button {
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

  .composer-actions button.primary:hover {
    color: var(--action-ink);
    filter: brightness(1.08);
  }
</style>
