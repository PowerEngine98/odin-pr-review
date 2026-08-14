import * as vscode from "vscode";

/**
 * How the reader likes to read, kept across everything.
 *
 * These are the reader's choices, not the change's: somebody who does not want
 * to see import arrows does not want to see them in the next pull request
 * either, or after a window reload, or in a different repository. So they are
 * held against the editor rather than against the workspace — `globalState`
 * rather than `workspaceState` — which is the difference between a preference
 * and a bookmark.
 *
 * Deliberately opaque here. The page owns what a setting means and what it
 * falls back to, and a host that knew the names would have to be taught each
 * new one; this only has to remember the answer it was given and hand it back.
 * A field the page has stopped using costs a few bytes and nothing else.
 */
const KEY = "odin.settings";

export class SettingsStore {
  constructor(private readonly memento: vscode.Memento) {}

  /**
   * What the reader last chose, or nothing if they never have.
   *
   * Never throws. This is read while a page is being built, and a preference is
   * not worth a blank panel: a host that cannot answer leaves the page on its
   * own defaults, which is exactly what a reader who has never opened the
   * settings gets anyway.
   */
  read(): Record<string, unknown> | undefined {
    let saved: unknown;
    try {
      saved = this.memento?.get<unknown>(KEY);
    } catch {
      return undefined;
    }
    // Anything else is a memento written by a version that meant something
    // different by this key, and the page's own defaults are a better answer
    // than a shape it will not understand.
    return saved !== null && typeof saved === "object"
      ? (saved as Record<string, unknown>)
      : undefined;
  }

  /** Remembers the page's answer, whatever it happens to contain. */
  async write(value: unknown): Promise<void> {
    if (value === null || typeof value !== "object") return;
    try {
      await this.memento?.update(KEY, value);
    } catch {
      /* a preference that will not stick is not worth an error to the reader */
    }
  }
}
