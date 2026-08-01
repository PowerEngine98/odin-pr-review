import { join } from "node:path";

import type { ChangeGraph, Side } from "@odin/core";

/** Where a click should send the reviewer, expressed without any editor API. */
export interface Destination {
  /** `file` for the working tree, `base` for the merge-base revision. */
  kind: "file" | "base";
  /** Absolute path for `file`, repository-relative for `base`. */
  path: string;
  /** Commit to read from; only set for `base`. */
  sha?: string;
  /** 1-based line to reveal. */
  line: number;
}

/**
 * Decides what following a reference should open.
 *
 * The subtlety is that a removed reference points at code that no longer exists
 * in the working tree, and a deleted file has no working-tree copy at all.
 * Sending either to a `file://` URI would open the wrong content or nothing.
 */
export function destinationFor(
  graph: ChangeGraph,
  repo: string,
  path: string,
  line: number,
  side: Side,
): Destination {
  const node = graph.nodes.find((n) => n.path === path);
  const mergeBase = graph.meta.mergeBase;

  // Anything on the base side, and anything in a file that head no longer has,
  // has to be read out of git rather than off disk.
  const historical = side === "base" || node?.status === "deleted";

  if (historical && mergeBase) {
    return {
      kind: "base",
      path: node?.prevPath ?? path,
      sha: mergeBase,
      line,
    };
  }

  return { kind: "file", path: join(repo, path), line };
}

/** The two sides to show when a reviewer opens a file as a diff. */
export interface DiffTargets {
  base?: { path: string; sha: string };
  head?: string;
  title: string;
}

export function diffTargetsFor(
  graph: ChangeGraph,
  repo: string,
  path: string,
): DiffTargets {
  const node = graph.nodes.find((n) => n.path === path);
  const mergeBase = graph.meta.mergeBase;
  const title = `${path} (${graph.meta.baseRef} ↔ ${graph.meta.headRef})`;

  // A file the diff never mentioned has no interesting base side, and an added
  // file has no base side at all; both are just opened.
  if (!node || !mergeBase || node.status === "phantom" || node.status === "added") {
    return { head: join(repo, path), title };
  }

  const base = { path: node.prevPath ?? node.path, sha: mergeBase };
  if (node.status === "deleted") return { base, title };
  return { base, head: join(repo, path), title };
}
