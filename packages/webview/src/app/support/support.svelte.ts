import { host, notify } from "../state.svelte.js";

export type SupportKind = "bug" | "suggestion" | "feature";

export const SUPPORT_NEW_ISSUE = "https://github.com/PowerEngine98/odin-pr-review/issues/new";

export const support = $state({
  open: false,
  sending: false,
  gh: null as null | { ok: boolean; login?: string; version?: string; problem?: "missing" | "signed-out" | "outdated" },
  error: "",
});

export const odinLog = $state({
  open: false,
  loading: false,
  clean: true,
  raw: "",
  anonymized: "",
});

export function openLog(clean = true): void {
  odinLog.open = true;
  odinLog.clean = clean;
  odinLog.loading = true;
  if (host) notify("odinLog");
}

export function closeLog(): void {
  odinLog.open = false;
}

export interface Toast {
  id: number;
  text: string;
  url?: string;
}

export const toasts = $state({ list: [] as Toast[] });

let toastIds = 0;

export function toast(text: string, url?: string): void {
  const id = ++toastIds;
  toasts.list = [...toasts.list, { id, text, ...(url ? { url } : {}) }];
  setTimeout(() => dismiss(id), 15_000);
}

export function dismiss(id: number): void {
  toasts.list = toasts.list.filter((one) => one.id !== id);
}

export function openSupport(): void {
  support.open = true;
  support.error = "";
  support.gh = null;
  if (host) notify("supportStatus");
}

export function closeSupport(): void {
  support.open = false;
  support.sending = false;
}

export function openLink(url: string): void {
  if (host) notify("openExternal", { url });
  else window.open(url, "_blank", "noopener");
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string; url?: string; note?: string; error?: string; problem?: string; ok?: boolean; login?: string; version?: string };
    if (!message || typeof message.type !== "string") return;
    if (message.type === "odinLog") {
      const said = event.data as { raw?: unknown; clean?: unknown };
      odinLog.raw = typeof said.raw === "string" ? said.raw : "";
      odinLog.anonymized = typeof said.clean === "string" ? said.clean : "";
      odinLog.loading = false;
      return;
    }
    if (message.type === "supportStatus") {
      support.gh = {
        ok: message.ok === true,
        ...(message.login ? { login: message.login } : {}),
        ...(message.version ? { version: message.version } : {}),
        ...(message.problem === "missing" || message.problem === "signed-out" || message.problem === "outdated"
          ? { problem: message.problem }
          : {}),
      };
    } else if (message.type === "supportPosted" && message.url) {
      support.sending = false;
      support.open = false;
      toast(message.note ? `Issue posted on GitHub. ${message.note}` : "Issue posted on GitHub", message.url);
    } else if (message.type === "supportFailed") {
      support.sending = false;
      if (message.problem === "missing" || message.problem === "signed-out" || message.problem === "outdated") {
        support.gh = { ok: false, problem: message.problem };
      } else {
        support.error = message.error ?? "GitHub did not take the issue.";
      }
    }
  });
}
