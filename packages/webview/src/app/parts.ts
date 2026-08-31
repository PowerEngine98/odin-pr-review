/**
 * Which files belong to the part that is open.
 *
 * Asked in two places that must not disagree: the strip, when a reader presses
 * a tab, and the rebuild, when the same part has just been worked out again
 * from a graph that has moved. Both are answering the question the list beside
 * the canvas asks — "which files am I showing?" — and a strip that filtered by
 * one rule while a rebuild filtered by another would leave the two panes
 * showing different halves of the same change.
 *
 * `null` means the whole change: either nothing is narrowed, or what was
 * narrowed to is gone. Those are the same answer to the list and a different
 * one to the strip, which is why the caller checks the id itself.
 */
export function partPaths(
  model: {
    nodes: readonly { id: string; path: string }[];
    parts?: readonly { id: string; nodes: readonly string[] }[];
  },
  part: string | null,
): string[] | null {
  if (!part) return null;
  const open = (model.parts ?? []).find((p) => p.id === part);
  if (!open) return null;

  const paths = new Map(model.nodes.map((node) => [node.id, node.path]));
  return open.nodes
    .map((id) => paths.get(id))
    .filter((path): path is string => path !== undefined);
}
