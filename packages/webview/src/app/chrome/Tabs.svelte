<!--
  One tab per part of the change that can be read without the others.

  A large pull request is usually several changes pushed together, and reading
  it as one picture means holding all of it at once. Each tab is a call chain
  and everything it reaches, named after the file the chain starts at. Absent
  when the change is one connected thing, which is when the strip would only
  take up room to say so.
-->
<script lang="ts">
  import { model, notify, ui, view } from "../state.svelte.js";
  import { TICK } from "./icons.js";

  let { onFit }: { onFit?: () => void } = $props();

  const paths = $derived(new Map(model.current.nodes.map((node) => [node.id, node.path])));

  /**
   * A part of one file is a review of one file: real, but not a chain, and
   * thirty of them in a strip is a worse index than the sidebar already is.
   * The host has already gathered them into a part of their own so nothing is
   * unreachable.
   */
  const chains = $derived((model.current.parts ?? []).filter((part) => part.id !== "loose"));
  const loose = $derived((model.current.parts ?? []).find((part) => part.id === "loose"));
  const spare = $derived(loose?.nodes.length ?? 0);
  const total = $derived((model.current.parts ?? []).reduce((n, part) => n + part.nodes.length, 0));

  /**
   * What a chain is called, worked out from its files.
   *
   * The part's id is the id of the file it is named after — which is all the
   * view model carries, so the name and the tooltip are read back off that
   * file's path rather than sent. A part whose lead file is somehow not on the
   * canvas falls back to its size, which is at least true.
   */
  function nameOf(id: string): string {
    const path = paths.get(id);
    return path ? (path.split("/").pop() ?? path) : id;
  }

  function about(id: string, files: number): string {
    const path = paths.get(id) ?? nameOf(id);
    return `${path} and the ${files - 1} file${files === 2 ? "" : "s"} its calls reach`;
  }

  /**
   * How much of each part has been read.
   *
   * A count of files says how much there is; a count of files read says how
   * much is left, which is the question being asked of a strip of tabs.
   * Untouched files carry no box, so counting them would leave every tally
   * short of full however much was read.
   */
  function tally(ids: string[] | null): { done: number; total: number } {
    const inPart = ids ? new Set(ids) : null;
    let done = 0;
    let counted = 0;
    for (const node of model.current.nodes) {
      if (node.untouched) continue;
      if (inPart && !inPart.has(node.id)) continue;
      counted += 1;
      if (ui.viewed.has(node.path)) done += 1;
    }
    return { done, total: counted };
  }

  /**
   * Where the reader was in each part, so going back is going back.
   *
   * A part is a place, not a filter: leaving one halfway down its third file
   * and returning to the top of it throws away the work of getting there. Kept
   * for the session, which is as long as the positions it refers to last.
   */
  const wasAt = new Map<string, { x: number; y: number; scale: number }>();

  function openPart(id: string | null) {
    wasAt.set(ui.part ?? "", { x: view.x, y: view.y, scale: view.scale });
    ui.part = id;

    // The list beside the canvas follows the canvas: a part is a smaller
    // review, and a file list showing forty files while the drawing shows five
    // is two answers to the same question.
    const part = (model.current.parts ?? []).find((p) => p.id === id);
    notify("part", {
      paths: part ? part.nodes.map((node) => paths.get(node)).filter(Boolean) : null,
    });

    // Back where it was left, or framed if this part has not been opened
    // before: a part opened for the first time should fill the view rather than
    // show the space the others left behind.
    const seen = wasAt.get(id ?? "");
    if (seen) {
      view.x = seen.x;
      view.y = seen.y;
      view.scale = seen.scale;
    } else {
      onFit?.();
    }
  }

  /**
   * Which ends of the strip have more beyond them.
   *
   * The strip scrolls when a change has more parts than fit, and the only thing
   * that said so was a scrollbar — a second thing to read under a row whose job
   * is to be read at a glance, and one that appears with the pointer and nudges
   * the tabs as it does. The strip fades at an edge it can still travel towards
   * and stops fading when it arrives.
   */
  let strip: HTMLElement | undefined = $state();
  let moreLeft = $state(false);
  let moreRight = $state(false);

  function markEnds() {
    if (!strip) return;
    const travel = strip.scrollWidth - strip.clientWidth;
    // A strip that fits says nothing at either end.
    moreLeft = travel > 1 && strip.scrollLeft > 1;
    moreRight = travel > 1 && strip.scrollLeft < travel - 1;
  }

  // A tab that grows as it becomes the open one, or a rebuild that brings a
  // different set of parts, can change what fits.
  $effect(() => {
    void ui.part;
    void model.current.parts;
    markEnds();
  });
</script>

<svelte:window onresize={markEnds} />

{#if chains.length >= 2 || spare > 0}
  <!-- The strip that scrolls sits inside a rail that does not. The rail carries
       the background: the fade at a travelling edge is drawn by masking the
       strip, and a mask takes the element's own background with it — which left
       a notch of the header showing through at exactly the edge being pointed
       at. -->
  <div class="parts-rail">
    <div
      class="parts"
      class:more-left={moreLeft}
      class:more-right={moreRight}
      bind:this={strip}
      onscroll={markEnds}
    >
      {#snippet tab(
        id: string | null,
        label: string,
        ids: string[] | null,
        files: number,
        title: string,
      )}
        {@const count = tally(ids)}
        {@const complete = count.total > 0 && count.done === count.total}
        <button
          class="part-tab"
          class:on={ui.part === id}
          class:finished={complete}
          {title}
          onclick={() => openPart(id)}
        >
          {label}
          <!-- Nothing read yet is just the size of the part; part-read is read
               over size, with the moving number carrying the colour; all read
               is a tick, because by then the numbers have nothing left to say.
               Room for the widest thing the pill will ever hold — "12/12" — so
               the strip does not shuffle sideways every time a file is
               ticked. -->
          <span class="count" style="min-width:calc({String(files).length * 2 + 1}ch + 12px)">
            {#if complete}
              <span class="tick">{@html TICK}</span>
            {:else}
              {#if count.done > 0}<b class="done">{count.done}</b><span class="sep">/</span>{/if}
              <span class="total">{count.total}</span>
            {/if}
          </span>
        </button>
      {/snippet}

      {@render tab(null, "Everything", null, total, "Every file in the change")}
      {#each chains as part (part.id)}
        {@render tab(
          part.id,
          nameOf(part.id),
          part.nodes,
          part.nodes.length,
          about(part.id, part.nodes.length),
        )}
      {/each}
      {#if loose && spare > 0}
        {@render tab(
          "loose",
          "on their own",
          loose.nodes,
          spare,
          "Files nothing else in the change calls",
        )}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* One tab per part of the change that can be read on its own. Drawn like the
     editor's own tabs rather than the forge's, because this is a place you come
     back to rather than a page you scroll.

     A lighter band between two darker ones — the pull request above, the canvas
     below — so the bars separate by tone rather than by a rule drawn between
     them. Holds the colour, and holds still. */
  .parts-rail { background: var(--strip); }
  .parts {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 0 10px;
    overflow-x: auto;
    /* No bar. A scrollbar under a row of tabs is a second thing to read in a
       strip whose whole job is to be read at a glance, and it appears and
       disappears with the pointer, which moves the tabs by a pixel as it does. */
    scrollbar-width: none;
  }
  .parts::-webkit-scrollbar { width: 0; height: 0; }
  /* What the bar was for, said by the tabs themselves: an edge with more beyond
     it fades out, and an edge with nothing beyond it does not. The mask is on
     the strip rather than drawn over it, so the fade is to whatever is behind —
     no colour to keep in step with the theme. */
  .parts.more-left {
    mask-image: linear-gradient(to right, transparent 0, #000 44px);
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 44px);
  }
  .parts.more-right {
    mask-image: linear-gradient(to left, transparent 0, #000 44px);
    -webkit-mask-image: linear-gradient(to left, transparent 0, #000 44px);
  }
  .parts.more-left.more-right {
    mask-image: linear-gradient(to right, transparent 0, #000 44px,
                                #000 calc(100% - 44px), transparent 100%);
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 44px,
                                        #000 calc(100% - 44px), transparent 100%);
  }
  .part-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 6px 12px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .part-tab:hover { color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); }
  /* The tab in front is filled rather than underlined. A rule along one edge is
     a hairline competing with the strip's own borders; a wash of the same blue
     the counts use says the same thing at a glance. */
  .part-tab.on {
    color: var(--text);
    background: color-mix(in srgb, var(--status-renamed) 26%, transparent);
  }
  .part-tab.on:hover {
    background: color-mix(in srgb, var(--status-renamed) 34%, transparent);
  }
  /* The count is the reason to pick one tab over another — how much work is
     behind it — so it is read, not glanced at. Gutter grey on a faint pill was
     two greys arguing with each other. */
  .count .done { color: var(--status-renamed); font-weight: 600; }
  .count {
    /* Centred by the box rather than by a line height guessed against the
       font's metrics, which sat the digits a pixel high in the pill. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    line-height: 1;
    /* The line box is centred exactly; the ink is not. Digits have no
       descenders, so half the font's descent is empty space under them and the
       numerals read as sitting high. One pixel down puts the ink in the middle,
       which is what the eye is measuring. */
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    min-width: 18px;
    text-align: center;
    color: color-mix(in srgb, var(--text) 72%, transparent);
    background: color-mix(in srgb, var(--text) 16%, transparent);
    border-radius: 999px;
    padding: 1px 6px 0;
  }
  .part-tab:hover .count { color: var(--text); }
  /* Everything in it has been read. */
  .count .tick {
    display: inline-flex;
    align-items: center;
    color: var(--status-renamed);
  }
  .part-tab.finished .count {
    background: color-mix(in srgb, var(--status-renamed) 22%, transparent);
  }
  /* On the tab in front the pill sits on blue already, so it darkens instead of
     colouring: blue on blue is a pill that has to be looked for. */
  .part-tab.on .count {
    color: var(--text);
    background: color-mix(in srgb, #000 34%, transparent);
  }
  .part-tab.on .count .done { color: var(--text); }
  .part-tab.on .count .tick { color: var(--added); }
</style>
