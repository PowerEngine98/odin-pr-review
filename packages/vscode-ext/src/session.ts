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

const KEY = "odin.session";

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
    void this.memento.update(KEY, {
      ...session,
      at: new Date().toISOString(),
    } satisfies Session);
  }

  /** What was on screen, if it is still worth reopening. */
  last(): Session | undefined {
    const session = this.memento.get<Session>(KEY);
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

  /** Forgets it, for a reader who closed the panel on purpose. */
  clear(): void {
    void this.memento.update(KEY, undefined);
  }
}
