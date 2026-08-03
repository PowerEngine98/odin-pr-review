/**
 * The editor's key-value store, as much of it as this needs.
 *
 * Structural rather than imported, so the rule about what counts as "already
 * read" can be exercised without an editor around it.
 */
export interface KeyValueStore {
  get<T>(key: string, fallback?: T): T | undefined;
  update(key: string, value: unknown): unknown;
}

/** What a pull request looked like the last time it was opened here. */
export interface Seen {
  /** The head commit that was read. */
  sha: string;
  /** When it was read, ISO-8601. */
  at: string;
}

/**
 * Which commit of a pull request this reviewer last read.
 *
 * A review is only finished until somebody pushes. The forge shows a pull
 * request as "approved" long after the branch it approved has moved on, and the
 * reviewer who approved it is the last person to find out — the list looks
 * exactly the same as it did when they closed it.
 *
 * So the head commit is written down when a review is opened, and the list
 * compares it against what the forge reports now. Per workspace, like the
 * viewed marks: this is a note about one reader's progress, not a fact about
 * the change.
 */
export class SeenStore {
  private readonly memento: KeyValueStore;

  constructor(memento: KeyValueStore) {
    this.memento = memento;
  }

  private key(repo: string, number: number): string {
    return `odin.seen:${repo}:${number}`;
  }

  /** What was read, or nothing if this pull request has never been opened. */
  get(repo: string, number: number): Seen | undefined {
    return this.memento.get<Seen>(this.key(repo, number));
  }

  /** Records the commit being read now. */
  mark(repo: string, number: number, sha: string, at: string): void {
    if (!sha) return;
    void this.memento.update(this.key(repo, number), { sha, at });
  }

  /**
   * Whether a pull request has moved since it was last read.
   *
   * Unknown counts as unchanged: a pull request nobody here has opened is new
   * rather than updated, and a badge saying otherwise on the whole list the
   * first time it is shown would say nothing at all.
   */
  movedOn(repo: string, number: number, head: string | undefined): boolean {
    if (!head) return false;
    const seen = this.get(repo, number);
    return seen !== undefined && seen.sha !== head;
  }
}
