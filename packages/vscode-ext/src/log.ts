import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

const KEPT = 2000;
const lines: string[] = [];

export function log(line: string): void {
  const stamped = `${new Date().toISOString()}  ${line}`;
  lines.push(stamped);
  if (lines.length > KEPT) lines.splice(0, lines.length - KEPT);
  try {
    channel ??= vscode.window.createOutputChannel?.("Odin");
    channel?.appendLine(stamped);
  } catch {
  }
}

export function logText(last = KEPT): string {
  return lines.slice(-last).join("\n");
}
