import { host, notify } from "../state.svelte.js";

export interface GhSetup {
  ok: boolean;
  login?: string;
  problem?: "missing" | "signed-out";
  platform: string;
  install?: string;
  download: string;
  signIn: string;
  skipped: boolean;
}

export const GH_STEPS = ["Why", "Install", "Sign in", "Done"] as const;

export const ghWizard = $state({
  open: false,
  step: 0,
  status: null as GhSetup | null,
  asked: false,
  waiting: "" as "" | "install" | "signIn",
});

export const inEditor = typeof location !== "undefined" && location.protocol === "vscode-webview:";

let polling: ReturnType<typeof setInterval> | undefined;

export function checkGh(): void {
  if (host && inEditor) notify("ghSetup");
}

function stepFor(status: GhSetup): number {
  if (status.ok) return 3;
  if (status.problem === "signed-out") return 2;
  return ghWizard.step === 0 ? 0 : 1;
}

export function openGhWizard(): void {
  ghWizard.open = true;
  ghWizard.step = 0;
  checkGh();
}

export function closeGhWizard(skip: boolean): void {
  ghWizard.open = false;
  ghWizard.waiting = "";
  stopPolling();
  if (skip) notify("ghSkip");
}

export function goTo(step: number): void {
  ghWizard.step = Math.max(0, Math.min(GH_STEPS.length - 1, step));
}

function startPolling(): void {
  stopPolling();
  polling = setInterval(checkGh, 3_000);
}

function stopPolling(): void {
  if (polling) clearInterval(polling);
  polling = undefined;
}

export function installGh(): void {
  ghWizard.waiting = "install";
  notify("ghInstall");
  startPolling();
}

export function signInGh(): void {
  ghWizard.waiting = "signIn";
  notify("ghSignIn");
  startPolling();
}

export function startGhCheck(): void {
  if (!inEditor) return;
  ghWizard.asked = true;
  checkGh();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as ({ type?: string } & Partial<GhSetup>) | undefined;
    if (!message || typeof message.type !== "string") return;
    if (message.type === "ghWizard") {
      openGhWizard();
      return;
    }
    if (message.type !== "ghSetup") return;
    const status: GhSetup = {
      ok: message.ok === true,
      ...(message.login ? { login: message.login } : {}),
      ...(message.problem === "missing" || message.problem === "signed-out" ? { problem: message.problem } : {}),
      platform: String(message.platform ?? ""),
      ...(message.install ? { install: message.install } : {}),
      download: String(message.download ?? "https://cli.github.com/"),
      signIn: String(message.signIn ?? "gh auth login"),
      skipped: message.skipped === true,
    };
    const before = ghWizard.status;
    ghWizard.status = status;
    if (!ghWizard.open && !status.ok && !status.skipped && ghWizard.asked) {
      ghWizard.asked = false;
      ghWizard.open = true;
      ghWizard.step = 0;
      return;
    }
    ghWizard.asked = false;
    if (!ghWizard.open) return;
    const moved =
      (ghWizard.waiting === "install" && status.problem !== "missing") ||
      (ghWizard.waiting === "signIn" && status.ok);
    if (moved) {
      ghWizard.waiting = "";
      stopPolling();
      ghWizard.step = stepFor(status);
    } else if (!before && ghWizard.step === 0 && status.ok) {
      ghWizard.step = 3;
    }
  });
}
