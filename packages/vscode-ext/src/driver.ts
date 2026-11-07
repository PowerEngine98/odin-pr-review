import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";

import * as vscode from "vscode";

import { GraphPanel } from "./panel.js";

export interface DriveOpen {
  do: "open";
  owner: string;
  repo: string;
  number: number;
  base?: string;
  head?: string;
}

export type Drive =
  | DriveOpen
  | { do: "page"; step: Record<string, unknown>; timeout?: number }
  | { do: "command"; id: string; args?: unknown[] };

export class Driver implements vscode.Disposable {
  private watcher: FSWatcher | undefined;
  private busy = false;
  private readonly inbox: string;

  constructor(
    root: string,
    private readonly open: (step: DriveOpen) => Promise<boolean>,
  ) {
    this.inbox = join(root, "drive");
  }

  start(): void {
    try {
      mkdirSync(this.inbox, { recursive: true });
      this.watcher = watch(this.inbox, () => void this.drain());
      void this.drain();
    } catch {
      this.watcher = undefined;
    }
  }

  dispose(): void {
    this.watcher?.close();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const next = readdirSync(this.inbox)
          .filter((name) => /^\d+\.json$/.test(name))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))[0];
        if (!next) break;
        const path = join(this.inbox, next);
        let step: Drive | undefined;
        try {
          step = JSON.parse(readFileSync(path, "utf8")) as Drive;
        } catch {
          step = undefined;
        }
        rmSync(path, { force: true });
        const done = step ? await this.run(step).catch((error) => String(error)) : "unreadable";
        const answer = join(this.inbox, next.replace(".json", ".done"));
        if (!existsSync(answer)) writeFileSync(answer, JSON.stringify({ done }));
      }
    } finally {
      this.busy = false;
    }
  }

  private async run(step: Drive): Promise<boolean | string> {
    if (step.do === "open") return this.open(step);
    if (step.do === "page") return GraphPanel.drive(step.step, step.timeout);
    if (step.do === "command") {
      await vscode.commands.executeCommand(step.id, ...(step.args ?? []));
      return true;
    }
    return "unknown step";
  }
}
