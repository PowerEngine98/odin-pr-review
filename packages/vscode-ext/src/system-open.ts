import { execFile } from "node:child_process";

export function systemOpener(platform: NodeJS.Platform, file: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [file] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", file] };
  return { command: "xdg-open", args: [file] };
}

export function openWithSystem(file: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const { command, args } = systemOpener(platform, file);
  return new Promise((settle) => {
    execFile(command, args, { timeout: 15_000, windowsHide: true }, (error) => settle(!error));
  });
}
