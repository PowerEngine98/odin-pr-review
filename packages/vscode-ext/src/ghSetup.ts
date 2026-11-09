import { execFile } from "node:child_process";

import { forgeEnv, ghAt, ghInstaller, ghManagers, ghStatus, GH_DOWNLOAD, GH_SIGN_IN, type GhStatus } from "@odin/core";
import * as vscode from "vscode";

export interface GhSetupState extends GhStatus {
  platform: string;
  install?: string;
  download: string;
  signIn: string;
  skipped: boolean;
}

let skipped = false;
let terminal: vscode.Terminal | undefined;

function present(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? ["where", [command]] : ["sh", ["-c", `command -v ${command}`]];
  return new Promise((resolve) => {
    execFile(probe[0] as string, probe[1] as string[], { env: forgeEnv(), timeout: 5_000 }, (error) => resolve(!error));
  });
}

export async function ghSetupState(cwd?: string): Promise<GhSetupState> {
  const status = await ghStatus(ghAt(cwd));
  const found = new Set<string>();
  if (!status.ok && status.problem === "missing") {
    const checks = await Promise.all(ghManagers(process.platform).map(async (one) => [one, await present(one)] as const));
    for (const [one, there] of checks) if (there) found.add(one);
  }
  const installer = ghInstaller(process.platform, (one) => found.has(one));
  return {
    ...status,
    platform: process.platform,
    ...(installer ? { install: installer.command } : {}),
    download: GH_DOWNLOAD,
    signIn: GH_SIGN_IN,
    skipped,
  };
}

export function skipGhSetup(): void {
  skipped = true;
}

export function unskipGhSetup(): void {
  skipped = false;
}

function inTerminal(command: string): void {
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({ name: "GitHub CLI setup", env: { PATH: forgeEnv().PATH } });
  }
  terminal.show();
  terminal.sendText(command);
}

export async function runGhInstall(cwd?: string): Promise<void> {
  const state = await ghSetupState(cwd);
  if (state.install) inTerminal(state.install);
  else void vscode.env.openExternal(vscode.Uri.parse(GH_DOWNLOAD));
}

export function runGhSignIn(): void {
  inTerminal(GH_SIGN_IN);
}
