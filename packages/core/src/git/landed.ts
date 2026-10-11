/**
 * Where to measure a working tree from, once its change has landed.
 *
 * A diff against a merge base answers "what does this branch add on top of
 * where it forked", which is the right question while a change is open: work
 * other people landed on the base since the fork is theirs, and measuring from
 * the tip would report all of it as missing from this branch.
 *
 * It is the wrong question the moment the change is merged. A forge that
 * squashes or rebases does not put the branch's commits on the base — it puts
 * their *content* there, under a new commit — so the branch tip stops being an
 * ancestor of anything and the fork point stays where it always was. Measured
 * from there, a reading of the files on disk replays the whole branch: eighty
 * files and three thousand lines, on a working tree that is byte for byte
 * identical to the base it was merged into, with nothing uncommitted in it.
 *
 * Which is exactly what was reported, and what the numbers said when it was
 * looked at: nothing at all against the base's tip, the entire change against
 * the fork point, and the base's tip being the squash of this very change.
 *
 * The commit the forge made is the answer, and it is the forge that has to say
 * so — there is no way to find it by walking local history, because the content
 * matches and nothing else does. Measured from it, a tree that has not moved
 * since the merge shows nothing, and one that has shows only what was done
 * after. Work other people landed afterwards stays out of it, which the base's
 * tip would not manage: that would report their files as missing from here.
 */

/** As much of a reading as this needs to know. */
export interface Landing {
  /**
   * Whether this is a reading of the files on disk.
   *
   * Only those. A reading of the forge's own copy of a merged change is a
   * record of what that change did, and the fork point is the right place to
   * measure that from — it is the diff the pull request itself shows.
   */
  live: boolean;
  /** What has become of the pull request: `OPEN`, `MERGED` or `CLOSED`. */
  state?: string;
  /** The commit the forge says carried this change onto its base. */
  mergeCommit?: string;
}

/**
 * The commit to measure from, or nothing to leave the merge base alone.
 *
 * Deliberately says nothing for a change that is merely closed. A closed change
 * was abandoned, so its content is not on the base and the fork point is still
 * where the comparison belongs — and a forge reports no merge commit for one,
 * so the guard below is belt as well as braces.
 */
export function landedAt(reading: Landing): string | undefined {
  if (!reading.live) return undefined;
  if (reading.state !== "MERGED") return undefined;
  const commit = reading.mergeCommit?.trim();
  return commit ? commit : undefined;
}
