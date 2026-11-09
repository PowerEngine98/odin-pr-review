import * as vscode from "vscode";

/**
 * What Odin did when nobody was looking, in the editor's Output panel.
 *
 * A live reading rebuilds on its own, and a rebuild that fails or gives up says
 * so in the status bar for a few seconds — which is to say, to nobody. A reading
 * that has quietly stopped following the checkout looks exactly like one that
 * is right, so what it did is written down here to be read afterwards.
 *
 * Created on first use and never allowed to throw: an editor without an output
 * channel, a stub, is still an editor Odin works in.
 */
let channel: vscode.OutputChannel | undefined;

export function log(line: string): void {
  try {
    channel ??= vscode.window.createOutputChannel?.("Odin");
    channel?.appendLine(`${new Date().toISOString()}  ${line}`);
  } catch {
    // Nowhere to write it, which is not worth failing anything over.
  }
}
