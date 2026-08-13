<!--
  The change as one SVG root, with no page around it.

  This is what `odin --format svg` writes and what gets attached to a pull
  request: the cards, the arrows and the schema marks, and none of the chrome.
  A bar, a tab strip, a minimap and a composer are all things to press, and a
  file on disk has nothing behind them — a picture full of dead controls is
  worse than one that never offered them.

  It routes its own arrows rather than borrowing the canvas's layers. The
  routing itself is shared — `wire.ts` is pure arithmetic and both sides call
  it, so the two can never disagree about where an arrow goes — but the layers
  that draw it are built for a page: they sit in absolutely positioned roots,
  carry hit areas twelve pixels wider than the line, and paint from CSS custom
  properties that only exist once a stylesheet has run. None of that survives
  being opened as a file.
-->
<script lang="ts" module>
  /**
   * The typeface, named the way it has to be named outside a browser.
   *
   * A page can say `font-family: var(--mono)` and let a stylesheet answer. A
   * file opened on its own has no stylesheet and, in a converter, no web fonts
   * and no notion of `ui-monospace` either — so the stack is written onto the
   * root as a presentation attribute, every entry in it is a face that is
   * already on the machine, and the last entry is the generic that every
   * renderer in the world resolves to something fixed-width.
   */
  const FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";
</script>

<script lang="ts">
  import type { EdgeChange } from "@odin/core";

  import { arrangementFor, arrows, isSchema } from "../canvas/wire.js";
  import type { ViewModel } from "../model.js";
  import type { Drawn } from "./card.js";
  import Card from "./Card.svelte";

  let { model, drawn }: { model: ViewModel; drawn: Drawn } = $props();

  /**
   * How this drawing is read, as far as the arrows are concerned.
   *
   * A file cannot be filtered once it has been written, so the only two of
   * these anybody gets a say in are the two the command line asks about, and
   * the rest are set to show everything. Least of all the reader's own notes:
   * hiding a card because whoever produced the file had ticked it off would
   * carry one person's progress into everybody else's copy.
   */
  const reading = $derived({
    unified: model.unified,
    showTests: true,
    showImports: drawn.includeImports,
    showUnchanged: drawn.includeUnchanged,
    showInfra: true,
    hideViewed: false,
    part: null,
    viewed: new Set<string>(),
  });

  const drawnArrows = $derived(arrows({ model, reading }));

  const arrangement = $derived(arrangementFor(model, reading));

  /**
   * The mark a schema card wears, and where it goes.
   *
   * Above the card rather than inside it, because a card clips its own contents
   * — the same reason the page keeps these in a layer of their own.
   */
  const schemaMarks = $derived(
    model.nodes
      .filter((node) => isSchema(node.path))
      .flatMap((node) => {
        const box = arrangement.nodes[node.id];
        return box
          ? [{ id: node.id, x: Math.round(box.x + box.width / 2 - 22), y: Math.round(box.y - 46) }]
          : [];
      }),
  );

  const changes: EdgeChange[] = ["added", "removed", "unchanged"];

  const colourOf = (change: string, schema: boolean): string =>
    schema
      ? drawn.ink.status.renamed
      : drawn.ink.change[change as EdgeChange] ?? drawn.ink.change.unchanged;

  /**
   * The palette and the card geometry, as custom properties on the root.
   *
   * The drawing itself does not read these — every colour it paints with is
   * written onto the shape that uses it, which is the only thing a renderer
   * that ignores stylesheets will honour. They are here for the components'
   * own compiled styles, which are inlined beside them and which do read them:
   * a scoped rule added to anything in this tree has to find its variables
   * somewhere, and outside a page there is nowhere else to look.
   */
  const palette = $derived(
    [
      `svg{`,
      `--bg:${drawn.ink.background};`,
      `--card-bg:${drawn.ink.cardBackground};`,
      `--text:${drawn.ink.text};`,
      `--muted:${drawn.ink.mutedText};`,
      `--gutter:${drawn.ink.gutter};`,
      `--gap-bg:${drawn.ink.gapBackground};`,
      `--warning:${drawn.ink.warning};`,
      `--added:${drawn.ink.change.added};`,
      `--removed:${drawn.ink.change.removed};`,
      `--unchanged:${drawn.ink.change.unchanged};`,
      `--add-bg:${drawn.ink.lineBackground.add};`,
      `--del-bg:${drawn.ink.lineBackground.del};`,
      `--status-added:${drawn.ink.status.added};`,
      `--status-modified:${drawn.ink.status.modified};`,
      `--status-deleted:${drawn.ink.status.deleted};`,
      `--status-renamed:${drawn.ink.status.renamed};`,
      `--status-phantom:${drawn.ink.status.phantom};`,
      `--line-height:${drawn.metrics.lineHeight}px;`,
      `--font-size:${drawn.metrics.fontSize}px;`,
      `--title-height:${drawn.metrics.titleHeight}px;`,
      `--padding:${drawn.metrics.padding}px;`,
      `--mono:${FONT};`,
      `}`,
    ].join(""),
  );
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={model.width}
  height={model.height}
  viewBox="0 0 {model.width} {model.height}"
  font-family={FONT}
>
  <!--
    A style element written the long way round. Svelte reads the contents of a
    plain `<style>` tag as raw text — that is how a component declares its own
    styles — so the only way to put something computed inside one is to build
    the element rather than to write it.
  -->
  <svelte:element this={"style"}>{@html `${palette}${drawn.css}`}</svelte:element>

  <defs>
    <!-- Sized in the drawing's own units rather than in stroke widths, and cut
         to the same length the routing takes off the end of each stem. A head
         that scaled with the stroke would leave that cut in the wrong place,
         with the line poking out past the triangle. -->
    {#each changes as change (change)}
      <marker
        id="arrow-{change}"
        viewBox="0 0 10 10"
        refX="10"
        refY="5"
        markerUnits="userSpaceOnUse"
        markerWidth="13"
        markerHeight="13"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill={drawn.ink.change[change]} />
      </marker>
    {/each}
  </defs>

  <rect width={model.width} height={model.height} fill={drawn.ink.background} />

  <!-- Cards first, then the arrows over them: an arrow has to read as passing
       across the canvas rather than under the cards it joins. -->
  {#each model.nodes as node (node.id)}
    {@const face = drawn.cards[node.id]}
    {#if face}
      <Card {node} {face} metrics={drawn.metrics} ink={drawn.ink} unified={model.unified} />
    {/if}
  {/each}

  {#each drawnArrows as arrow (arrow.edge.id)}
    {@const colour = colourOf(arrow.edge.change, arrow.schema)}
    {@const faded = arrow.schema ? 0.55 : arrow.edge.kind === "import" ? 0.5 : 0.85}
    {@const dash = arrow.edge.kind === "import" ? "4 4" : null}
    <g>
      <path
        d={arrow.stem}
        fill="none"
        stroke={colour}
        stroke-width="1.8"
        stroke-dasharray={dash}
        opacity={faded}
      />
      <!-- The road onwards, when several references to one place were gathered
           into one and this is the arrow carrying it. Empty on an arrow that
           travels alone, which is most of them. -->
      {#if arrow.trunk}
        <path
          d={arrow.trunk}
          fill="none"
          stroke={colour}
          stroke-width="1.8"
          stroke-dasharray={dash}
          opacity={faded}
        />
      {/if}
      <!-- Carries the head and nothing else: the stem already stopped where
           this begins, so drawing along it would show as a lump at the join. -->
      {#if arrow.head}
        <path d={arrow.head} fill="none" stroke="none" marker-end="url(#arrow-{arrow.edge.change})" />
      {/if}
      <!-- The two dots: where the reference leaves, and where it lands. On the
           page they are the way there and the way back; here they are what says
           which line an arrow belongs to when a card is dense with them. Filled
           with the background rather than left hollow, so the wire behind does
           not show through the ring. -->
      <circle
        cx={arrow.wire.port.x}
        cy={arrow.wire.port.y}
        r="4.5"
        fill={drawn.ink.background}
        stroke={colour}
        stroke-width="2.5"
        opacity="0.9"
      />
      <circle
        cx={arrow.wire.home.x}
        cy={arrow.wire.home.y}
        r="4.5"
        fill={drawn.ink.background}
        stroke={colour}
        stroke-width="2.5"
        opacity="0.65"
      />
    </g>
  {/each}

  <!-- A card whose rows are tables is not a file, and the fastest way to say so
       is the shape everybody already reads as a database. A nested root rather
       than a transform, so the glyph's own coordinates stay the ones it was
       drawn in. -->
  {#each schemaMarks as mark (mark.id)}
    <svg
      x={mark.x}
      y={mark.y}
      width="44"
      height="38"
      viewBox="0 0 48 42"
      fill="none"
      stroke={drawn.ink.status.renamed}
      stroke-width="1.7"
      opacity="0.75"
    >
      <ellipse cx="24" cy="9" rx="17" ry="6.6" />
      <path d="M7 9v23c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6V9" />
      <path d="M7 17c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6" />
      <path d="M7 25c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6" />
    </svg>
  {/each}
</svg>
