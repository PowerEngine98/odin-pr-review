/**
 * The page the panel shows while it has no graph in it.
 *
 * Kept apart from the panel because it is a string, not an editor: it can be
 * built, read and tested without a window, and looked at in a browser while it
 * is being designed.
 */
export interface WaitingPage {
  /** The Odin mark as SVG markup, sized by the page rather than by the file. */
  mark: string;
  /** What is being waited for, or what happened instead. */
  note: string;
  /** Whether the mark breathes. Still once the answer is in. */
  pulsing: boolean;
  /** The nonce the panel's content policy allows. */
  nonce: string;
  /** What the webview will serve images from. */
  cspSource: string;
}

/**
 * The mark, centred, breathing while the change is read.
 *
 * Building a graph means reading a diff, resolving every reference in it and
 * laying the result out — several seconds on a large change, in which an editor
 * otherwise looks like it did nothing at all. A spinner would say a machine is
 * busy; the tool's own face says this tool is thinking, which is the truer
 * statement and the one worth making in the panel the reader is watching.
 *
 * Stops rather than spins away when there is nothing to show: an animation
 * carrying on underneath a sentence saying the build found nothing reads as a
 * page still working.
 */
export function waitingPage(options: WaitingPage): string {
  const { mark, note, pulsing, nonce, cspSource } = options;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
    `img-src ${cspSource} data:; style-src 'nonce-${nonce}'; ` +
    `script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    background: var(--vscode-editor-background, #0d1117);
    color: var(--vscode-descriptionForeground, #8b949e);
    font-family: var(--vscode-font-family, ui-monospace, Menlo, monospace);
    font-size: 13px;
  }
  .mark {
    width: 104px;
    height: 104px;
    color: var(--vscode-foreground, #e6edf3);
  }
  .mark svg { width: 100%; height: 100%; display: block; }
  ${pulsing
    ? `.mark { animation: breathe 1.7s ease-in-out infinite; }`
    : `.mark { opacity: 0.4; }`}
  @keyframes breathe {
    0%, 100% { opacity: 0.3; transform: scale(0.93); }
    50%      { opacity: 1;   transform: scale(1.04); }
  }
  /* Someone who has asked the machine to stop moving things has asked this
     too. The mark still says which tool is waiting. */
  @media (prefers-reduced-motion: reduce) {
    .mark { animation: none; opacity: 0.7; }
  }
  .note { min-height: 1.2em; letter-spacing: 0.02em; text-align: center; }
</style></head><body>
<div class="mark">${mark}</div>
<div class="note" id="note"></div>
<script nonce="${nonce}">
  var note = document.getElementById("note");
  note.textContent = ${JSON.stringify(note)};
  // Each step of the build renames the wait rather than restarting it: setting
  // the page again would drop the animation back to its first frame.
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "note") note.textContent = event.data.message;
  });
</script></body></html>`;
}

/**
 * The activity-bar drawing, ready to be dropped into a page.
 *
 * The file is drawn for a 24px slot and carries a comment explaining itself;
 * neither belongs in a 104px loader, and the size has to come off the element
 * for the CSS box to have any say.
 */
export function pageMark(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    .trim();
}
