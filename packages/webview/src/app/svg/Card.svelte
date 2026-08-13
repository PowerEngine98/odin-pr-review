<!--
  One file's card, drawn out of SVG's own shapes.

  The card the page shows is HTML — divs for the rows, spans for the coloured
  runs inside them — and none of that is legal inside an SVG root without a
  foreignObject around it. A foreignObject is only ever rendered by something
  that already has a full HTML engine, which rules out every consumer this
  target exists for: GitHub shows an SVG through an img tag, and librsvg and
  resvg, which is most of what turns one into a PNG, drop the element on the
  floor. A reviewer opening the attachment would get the cards' outlines and
  nothing inside them.

  So this card is the simplified one, in rects and text elements, and the
  simplification is deliberate rather than a shortcut: the static export already
  made this choice once, and it made it correctly. What is lost is the syntax
  colouring and the coloured runs within a line; what is kept is every line the
  card shows, its marker, its number and the band standing in for what was
  folded away — which is what the picture is for.

  Colours are written onto the shapes rather than left to the stylesheet. A
  presentation attribute is honoured by everything that renders SVG at all,
  where a style element is honoured by rather less.
-->
<script lang="ts">
  import type { FileStatus, LayoutMetrics, Theme } from "@odin/core";

  import type { NodeView } from "../model.js";
  import type { CardFace, DrawnCell } from "./card.js";

  let {
    node,
    face,
    metrics,
    ink,
    unified,
  }: {
    node: NodeView;
    face: CardFace;
    metrics: LayoutMetrics;
    ink: Theme;
    /** One column of code, with a gutter either side of it, rather than two. */
    unified: boolean;
  } = $props();

  /** A card's outline says what happened to the file, in the file list's colours. */
  const stroke = $derived(ink.status[node.status as FileStatus] ?? ink.mutedText);

  const paneWidth = $derived((node.width - metrics.padding * 2) / face.panes);

  /** Where the heading's baseline falls inside the title bar. */
  const titleY = $derived(node.y + metrics.titleHeight - 12);

  /**
   * The heading, as the coloured pieces it is written in.
   *
   * Worked out here rather than laid out in the markup because the pieces have
   * to touch: whitespace between two elements inside a text element is text,
   * and the renderer will put a space there whether or not the heading wanted
   * one. An array has no gaps in it to leak.
   */
  const heading = $derived.by(() => {
    const { name, was, stats, additions, deletions, note } = face.title;
    // Nothing to colour, so the whole heading is one piece in the card's own
    // colour. A file the change never touched says "untouched" here.
    if (!additions && !deletions) {
      return [{ text: [name, was, stats, note].filter(Boolean).join("  "), fill: stroke }];
    }

    const pieces = [{ text: `${[name, was].filter(Boolean).join("  ")}  `, fill: stroke }];
    // The counts carry the diff's own colours, so the header reads at a glance
    // rather than being read.
    if (additions) pieces.push({ text: additions, fill: ink.change.added });
    if (additions && deletions) pieces.push({ text: " ", fill: ink.mutedText });
    if (deletions) pieces.push({ text: deletions, fill: ink.change.removed });
    if (note) pieces.push({ text: `  ${note}`, fill: ink.warning });
    return pieces;
  });

  const colourOf = (cell: DrawnCell): string =>
    cell.kind === "add"
      ? ink.change.added
      : cell.kind === "del"
        ? ink.change.removed
        : ink.text;

  /**
   * The number a pane's gutter shows.
   *
   * The base on the left and the head on the right, so the number beside a line
   * is always that line's own. A one-pane card has a single numbering and
   * prefers the head's: the base only survives alone on a file the change
   * deleted.
   */
  const numberOf = (cell: DrawnCell, pane: number): number | undefined =>
    face.panes === 1 ? cell.head ?? cell.base : pane === 0 ? cell.base : cell.head;

  const marker = (cell: DrawnCell): string =>
    cell.kind === "add" ? "+" : cell.kind === "del" ? "−" : " ";
</script>

<g>
  <rect
    x={node.x}
    y={node.y}
    width={node.width}
    height={node.height}
    rx="14"
    fill={ink.cardBackground}
    {stroke}
    stroke-width="1.5"
    stroke-dasharray={node.status === "phantom" ? "6 5" : null}
  />

  <!--
    The heading. One text element with coloured pieces inside it rather than
    several placed side by side, because only the renderer knows how wide each
    piece is: laying them out by hand means measuring a font this side has never
    seen, and the counts then drift away from the name at every size.
  -->
  <text
    x={node.x + node.width / 2}
    y={titleY}
    font-size={metrics.fontSize + 1}
    text-anchor="middle"
    >{#each heading as piece, index (index)}<tspan fill={piece.fill}>{piece.text}</tspan
      >{/each}</text
  >

  {#each face.rows as row, index (index)}
    {#if row.band}
      <!--
        A band, the way a diff viewer marks the part of a file it is not
        showing. It spans the whole card rather than a pane, because the run it
        stands in for is missing from both sides. The header keeps the hidden
        region attributable to a declaration.
      -->
      <rect
        x={node.x + 2}
        y={node.y + row.top}
        width={node.width - 4}
        height={metrics.lineHeight}
        fill={ink.gapBackground}
      />
      <text
        x={node.x + metrics.padding}
        y={node.y + row.y}
        fill={ink.mutedText}
        font-size={metrics.fontSize - 1}>{row.band.text}</text
      >
      {#if row.band.header}
        <text
          x={node.x + node.width - metrics.padding}
          y={node.y + row.y}
          fill={ink.gutter}
          font-size={metrics.fontSize - 2}
          text-anchor="end">{row.band.header}</text
        >
      {/if}
    {:else}
      {@render pane(row.left, 0, node.y + row.top, node.y + row.y)}
      {#if face.panes === 2}
        {@render pane(row.right, 1, node.y + row.top, node.y + row.y)}
      {/if}
    {/if}
  {/each}

  <!--
    What the card is holding back. The layout engine caps a card's height so one
    five-hundred-line file cannot set the scale of the whole drawing, and a
    reader has to be told that the bottom of a card is not the bottom of a file.
  -->
  {#if face.more}
    <rect
      x={node.x + 2}
      y={node.y + face.more.top}
      width={node.width - 4}
      height={metrics.lineHeight}
      fill={ink.gapBackground}
    />
    <text
      x={node.x + node.width / 2}
      y={node.y + face.more.y}
      fill={ink.mutedText}
      font-size={metrics.fontSize - 1}
      text-anchor="middle">{face.more.text}</text
    >
  {/if}
</g>

<!--
  One side of one row: its background, its marker, its number and its code.

  Each pane carries its own gutter so that the number beside a line is that
  line's own — which is the whole reason a card is drawn two panes wide rather
  than as one stream with two files' numbering interleaved down it.
-->
{#snippet pane(cell: DrawnCell | undefined, index: number, top: number, y: number)}
  {@const x = node.x + metrics.padding + index * paneWidth}
  {#if !cell}
    <!-- Nothing on this side of the row. Faint rather than empty: a blank the
         same colour as the card reads as a rendering fault, and this is a real
         statement — the other side has a line here and this one does not. -->
    <rect
      {x}
      y={top}
      width={paneWidth}
      height={metrics.lineHeight}
      fill={ink.gapBackground}
      opacity="0.35"
    />
  {:else}
    {#if cell.kind !== "ctx"}
      <rect
        {x}
        y={top}
        width={paneWidth}
        height={metrics.lineHeight}
        fill={ink.lineBackground[cell.kind]}
      />
    {/if}

    <!-- Unified keeps the plus over on the head side, beside the number the
         added line actually has; everything else marks from the left. -->
    {#if !(unified && cell.kind === "add")}
      <text {x} {y} fill={ink.gutter} font-size={metrics.fontSize}>{marker(cell)}</text>
    {/if}

    {#if unified}
      <!-- One column of code has a gutter either side of it: where this line
           is in the base checkout on the left, where it is in the head on the
           right. Either can be empty, for a line only one side has. -->
      {#if cell.base !== undefined}
        <text
          x={node.x + metrics.padding + metrics.lineNumberRight}
          {y}
          fill={ink.gutter}
          font-size={metrics.fontSize - 1}
          text-anchor="end">{cell.base}</text
        >
      {/if}
      {#if cell.head !== undefined}
        <text
          x={node.x + node.width - metrics.padding - 14}
          {y}
          fill={ink.gutter}
          font-size={metrics.fontSize - 1}
          text-anchor="end">{cell.head}</text
        >
      {/if}
      {#if cell.kind === "add"}
        <text
          x={node.x + node.width - metrics.padding - 10}
          {y}
          fill={ink.gutter}
          font-size={metrics.fontSize}>+</text
        >
      {/if}
    {:else}
      {@const line = numberOf(cell, index)}
      {#if line !== undefined}
        <text
          x={x + metrics.gutterWidth - 8}
          {y}
          fill={ink.gutter}
          font-size={metrics.fontSize - 1}
          text-anchor="end">{line}</text
        >
      {/if}
    {/if}

    <!-- The line itself. Space is preserved because indentation is most of what
         makes a diff readable, and a renderer collapses runs of it by default
         the way HTML does. -->
    <text
      x={x + metrics.gutterWidth}
      {y}
      fill={colourOf(cell)}
      font-size={metrics.fontSize}
      xml:space="preserve">{cell.text}</text
    >
  {/if}
{/snippet}
