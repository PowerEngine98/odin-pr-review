/**
 * A picture the host has read back, by the path it was written under.
 *
 * A webview cannot open a file on this machine — no `file://`, and the folder a
 * pasted screenshot lands in is nowhere near the extension's own — so the bytes
 * come back over the same channel everything else does, and the host decides
 * whether to hand them over at all.
 *
 * One cache for the page rather than one per box, because the same screenshot
 * is genuinely in three places at once: the thread it was pasted into, the log
 * of the agent that was asked about it, and the preview of the reply being
 * written. Each of those used to ask for itself, so the host read the same file
 * three times and sent three copies of a megabyte of base64 through a channel
 * that copies everything it is given.
 */
import { host, notify } from "./state.svelte.js";

/** Addresses a page can already draw, which need no host and no asking. */
const DRAWABLE = /^(data|blob|vscode-webview-resource|https):/i;

const state = $state<{ pictures: Record<string, string> }>({ pictures: {} });

/** Asked for once each: a refusal is an answer, and asking again gets it again. */
const asking = new Set<string>();

let hearing = false;

/**
 * Something to draw for this path, once there is something to draw.
 *
 * Nothing on the first call for a path on disk — the answer is a message away
 * — so whatever is drawing it must have something to show meanwhile, or
 * nothing at all. Nothing for ever means the host would not serve it, which is
 * as much of an answer as the page is going to get.
 */
export function pictured(src: string): string | undefined {
  if (!src) return undefined;
  if (DRAWABLE.test(src)) return src;
  const held = state.pictures[src];
  if (held) return held;
  if (host && !asking.has(src)) {
    asking.add(src);
    hear();
    notify("showImage", { path: src });
  }
  return undefined;
}

/**
 * The one ear for the answers, opened when there is a first question.
 *
 * At module scope it would run while the page is being rendered to text on the
 * server, where there is no window to listen on. It is never closed again
 * because the cache it fills is the page's and outlives every panel that reads
 * it — a listener removed when the last terminal was folded away would leave
 * the pictures of the next one unanswered.
 */
function hear(): void {
  if (hearing || typeof window === "undefined") return;
  hearing = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (!message || message.type !== "imageShown") return;
    if (typeof message.path !== "string") return;
    // Nothing back is the host refusing, and it is left uncached on purpose:
    // the path stays a path nobody can draw, which is what the caller shows.
    if (typeof message.data === "string" && message.data) {
      state.pictures = { ...state.pictures, [message.path]: message.data };
    }
  });
}
