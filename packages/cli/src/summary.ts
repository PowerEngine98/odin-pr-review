import { describeGaps, type ChangeGraph, type FileStatus } from "@odin/core";

const BADGE: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  phantom: "~",
};

/** Terminal-friendly overview, used while iterating on fixtures. */
export function summarize(graph: ChangeGraph): string {
  const out: string[] = [];
  const { meta } = graph;

  out.push(`${meta.baseRef}...${meta.headRef}`);
  if (meta.mergeBase) out.push(`merge-base ${meta.mergeBase.slice(0, 12)}`);
  out.push("");

  for (const node of graph.nodes) {
    const rename = node.prevPath ? `  (was ${node.prevPath})` : "";
    const stats = node.binary
      ? "binary"
      : `+${node.stats.additions} -${node.stats.deletions}`;
    out.push(`${BADGE[node.status]}  ${node.path}${rename}    ${stats}`);
  }

  out.push("");
  out.push(`${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  // Say what nothing was able to read, so an absence of arrows is never
  // mistaken for an absence of relationships.
  const gaps = describeGaps(graph.meta.coverage);
  if (gaps) out.push(gaps);

  if (graph.edges.length > 0) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n.path]));
    out.push("");
    for (const edge of graph.edges) {
      const sign = edge.change === "added" ? "+" : edge.change === "removed" ? "-" : " ";
      out.push(
        `${sign} ${byId.get(edge.from.nodeId)}:${edge.from.line}` +
          ` -> ${byId.get(edge.to.nodeId)}:${edge.to.line}` +
          ` ${edge.to.symbolName ?? ""} [${edge.confidence}]`,
      );
    }
  }

  return out.join("\n") + "\n";
}
