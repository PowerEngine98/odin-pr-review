import * as vscode from "vscode";

/**
 * Which review was on screen, so that it can be again.
 *
 * A window reload throws away every webview in it. Odin's is not cheap to
 * rebuild — a diff read, every reference resolved, a layout computed — so
 * losing it costs the reader the several seconds it took to arrive and, worse,
 * the place they had got to. Reloading is not a rare event either: it is what
 * the editor asks for after installing an extension, changing a setting, or
 * recovering from almost anything.
 *
 * What is kept is the question, not the answer. The graph itself is derived
 * from the repository and would be stale the moment anyone committed; the refs
 * that produced it stay true, and rebuilding from them gives a picture of the
 * change as it is now rather than as it was when the window closed.
 */
export interface Session {
  repo: string;
  /** The ref the change is measured against, when one was chosen. */
  baseRef?: string;
  /** What was being read. Absent means the branch this checkout holds. */
  headRef?: string;
  /** The reading included work that had not been committed. */
  worktree?: boolean;
  /** The pull request it belonged to, for the title while it rebuilds. */
  number?: number;
  /** ISO-8601, so a session nobody has returned to can be judged stale. */
  at: string;
}

/**
 * What makes two readings the same reading.
 *
 * Shared with the panel registry on purpose: a frame the editor hands back
 * after a reload has to be matched to the question that filled it, and the two
 * sides agreeing on what "the same reading" means is the whole of that match.
 * Undefined joins as empty, which is what a reading with no chosen base is.
 */
export function keyOf(reading: {
  repo: string;
  baseRef?: string;
  headRef?: string;
  worktree?: boolean;
}): string {
  return [
    reading.repo,
    reading.baseRef,
    reading.headRef,
    reading.worktree === true ? "live" : "committed",
  ].join("\u0000");
}

const KEY = "odin.session";

/**
 * Every reading that was on screen, rather than only the last one.
 *
 * There is one tab per reading now, and a reload throws away all of them. The
 * single slot this used to be answered for whichever was opened most recently,
 * so a reviewer comparing two changes came back to one of them and no sign
 * that the other had ever existed.
 */
const KEYS = "odin.sessions";

/**
 * How many are worth bringing back.
 *
 * Each one is a diff read and every reference in it resolved. A reviewer with
 * a dozen tabs open has them open for a reason, but rebuilding a dozen graphs
 * on a window reload is a minute of a machine doing nothing else, and the
 * oldest of them is the one least likely to be why they reloaded.
 */
const HELD = 6;

/**
 * How long a remembered review is worth reopening.
 *
 * A reload is measured in seconds and a lunch break in hours. Beyond a day the
 * branch has almost certainly moved on, and reopening a week-old review
 * unasked — rebuilding a graph, taking the editor's foreground — is the tool
 * deciding what the reader came here to do.
 */
const STALE_AFTER = 24 * 60 * 60 * 1000;

export class SessionStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** Records what is on screen. Called whenever a graph is shown. */
  remember(session: Omit<Session, "at">): void {
    const fresh: Session = { ...session, at: new Date().toISOString() };
    void this.memento.update(KEY, fresh);

    /*
     * Kept alongside the single slot rather than instead of it.
     *
     * The old key is what a copy of this extension one version behind reads,
     * and the two run against the same stored state whenever somebody rolls
     * back. Writing both costs a string; writing only the list would give that
     * copy a reader with no session at all and no way to say why.
     */
    const key = keyOf(fresh);
    const rest = this.readings().filter((held) => keyOf(held) !== key);
    void this.memento.update(KEYS, [fresh, ...rest].slice(0, HELD));
  }

  /**
   * Every reading worth reopening, most recently shown first.
   *
   * Order is the order they will come back in, which matters: the reader gets
   * the one they were last looking at first, and the rest arrive behind it
   * while they are already reading.
   */
  readings(): Session[] {
    const held = this.memento.get<Session[]>(KEYS);
    const list = Array.isArray(held) ? held : [];
    const worth = list
      .map((session) => this.worthReopening(session))
      .filter((session): session is Session => session !== undefined);
    if (worth.length > 0) return worth;

    // Nothing in the list, which is what every window that last ran an older
    // build looks like. The one it did record is still a reading.
    const single = this.last();
    return single ? [single] : [];
  }

  /** Forgets one reading, for a reader who closed that tab on purpose. */
  forget(key: string): void {
    const rest = this.readings().filter((held) => keyOf(held) !== key);
    void this.memento.update(KEYS, rest);
    if (rest.length === 0) void this.memento.update(KEY, undefined);
  }

  /** What was on screen, if it is still worth reopening. */
  last(): Session | undefined {
    return this.worthReopening(this.memento.get<Session>(KEY));
  }

  private worthReopening(session: Session | undefined): Session | undefined {
    if (!session?.repo) return undefined;

    const age = Date.now() - Date.parse(session.at);
    if (!Number.isFinite(age) || age > STALE_AFTER) return undefined;

    /*
     * A base worth reopening against.
     *
     * `HEAD~4` was a perfectly good answer at the moment it was written down
     * and means something else by the next commit: it is measured from wherever
     * `HEAD` now is. Replaying one silently compares the change against a point
     * nobody chose, and what that looks like is other people's work appearing
     * inside the reader's branch — which is unreadable as a stale session.
     *
     * A branch name keeps its meaning. Anything else is dropped, and the base
     * is worked out afresh from the pull request, which is the answer that was
     * wanted anyway.
     */
    if (session.baseRef && !/^[\w.\-/]+$/.test(session.baseRef)) {
      const { baseRef: _dropped, ...rest } = session;
      return rest;
    }
    return session;
  }

  /** Forgets everything, for a reader who closed the panels on purpose. */
  clear(): void {
    void this.memento.update(KEY, undefined);
    void this.memento.update(KEYS, undefined);
  }
}
