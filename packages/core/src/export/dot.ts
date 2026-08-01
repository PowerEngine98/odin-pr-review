import type { ChangeGraph, EdgeChange, FileStatus } from "../model/types.js";

const NODE_COLOR: Record<FileStatus, string> = {
  added: "#4ade80",
  modified: "#e2c08d",
  deleted: "#f87171",
  renamed: "#60a5fa",
  phantom: "#6b7280",
};

const EDGE_COLOR: Record<EdgeChange, string> = {
  added: "#4ade80",
  removed: "#f87171",
  unchanged: "#94a3b8",
};

export interface DotOptions {
  includeUnchanged?: boolean;
  includeImports?: boolean;
}

/**
 * Renders the graph as Graphviz DOT, for pipelines that already consume it and
 * for laying the graph out with `dot` when a second opinion on structure is
 * useful.
 */
export function toDot(graph: ChangeGraph, options: DotOptions = {}): string {
  const out: string[] = [
    "digraph odin {",
    "  bgcolor=\"#111111\";",
    "  rankdir=LR;",
    "  node [shape=box style=rounded fontname=\"Helvetica\" fontsize=11];",
    "  edge [fontname=\"Helvetica\" fontsize=9];",
    "",
  ];

  for (const node of graph.nodes) {
    const color = NODE_COLOR[node.status];
    const stats =
      node.status === "phantom"
        ? "untouched"
        : `+${node.stats.additions} -${node.stats.deletions}`;
    const label = `${escape(node.path)}\\n${stats}`;
    const dashed = node.status === "phantom" ? ",dashed" : "";
    out.push(
      `  "${node.id}" [label="${label}" color="${color}" fontcolor="${color}" style="rounded${dashed}"];`,
    );
  }

  out.push("");

  for (const edge of graph.edges) {
    if (!options.includeUnchanged && edge.change === "unchanged") continue;
    if (options.includeImports === false && edge.kind === "import") continue;
    const style = edge.change === "removed" ? "dashed" : "solid";
    out.push(
      `  "${edge.from.nodeId}" -> "${edge.to.nodeId}" ` +
        `[label="${escape(edge.to.symbolName ?? "")}" ` +
        `color="${EDGE_COLOR[edge.change]}" ` +
        `fontcolor="${EDGE_COLOR[edge.change]}" style="${style}"];`,
    );
  }

  out.push("}");
  return out.join("\n") + "\n";
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
