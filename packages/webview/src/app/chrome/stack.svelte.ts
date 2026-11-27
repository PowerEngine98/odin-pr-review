import type { PullRequestSummary } from "@odin/core";

import { host, notify } from "../state.svelte.js";

export interface StackView {
  pulls: PullRequestSummary[];
  base: string;
  at: number;
}

export const stack = $state({ view: null as StackView | null, asked: false });

export function askStack(): void {
  if (!host) return;
  stack.asked = true;
  notify("askStack");
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string; stack?: StackView | null };
    if (message?.type !== "stack") return;
    const view = message.stack;
    stack.view = view && Array.isArray(view.pulls) && view.pulls.length > 1 ? view : null;
  });
}
