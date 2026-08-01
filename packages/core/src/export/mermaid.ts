import type { ChangeGraph, EdgeChange, FileStatus } from "../model/types.js";

export interface MermaidOptions {
  /** Draw unchanged references. Off by default; they are visual noise. */
  includeUnchanged?: boolean;
  /** Include import edges. On by default. */
  includeImports?: boolean;
}

/** Mermaid class names, styled by the stylesheet emitted below. */
const NODE_CLASS: Record<FileStatus, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  phantom: "phantom",
};

const LINK_STYLE: Record<EdgeChange, string> = {
  added: "stroke:#4ade80,stroke-width:2px",
  removed: "stroke:#f87171,stroke-width:2px",
  unchanged: "stroke:#94a3b8,stroke-width:1px",
};

/**
 * Renders the graph as a Mermaid flowchart.
 *
 * Useful as a quick check on the graph's shape and as something to paste into a
 * pull request description, but it is not the product: Mermaid cannot show diff
 * lines inside a node or anchor an arrow to a specific line, which is the whole
 * point of the real renderer.
 */
export function toMermaid(graph: ChangeGraph, options: MermaidOptions = {}): string {
  const out: string[] = ["flowchart LR"];
  const alias = new Map<string, string>();

  graph.nodes.forEach((node, i) => {
    const id = `n${i}`;
    alias.set(node.id, id);
    const label = node.prevPath
      ? `${basename(node.path)}<br/><i>was ${basename(node.prevPath)}</i>`
      : basename(node.path);
    const stats =
      node.status === "phantom"
        ? "untouched"
        : `+${node.stats.additions} −${node.stats.deletions}`;
    out.push(`  ${id}["${label}<br/><small>${stats}</small>"]:::${NODE_CLASS[node.status]}`);
  });

  const edges = graph.edges.filter(
    (e) =>
      (options.includeUnchanged || e.change !== "unchanged") &&
      (options.includeImports !== false || e.kind !== "import"),
  );

  for (const edge of edges) {
    const from = alias.get(edge.from.nodeId);
    const to = alias.get(edge.to.nodeId);
    if (!from || !to) continue;
    const arrow = edge.change === "removed" ? "-.->" : "-->";
    out.push(`  ${from} ${arrow}|"${edge.to.symbolName ?? ""}"| ${to}`);
  }

  out.push("");
  out.push("  classDef added stroke:#4ade80,color:#4ade80,fill:transparent;");
  out.push("  classDef modified stroke:#e2c08d,color:#e2c08d,fill:transparent;");
  out.push("  classDef deleted stroke:#f87171,color:#f87171,fill:transparent;");
  out.push("  classDef renamed stroke:#60a5fa,color:#60a5fa,fill:transparent;");
  out.push(
    "  classDef phantom stroke:#6b7280,color:#6b7280,fill:transparent,stroke-dasharray:4 4;",
  );

  edges.forEach((edge, i) => {
    out.push(`  linkStyle ${i} ${LINK_STYLE[edge.change]};`);
  });

  return out.join("\n") + "\n";
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
