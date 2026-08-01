import * as vscode from "vscode";

/**
 * Which files the reviewer has marked off, per repository and base.
 *
 * Kept out of the change graph on purpose: this is a note about the reader's
 * progress, not a fact about the change, and two people reviewing the same
 * branch have different answers. It is persisted per workspace so that closing
 * the panel — or the editor — does not lose a morning's reading.
 *
 * The key includes the base branch, since reviewing the same branch against a
 * different base is a different review.
 */
export class ViewedStore {
  private readonly memento: vscode.Memento;
  private readonly listeners = new Set<(paths: string[], viewed: boolean) => void>();

  private key = "";
  private marked = new Set<string>();

  constructor(memento: vscode.Memento) {
    this.memento = memento;
  }

  /** Points the store at one review. Call before reading or writing. */
  open(repo: string, baseRef: string, headRef: string): void {
    this.key = `odin.viewed:${repo}:${baseRef}:${headRef}`;
    this.marked = new Set(this.memento.get<string[]>(this.key, []));
  }

  has(path: string): boolean {
    return this.marked.has(path);
  }

  all(): string[] {
    return [...this.marked];
  }

  set(paths: readonly string[], viewed: boolean): void {
    for (const path of paths) {
      if (viewed) this.marked.add(path);
      else this.marked.delete(path);
    }
    void this.memento.update(this.key, [...this.marked]);
    for (const listener of this.listeners) listener([...paths], viewed);
  }

  /** Notifies every view except the one that made the change. */
  onDidChange(listener: (paths: string[], viewed: boolean) => void): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }
}
