import type { GraphLayout, PlacedEdge, PlacedNode } from "../layout/layout.js";
import { cardTitle, type DisplayRow } from "../layout/display.js";
import { fitText, rowOffset, textCapacity } from "../layout/layout.js";
import { DARK_THEME, type Theme } from "../layout/theme.js";
import type { EdgeChange } from "../model/types.js";

export interface SvgOptions {
  theme?: Theme;
  /** Draw arrows for references that were already there. */
  includeUnchanged?: boolean;
  /** Draw import edges. */
  includeImports?: boolean;
}

/**
 * Renders a laid-out graph as a standalone SVG.
 *
 * Shares the layout engine with the interactive renderer, so this is not a
 * simplified preview: it is the same picture, frozen. That makes it usable as a
 * regression test for the layout and as something to attach to a pull request.
 */
export function toSvg(layout: GraphLayout, options: SvgOptions = {}): string {
  const theme = options.theme ?? DARK_THEME;
  const { metrics } = layout;

  const edges = layout.edges.filter(
    (e) =>
      (options.includeUnchanged || e.edge.change !== "unchanged") &&
      (options.includeImports !== false || e.edge.kind !== "import"),
  );

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" ` +
      `height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" ` +
      `font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
  );
  parts.push(defs(theme));
  parts.push(
    `<rect width="${layout.width}" height="${layout.height}" fill="${theme.background}"/>`,
  );

  // Cards first: arrows must read as passing over the canvas, not under it.
  for (const node of layout.nodes) parts.push(card(node, theme, metrics, layout.unified));
  for (const edge of edges) parts.push(arrow(edge, theme));

  parts.push("</svg>");
  return parts.join("\n");
}

function defs(theme: Theme): string {
  const marker = (name: EdgeChange) =>
    `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.change[name]}"/></marker>`;
  return `<defs>${marker("added")}${marker("removed")}${marker("unchanged")}</defs>`;
}

function card(
  node: PlacedNode,
  theme: Theme,
  metrics: GraphLayout["metrics"],
  unified: boolean,
): string {
  const stroke = theme.status[node.node.status];
  const dashed = node.node.status === "phantom" ? ` stroke-dasharray="6 5"` : "";
  const parts: string[] = [`<g>`];

  parts.push(
    `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" ` +
      `rx="14" fill="${theme.cardBackground}" stroke="${stroke}" ` +
      `stroke-width="1.5"${dashed}/>`,
  );

  const title = cardTitle(node.node);
  const heading = [title.name, title.was, title.stats, title.note]
    .filter(Boolean)
    .join("  ");
  const y = node.y + metrics.titleHeight - 12;

  if (title.additions || title.deletions) {
    // One text element with coloured spans, so the counts read like the diff.
    const lead = [title.name, title.was].filter(Boolean).join("  ");
    const tail = title.note ? `  ${title.note}` : "";
    parts.push(
      `<text x="${node.x + node.width / 2}" y="${y}" ` +
        `font-size="${metrics.fontSize + 1}" text-anchor="middle">` +
        `<tspan fill="${stroke}">${escape(lead)}  </tspan>` +
        (title.additions
          ? `<tspan fill="${theme.change.added}">${escape(title.additions)}</tspan>`
          : "") +
        (title.additions && title.deletions
          ? `<tspan fill="${theme.mutedText}"> </tspan>`
          : "") +
        (title.deletions
          ? `<tspan fill="${theme.change.removed}">${escape(title.deletions)}</tspan>`
          : "") +
        `<tspan fill="${theme.warning}">${escape(tail)}</tspan></text>`,
    );
  } else {
    parts.push(
      `<text x="${node.x + node.width / 2}" y="${y}" ` +
        `fill="${stroke}" font-size="${metrics.fontSize + 1}" text-anchor="middle">` +
        `${escape(heading)}</text>`,
    );
  }

  // A card is two panes wide — the base of the change beside the head of it —
  // unless the file exists on one side only, which needs one.
  const panes =
    unified || node.node.status === "added" || node.node.status === "deleted" ? 1 : 2;
  const paneWidth = (node.width - metrics.padding * 2) / panes;
  const capacity = textCapacity(node.width, metrics, panes);

  node.pairs.slice(0, node.visibleRows).forEach((pair, i) => {
    const y = node.y + rowOffset(i, metrics) + metrics.fontSize / 2 - 2;
    const row = pair.band;

    if (row) {
      // A banded row, the way a diff viewer marks the part of a file it is not
      // showing. The header keeps the hidden region attributable.
      parts.push(
        `<rect x="${node.x + 2}" y="${node.y + rowOffset(i, metrics) - metrics.lineHeight / 2}" ` +
          `width="${node.width - 4}" height="${metrics.lineHeight}" ` +
          `fill="${theme.gapBackground}"/>`,
      );
      parts.push(
        `<text x="${node.x + metrics.padding}" y="${y}" fill="${theme.mutedText}" ` +
          `font-size="${metrics.fontSize - 1}">${escape(row.text)}</text>`,
      );
      if (row.header) {
        parts.push(
          `<text x="${node.x + node.width - metrics.padding}" y="${y}" ` +
            `fill="${theme.gutter}" font-size="${metrics.fontSize - 2}" ` +
            `text-anchor="end">${escape(row.header)}</text>`,
        );
      }
      return;
    }

    // One side of the row. Each pane carries its own marker, line number and
    // code, so the number beside a line is always that line's own.
    const pane = (side: DisplayRow | undefined, index: number): void => {
      const x = node.x + metrics.padding + index * paneWidth;
      const top = node.y + rowOffset(i, metrics) - metrics.lineHeight / 2;

      if (!side || side.kind === "gap") {
        parts.push(
          `<rect x="${x}" y="${top}" width="${paneWidth}" ` +
            `height="${metrics.lineHeight}" fill="${theme.gapBackground}" opacity="0.35"/>`,
        );
        return;
      }

      if (side.kind !== "ctx") {
        parts.push(
          `<rect x="${x}" y="${top}" width="${paneWidth}" ` +
            `height="${metrics.lineHeight}" fill="${theme.lineBackground[side.kind]}"/>`,
        );
      }

      const colour =
        side.kind === "add"
          ? theme.change.added
          : side.kind === "del"
            ? theme.change.removed
            : theme.text;
      const marker = side.kind === "add" ? "+" : side.kind === "del" ? "\u2212" : " ";

      // Unified keeps the plus on the head side, beside the number the added
      // line actually has; everything else marks from the left.
      if (!(unified && side.kind === "add")) {
        parts.push(
          `<text x="${x}" y="${y}" fill="${theme.gutter}" ` +
            `font-size="${metrics.fontSize}">${marker}</text>`,
        );
      }

      // The number belongs to the side it is drawn beside: base on the left
      // pane, head on the right. A one-sided file has one numbering and one
      // pane to show it in.
      const line = panes === 1
        ? side.newLine ?? side.oldLine
        : index === 0 ? side.oldLine : side.newLine;
      if (line !== undefined && !unified) {
        parts.push(
          `<text x="${x + metrics.gutterWidth - 8}" y="${y}" ` +
            `fill="${theme.gutter}" font-size="${metrics.fontSize - 1}" ` +
            `text-anchor="end">${line}</text>`,
        );
      }
      // One column of code has a gutter either side of it, the base number on
      // the left and the head number on the right.
      if (unified) {
        if (side.oldLine !== undefined) {
          parts.push(
            `<text x="${node.x + metrics.padding + metrics.lineNumberRight}" y="${y}" ` +
              `fill="${theme.gutter}" font-size="${metrics.fontSize - 1}" ` +
              `text-anchor="end">${side.oldLine}</text>`,
          );
        }
        if (side.newLine !== undefined) {
          parts.push(
            `<text x="${node.x + node.width - metrics.padding - 14}" y="${y}" ` +
              `fill="${theme.gutter}" font-size="${metrics.fontSize - 1}" ` +
              `text-anchor="end">${side.newLine}</text>`,
          );
        }
        if (side.kind === "add") {
          parts.push(
            `<text x="${node.x + node.width - metrics.padding - 10}" y="${y}" ` +
              `fill="${theme.gutter}" font-size="${metrics.fontSize}">+</text>`,
          );
        }
      }

      parts.push(
        `<text x="${x + metrics.gutterWidth}" y="${y}" fill="${colour}" ` +
          `font-size="${metrics.fontSize}" xml:space="preserve">` +
          `${escape(fitText(side.text, capacity))}</text>`,
      );
    };

    if (panes === 1) pane(pair.right ?? pair.left, 0);
    else {
      pane(pair.left, 0);
      pane(pair.right, 1);
    }
  });

  if (node.hiddenRows > 0) {
    const y = node.y + rowOffset(node.visibleRows, metrics);
    parts.push(
      `<rect x="${node.x + 2}" y="${y - metrics.lineHeight / 2}" ` +
        `width="${node.width - 4}" height="${metrics.lineHeight}" ` +
        `fill="${theme.gapBackground}"/>`,
    );
    parts.push(
      `<text x="${node.x + node.width / 2}" y="${y + metrics.fontSize / 2 - 2}" ` +
        `fill="${theme.mutedText}" font-size="${metrics.fontSize - 1}" ` +
        `text-anchor="middle">${node.hiddenRows} more lines</text>`,
    );
  }

  parts.push("</g>");
  return parts.join("");
}

function arrow(placed: PlacedEdge, theme: Theme): string {
  const colour = theme.change[placed.edge.change];
  const dash = placed.edge.kind === "import" ? ` stroke-dasharray="4 4"` : "";

  // A horizontal-tangent cubic keeps the arrow leaving and arriving square to
  // the card border, which reads as "this line points at that line".
  const dx = Math.max(40, Math.abs(placed.to.x - placed.from.x) * 0.45);
  const c1 = placed.fromSide === "right" ? placed.from.x + dx : placed.from.x - dx;
  const c2 = placed.toSide === "left" ? placed.to.x - dx : placed.to.x + dx;

  const d =
    `M ${placed.from.x} ${placed.from.y} ` +
    `C ${c1} ${placed.from.y}, ${c2} ${placed.to.y}, ${placed.to.x} ${placed.to.y}`;

  return (
    `<path d="${d}" fill="none" stroke="${colour}" stroke-width="1.8"${dash} ` +
    `marker-end="url(#arrow-${placed.edge.change})" opacity="0.9"/>`
  );
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
