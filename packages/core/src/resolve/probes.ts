import type { ChangeGraph, FileNode, Side } from "../model/types.js";
import type { LineProbe } from "./types.js";

export interface ProbeOptions {
  /**
   * Also probe unchanged context lines. Off by default: a reviewer wants to see
   * what the change did, and probing context turns a five-file PR into a
   * hairball of pre-existing relationships.
   */
  includeContext?: boolean;
  /** Skip files whose language the resolver cannot handle. */
  languages?: string[];
}

/**
 * Works out which lines are worth asking the resolver about.
 *
 * Added lines are probed against the head checkout and deleted lines against
 * the base checkout, because a deleted line does not exist in head and cannot
 * be resolved there. This split is what lets removed edges be as trustworthy as
 * added ones instead of guesswork.
 */
export function collectProbes(
  graph: ChangeGraph,
  options: ProbeOptions = {},
): LineProbe[] {
  const languages = options.languages ? new Set(options.languages) : undefined;
  const probes: LineProbe[] = [];

  for (const node of graph.nodes) {
    if (node.binary || node.status === "phantom") continue;
    if (languages && !languages.has(node.language)) continue;

    for (const hunk of node.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "add" && line.newLine !== undefined) {
          probes.push({
            path: node.path, side: "head", line: line.newLine, changeKind: "add",
          });
        } else if (line.kind === "del" && line.oldLine !== undefined) {
          probes.push({
            path: basePath(node), side: "base", line: line.oldLine, changeKind: "del",
          });
        } else if (
          options.includeContext &&
          line.kind === "ctx" &&
          line.newLine !== undefined
        ) {
          probes.push({
            path: node.path, side: "head", line: line.newLine, changeKind: "ctx",
          });
        }
      }
    }
  }

  return dedupe(probes);
}

/** The path a node had on the base side, accounting for renames. */
export function basePath(node: FileNode): string {
  return node.prevPath ?? node.path;
}

/** The path a node has on the given side, or undefined if absent there. */
export function pathOnSide(node: FileNode, side: Side): string | undefined {
  if (side === "head") return node.status === "deleted" ? undefined : node.path;
  return node.status === "added" ? undefined : basePath(node);
}

function dedupe(probes: LineProbe[]): LineProbe[] {
  const seen = new Set<string>();
  const out: LineProbe[] = [];
  for (const p of probes) {
    const key = `${p.side}:${p.path}:${p.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort(
    (a, b) =>
      (a.side < b.side ? -1 : a.side > b.side ? 1 : 0) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.line - b.line,
  );
  return out;
}
