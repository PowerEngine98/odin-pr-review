import * as vscode from "vscode";

import { conversationKey } from "./session.js";

/**
 * Which folder headers the reader has collapsed on the canvas, per change.
 *
 * Clustering draws a box per folder with a bar across its head, and a nested
 * folder's bar can be folded out of the stack. That is a reading decision, not a
 * fact about the change: it is how somebody chose to hold a large pull request
 * still while they read one corner of it, and closing the tab on Friday and
 * opening it again on Monday should not undo an afternoon of tidying.
 *
 * What is recorded is the folders that are *folded*, not the ones that are open.
 * Folders start open because the whole point of the grouping is to show the
 * shape of the project, so the departures from that are what is worth keeping —
 * and a folder that appears for the first time after a rebuild then opens rather
 * than inheriting a state nobody chose for it. The sidebar's own tree already
 * argues this in `shut.ts` and arrives at the same answer.
 *
 * Paths, never labels. A change touching `src/hooks` and `test/hooks` has two
 * folders called `hooks`, and folding one by its label would fold both.
 *
 * Per workspace rather than per editor, unlike the settings store beside it:
 * this is a note about one change in one repository, where a preference is about
 * the reader and follows them everywhere.
 */
export class FoldedStore {
  private readonly memento: vscode.Memento;

  private key = "";
  private collapsed = new Set<string>();

  constructor(memento: vscode.Memento) {
    this.memento = memento;
  }

  /**
   * Points the store at one reading. Call before reading or writing.
   *
   * Filed under what the *change* is, which is not what the tab is. `keyOf`
   * deliberately drops the branch for a live reading — a checkout holds one
   * HEAD, so there is one live picture of it — and that is the right answer to
   * "which tab is this" and the wrong one here. Folded folders are a note about
   * this change's folder shape, and reading a different branch live in the same
   * working tree gives different folders under the same tab name. Filed under
   * the tab's name, the first branch's folds came back over the second one's
   * canvas, collapsing directories the reader had never touched.
   *
   * The refs must be the ones the graph came out with rather than the ones the
   * reader asked for. Those two disagree often enough to matter — `HEAD~1` on
   * the way in, `main` on the way out — and a store keyed from one while the
   * page is built from the other quietly keeps two sets of folds for one
   * reading, of which the reader only ever sees one.
   */
  open(repo: string, baseRef: string, headRef: string, worktree?: boolean): void {
    this.key = `odin.folded:${conversationKey({
      repo,
      baseRef,
      headRef,
      ...(worktree === true ? { worktree: true } : {}),
    })}`;

    // Whatever is under that key is whatever some version of this wrote there,
    // so it is read as a list of paths and anything else is dropped. An empty
    // set is the state every folder starts in, which makes it a safe answer to
    // a stored value nobody here understands.
    const held = this.memento.get<unknown>(this.key);
    this.collapsed = new Set(
      Array.isArray(held)
        ? held.filter((one): one is string => typeof one === "string" && one !== "")
        : [],
    );
  }

  /**
   * The folded folders, sorted, which is how they go into the document.
   *
   * Sorted because the order says nothing — a set of folders has no first
   * member — and an order that wanders makes two identical states look like a
   * change to anything comparing them.
   */
  all(): string[] {
    return [...this.collapsed].sort();
  }

  /** One folder's bar folded out of the stack, or brought back into it. */
  set(path: string, folded: boolean): void {
    if (!path) return;
    if (folded) this.collapsed.add(path);
    else this.collapsed.delete(path);
    void this.memento.update(this.key, this.all());
  }
}
