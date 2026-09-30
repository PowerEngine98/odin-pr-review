import type { GraphMeta } from "@odin/core";

/**
 * The three ways a change can be read.
 *
 * `all` is the change as the forge will merge it. `since` is what the author
 * pushed after the reader's last review, which is what they come back to see
 * once their remarks have been answered. `uncommitted` is what the reader has
 * edited on this machine and not committed: the work in progress on top of a
 * branch whose commits they already know.
 */
export type View = "all" | "since" | "uncommitted";

/**
 * Which of them a reading is.
 *
 * Worked out from the graph rather than carried beside it, so that a tab, a
 * rebuild and a restored frame can never disagree about it. A reading that
 * starts at its own head, in the working tree, is the uncommitted work and
 * nothing else; one that starts anywhere else after the merge base starts at a
 * review.
 */
export function viewOf(meta: Pick<GraphMeta, "since" | "worktree" | "headSha">): View {
  if (!meta.since) return "all";
  return meta.worktree === true && meta.since === meta.headSha ? "uncommitted" : "since";
}

/**
 * What a reading is asked to start from when it is rebuilt.
 *
 * The uncommitted reading follows `HEAD` rather than the commit it started at:
 * a reader who commits some of their work has moved it out of "uncommitted",
 * and a picture pinned to the old head would go on showing it.
 */
export function sinceToAsk(
  meta: Pick<GraphMeta, "since" | "worktree" | "headSha">,
): string | undefined {
  const view = viewOf(meta);
  if (view === "uncommitted") return "HEAD";
  return view === "since" ? meta.since : undefined;
}

/** What a tab adds to its name, so a narrower reading is never taken for all. */
export function viewSuffix(meta: Pick<GraphMeta, "since" | "worktree" | "headSha">): string {
  const view = viewOf(meta);
  if (view === "uncommitted") return " (uncommitted)";
  if (view === "since") return ` (since ${meta.since!.slice(0, 7)})`;
  return "";
}

/**
 * Files of the whole change that also moved in a narrower view, and which one.
 *
 * Drawn as an orange dot on the card and the row, so the whole change can be
 * read with the news in it still findable.
 */
export interface Fresh {
  paths: string[];
  means: "uncommitted" | "review";
}
