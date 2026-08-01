import { createHash } from "node:crypto";

import type { Edge, Endpoint, SymbolRef, Side } from "./types.js";

/** Short, stable, content-derived digest. Never a counter, never random. */
function digest(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex").slice(0, 12);
}

/**
 * Node ids key off the path alone, so the same file keeps the same id across
 * PR revisions. That is what lets the layout stay put between pushes.
 */
export function nodeId(path: string): string {
  return `n:${digest(path)}`;
}

export function symbolId(side: Side, name: string, startLine: number): string {
  return `s:${side}:${name}:${startLine}`;
}

function endpointKey(e: Endpoint): string {
  return [e.nodeId, e.side, e.line, e.column ?? "", e.symbolName ?? ""].join(":");
}

export function edgeId(
  from: Endpoint,
  to: Endpoint,
  kind: Edge["kind"],
): string {
  return `e:${digest(`${endpointKey(from)}|${endpointKey(to)}|${kind}`)}`;
}

/** Convenience for producers building symbol tables. */
export function makeSymbol(
  side: Side,
  name: string,
  kind: string,
  startLine: number,
  endLine: number,
  selectionLine = startLine,
): SymbolRef {
  return {
    id: symbolId(side, name, startLine),
    name,
    kind,
    side,
    startLine,
    endLine,
    selectionLine,
  };
}
