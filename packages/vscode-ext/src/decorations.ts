import type { ChangeGraph } from "@odin/core";
import * as vscode from "vscode";

export const UNREADABLE_SCHEME = "odin-file";

/**
 * Marks the files Odin could not read.
 *
 * A tree item's description is plain text — the editor gives no way to colour
 * part of a row — so the warning is applied as a file decoration instead, which
 * is the same mechanism source control uses to tint modified files. It reaches
 * the row's label rather than its suffix, but it does the one thing that
 * matters: a blind spot is visibly a blind spot, not a quiet absence.
 */
export class UnreadableDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly changed = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;

  private unreadable = new Map<string, string>();

  setGraph(graph: ChangeGraph | undefined): void {
    this.unreadable = new Map(
      (graph?.nodes ?? [])
        .filter((node) => node.resolution === "unsupported")
        .map((node) => [node.path, node.language]),
    );
    this.changed.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== UNREADABLE_SCHEME) return undefined;

    const path = uri.path.replace(/^\//, "");
    const language = this.unreadable.get(path);
    if (!language) return undefined;

    return {
      badge: "!",
      tooltip: `Odin has no ${language} resolver, so this file has no references`,
      color: new vscode.ThemeColor("list.warningForeground"),
    };
  }
}

/** The identity a tree row uses to ask for a decoration. */
export function decorationUri(path: string): vscode.Uri {
  return vscode.Uri.from({ scheme: UNREADABLE_SCHEME, path: `/${path}` });
}
