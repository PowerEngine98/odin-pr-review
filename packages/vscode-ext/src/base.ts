import * as vscode from "vscode";

/**
 * A base branch this reader picked for this repository.
 *
 * Kept here rather than written into the workspace's settings, which is where
 * it used to go. That put `odin.baseRef` into `.vscode/settings.json` — a file
 * most repositories commit — so one person answering "review against which
 * base?" once wrote a permanent instruction for everybody who cloned it, and
 * for every change any of them ever looked at.
 *
 * What that looks like from the inside is not a setting. It is other people's
 * merged work appearing inside your branch, months later, with nothing
 * anywhere connecting the two. The answer was worth remembering; the place was
 * wrong.
 *
 * Per workspace and per machine: a choice about how to read this repository is
 * this reader's, and it never travels with the code.
 */
const KEY = "odin.base";

export class BaseStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** What this reader last chose here, if they ever did. */
  read(): string | undefined {
    let saved: unknown;
    try {
      saved = this.memento?.get<unknown>(KEY);
    } catch {
      return undefined;
    }
    return typeof saved === "string" && saved.length > 0 ? saved : undefined;
  }

  /** Remembers it, so the next review does not ask again. */
  async write(ref: string): Promise<void> {
    try {
      await this.memento?.update(KEY, ref);
    } catch {
      /* a preference that will not stick is not worth an error to the reader */
    }
  }
}
