<!--
  The mark a schema card wears.

  A card whose rows are tables is not a file, and the fastest way to say so is
  the shape everybody already reads as a database. Drawn beside the card rather
  than inside it, since a card clips its own contents — which is also why this
  is a layer of its own and not something a card renders: it has to be outside
  every card's box to be visible at all.

  Placed from the same arrangement the arrows are routed against, so a mark
  follows its card through a filter or a change of reading rather than being put
  somewhere once and left there.
-->
<script lang="ts">
  import { model, settings, ui } from "../state.svelte.js";
  import { arrangementFor, cssId, isSchema, type Box } from "./wire.js";

  let {
    boxes,
  }: {
    /** Where the cards actually are, when something has placed them. */
    boxes?: Record<string, Box>;
  } = $props();

  const arrangement = $derived(
    arrangementFor(model.current, {
      unified: settings.unified,
      showTests: settings.showTests,
      showImports: settings.showImports,
      showUnchanged: settings.showUnchanged,
      showInfra: settings.showInfra,
      hideViewed: settings.hideViewed,
      part: ui.part,
      viewed: ui.viewed,
    }),
  );

  const part = $derived(
    ui.part ? new Set(model.current.parts.find((p) => p.id === ui.part)?.nodes ?? []) : null,
  );

  /**
   * The marks that have a card to sit above.
   *
   * A mark whose card is filtered away is left out rather than hidden: it is
   * the only thing on the canvas that names the database, and one floating over
   * empty space reads as a card that failed to draw.
   */
  const marks = $derived.by(() => {
    if (!settings.showInfra) return [];
    const found: { id: string; box: Box }[] = [];
    for (const node of model.current.nodes) {
      if (!isSchema(node.path)) continue;
      if (part && !part.has(node.id)) continue;
      const box = boxes?.[node.id] ?? arrangement.nodes[node.id];
      if (box) found.push({ id: node.id, box });
    }
    return found;
  });
</script>

{#each marks as mark (mark.id)}
  <!-- Named after its card by the same rule the cards are, so the two can be
       found together by anything that has one of them. -->
  <div
    class="schema-mark"
    id="schema-{cssId(mark.id)}"
    data-id={mark.id}
    style="left:{Math.round(mark.box.x + mark.box.width / 2 - 22)}px;top:{Math.round(
      mark.box.y - 46,
    )}px"
  >
    <svg viewBox="0 0 48 42" width="44" height="38" aria-hidden="true">
      <ellipse cx="24" cy="9" rx="17" ry="6.6" />
      <path d="M7 9v23c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6V9" />
      <path d="M7 17c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6" />
      <path d="M7 25c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6" />
    </svg>
  </div>
{/each}

<style>
  /* Sized and placed in canvas units, so it travels with the drawing rather
     than floating over it: the canvas is one transformed layer, and a mark
     given screen units would drift off its card at every zoom. */
  .schema-mark {
    position: absolute;
    color: var(--status-renamed);
    opacity: 0.75;
    /* It says what the card is; it is not something to press, and catching a
       click here would take one away from the card underneath. */
    pointer-events: none;
  }

  .schema-mark svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
  }
</style>
