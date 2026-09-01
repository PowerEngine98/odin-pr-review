/**
 * Which folders in the tree the reader has shut.
 *
 * The tree is rebuilt from scratch whenever anything refreshes — the host
 * renders a new document and assigns it — and a folder's open state lived in
 * the component that drew it, so every rebuild threw it away and the whole tree
 * sprang back open. On a change with two hundred files that is a reader
 * scrolling past the same eleven directories they closed a minute ago, every
 * minute.
 *
 * What is recorded is the folders that are shut, not the ones that are open.
 * Folders start open because the point of the grouping is to show the shape of
 * the project, so the departures from that are what is worth keeping — and a
 * directory that appears in the tree for the first time after a rebuild opens,
 * rather than inheriting a state nobody chose for it.
 *
 * The reading and writing are here, apart from the reactive value that holds
 * them, because this is the part that can be wrong in a way nobody would see:
 * a key written by an older version, a path that collides with another, a
 * folder closed on one machine and reopened by a parse that quietly failed.
 */

/** Where it is kept. Session storage, which survives a rebuilt document. */
export const SHUT_KEY = "odin.sidebar.shut";

/** The shut folders, by path from the root. */
export type Shut = Record<string, true>;

/**
 * What was stored, read back.
 *
 * An open tree is the fallback for everything: a key somebody else wrote, one
 * from a version that stored it differently, a truncated write. None of those
 * is worth an error, and all of them are better answered by the state the tree
 * would have had anyway.
 */
export function readShut(held: string | null): Shut {
  if (!held) return {};
  try {
    const list = JSON.parse(held) as unknown;
    if (!Array.isArray(list)) return {};
    const out: Shut = {};
    for (const one of list) if (typeof one === "string" && one) out[one] = true;
    return out;
  } catch {
    return {};
  }
}

/** The same, as it goes back into storage. */
export function writeShut(shut: Shut): string {
  return JSON.stringify(Object.keys(shut).sort());
}

/** Whether a folder is showing what is under it. */
export function isOpen(shut: Shut, path: string): boolean {
  return shut[path] !== true;
}

/**
 * A folder opened, or shut.
 *
 * A new object rather than the same one changed: what holds this is reactive
 * state, and a record altered in place is a record nothing is watching.
 */
export function toggled(shut: Shut, path: string): Shut {
  const next = { ...shut };
  if (next[path]) delete next[path];
  else next[path] = true;
  return next;
}

/**
 * Where a folder is, which is what it is remembered by.
 *
 * Not its label. A change with `src/hooks` and `test/hooks` in it has two
 * folders called `hooks`, and shutting one would shut both.
 */
export function trailTo(trail: string, label: string): string {
  return trail ? `${trail}/${label}` : label;
}
