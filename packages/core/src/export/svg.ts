import type { GraphLayout, PlacedEdge, PlacedNode } from "../layout/layout.js";
import { rowOffset } from "../layout/layout.js";
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
  for (const node of layout.nodes) parts.push(card(node, theme, metrics));
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

function card(node: PlacedNode, theme: Theme, metrics: GraphLayout["metrics"]): string {
  const stroke = theme.status[node.node.status];
  const dashed = node.node.status === "phantom" ? ` stroke-dasharray="6 5"` : "";
  const parts: string[] = [`<g>`];

  parts.push(
    `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" ` +
      `rx="14" fill="${theme.cardBackground}" stroke="${stroke}" ` +
      `stroke-width="1.5"${dashed}/>`,
  );

  const title = node.node.prevPath
    ? `${basename(node.path)} ← ${basename(node.node.prevPath)}`
    : basename(node.path);
  parts.push(
    `<text x="${node.x + node.width / 2}" y="${node.y + metrics.titleHeight - 12}" ` +
      `fill="${stroke}" font-size="${metrics.fontSize + 1}" text-anchor="middle">` +
      `${escape(title)}</text>`,
  );

  const textX = node.x + metrics.padding + metrics.gutterWidth;
  node.rows.forEach((row, i) => {
    const y = node.y + rowOffset(i, metrics) + metrics.fontSize / 2 - 2;

    if (row.kind === "gap") {
      parts.push(
        `<text x="${textX}" y="${y}" fill="${theme.mutedText}" ` +
          `font-size="${metrics.fontSize - 1}">${escape(row.text)}</text>`,
      );
      return;
    }

    if (row.kind !== "ctx") {
      parts.push(
        `<rect x="${node.x + 2}" y="${node.y + rowOffset(i, metrics) - metrics.lineHeight / 2}" ` +
          `width="${node.width - 4}" height="${metrics.lineHeight}" ` +
          `fill="${theme.lineBackground[row.kind]}"/>`,
      );
    }

    const colour =
      row.kind === "add"
        ? theme.change.added
        : row.kind === "del"
          ? theme.change.removed
          : theme.text;
    const marker = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
    const number = row.newLine ?? row.oldLine;

    parts.push(
      `<text x="${node.x + metrics.padding}" y="${y}" fill="${theme.gutter}" ` +
        `font-size="${metrics.fontSize}">${marker}</text>`,
    );
    if (number !== undefined) {
      parts.push(
        `<text x="${node.x + metrics.padding + metrics.lineNumberRight}" y="${y}" ` +
          `fill="${theme.gutter}" font-size="${metrics.fontSize - 1}" ` +
          `text-anchor="end">${number}</text>`,
      );
    }
    parts.push(
      `<text x="${textX}" y="${y}" fill="${colour}" ` +
        `font-size="${metrics.fontSize}" xml:space="preserve">${escape(row.text)}</text>`,
    );
  });

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

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
