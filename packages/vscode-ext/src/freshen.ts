/**
 * Which branches a reading is drawn from, when they belong to a remote.
 *
 * A reading of the forge's copy names its head as a tracking ref — `origin/topic`
 * — and a diff taken against that is only as current as the last fetch. Nothing
 * on the rebuilding path fetched: refreshing the tab, and reopening it after the
 * window came back, both re-read the same stale ref and drew the same picture.
 * What that looks like from the outside is pushing work and watching the graph
 * not change, which reads as the graph being broken rather than as the refs
 * being old.
 *
 * Not fetched on every rebuild, which is why this is a question rather than a
 * line in the builder. A live reading rebuilds whenever a watched file is saved,
 * and a fetch on each of those is a network call per keystroke-sized edit. The
 * two deliberate moments — the reader pressing refresh, and a tab being rebuilt
 * from scratch — are the ones that ask.
 *
 * Here rather than in the extension because the parsing is the part that can be
 * quietly wrong: a branch name may hold slashes, so `origin/feat/a/b` is one
 * remote and one branch and cannot be split on the first slash and hoped for.
 * The remotes this repository actually has are what settle it.
 */

/** As much of a reading as this needs: where its two ends came from. */
export interface Asked {
  baseRef?: string;
  headRef?: string;
}

/** A branch on a remote, as `git fetch` wants to be told it. */
export interface Remote {
  remote: string;
  branch: string;
}

/**
 * The remote and branch a ref names, or nothing when it names neither.
 *
 * The longest matching remote wins. One remote named `origin` and another named
 * `origin/mirror` is unusual and legal, and the shorter one would otherwise
 * claim every ref belonging to the longer.
 */
export function fromRemote(
  ref: string | undefined,
  remotes: readonly string[],
): Remote | null {
  if (!ref) return null;
  // A commit is already here or is not; either way there is no branch to ask a
  // remote for, and `git fetch origin <sha>` is a different and much slower
  // request than the one meant.
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return null;

  const name = ref.startsWith("refs/remotes/") ? ref.slice("refs/remotes/".length) : ref;
  if (name === "HEAD" || name === "") return null;

  let best: Remote | null = null;
  for (const remote of remotes) {
    if (!remote || !name.startsWith(`${remote}/`)) continue;
    const branch = name.slice(remote.length + 1);
    if (!branch) continue;
    if (!best || remote.length > best.remote.length) best = { remote, branch };
  }
  return best;
}

/**
 * Everything worth fetching before this reading is built again, grouped by
 * remote so each one is asked once.
 *
 * Both ends, not only the head. A change is a comparison, and a base branch
 * that has moved since the last fetch puts other people's landed work inside
 * somebody's change — the same staleness, read as the wrong fault entirely.
 */
export function toFetch(
  reading: Asked,
  remotes: readonly string[],
): { remote: string; branches: string[] }[] {
  const byRemote = new Map<string, string[]>();
  for (const ref of [reading.headRef, reading.baseRef]) {
    const found = fromRemote(ref, remotes);
    if (!found) continue;
    const branches = byRemote.get(found.remote) ?? [];
    if (!branches.includes(found.branch)) branches.push(found.branch);
    byRemote.set(found.remote, branches);
  }
  return [...byRemote].map(([remote, branches]) => ({ remote, branches }));
}
