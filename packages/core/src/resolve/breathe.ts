/**
 * Letting the editor answer for itself in the middle of a long piece of work.
 *
 * Resolving the references in a change is the slow half of a build: tens of
 * thousands of lines, each asked what it points at, and every one of them
 * synchronous. Written as a plain loop it holds the extension host from the
 * first probe to the last — an `async` function whose body never awaits is one
 * unbroken block — and everything that reaches the reader in that time is
 * queued behind it: the progress it is reporting, the messages it is sending to
 * its own page, and the editor's own health check, which eventually decides the
 * window is not responding and offers to close it.
 *
 * The work is the same work; what changes is that it is done in slices. Between
 * slices the host runs its queue, which is where being responsive lives.
 */

/**
 * How many probes to answer before letting anything else run.
 *
 * A probe is a fraction of a millisecond, so a slice of two hundred is a few
 * milliseconds of work — under a frame, which is the scale at which nobody can
 * tell the difference. Smaller would be a yield per probe, which spends more
 * time scheduling than resolving; larger and a slice is long enough to be felt.
 */
export const SLICE = 200;

/**
 * Hands the event loop back, once.
 *
 * `setImmediate` rather than a promise: resolving one only reaches the
 * microtask queue, which the same synchronous block drains before anything else
 * gets a turn — so awaiting it looks like yielding and is not. A macrotask is
 * the boundary the host's own work is scheduled on.
 */
export function breathe(): Promise<void> {
  return new Promise((go) => setImmediate(go));
}
