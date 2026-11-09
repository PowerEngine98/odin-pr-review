import type { AgentKind } from "@odin/core";

import type { Pty, PtyOptions } from "./pty.js";

export const SCROLLBACK = 512 * 1024;

export interface CliHost {
  repo(): string;
  kind(agentId: string): (AgentKind & { path?: string }) | undefined;
  conversation(agentId: string): string | undefined;
  env(): NodeJS.ProcessEnv;
  open(file: string, args: string[], options: PtyOptions): Pty;
  post(message: unknown): void;
}

interface Running {
  pty: Pty;
  screen: string;
  resumed?: string;
}

export function cliArgs(kind: AgentKind, conversation: string | undefined): string[] {
  return conversation && kind.interactive ? kind.interactive.resume(conversation) : [];
}

export class CliSessions {
  private readonly running = new Map<string, Running>();

  constructor(private readonly host: CliHost) {}

  open(agent: string, cols: number, rows: number, asker: string): void {
    const held = this.running.get(agent);
    if (held) {
      held.pty.resize(cols, rows);
      this.host.post({ type: "cliReplay", agent, for: asker, data: held.screen, ...(held.resumed ? { resumed: held.resumed } : {}) });
      return;
    }
    const kind = this.host.kind(agent);
    if (!kind) {
      this.host.post({ type: "cliExit", agent, code: 127, error: `${agent} is not installed here.` });
      return;
    }
    const conversation = this.host.conversation(agent);
    const args = cliArgs(kind, conversation);
    let pty: Pty;
    try {
      pty = this.host.open(kind.path ?? kind.command, args, {
        cwd: this.host.repo(),
        env: { ...this.host.env(), TERM: "xterm-256color", COLORTERM: "truecolor" },
        cols,
        rows,
      });
    } catch (error) {
      this.host.post({ type: "cliExit", agent, code: 1, error: (error as Error).message });
      return;
    }
    const running: Running = { pty, screen: "", ...(args.length ? { resumed: conversation! } : {}) };
    this.running.set(agent, running);
    pty.onData((data) => {
      running.screen = (running.screen + data).slice(-SCROLLBACK);
      this.host.post({ type: "cliData", agent, data });
    });
    pty.onExit((code) => {
      if (this.running.get(agent) === running) this.running.delete(agent);
      this.host.post({ type: "cliExit", agent, code });
    });
    this.host.post({ type: "cliReplay", agent, for: asker, data: "", ...(running.resumed ? { resumed: running.resumed } : {}) });
  }

  input(agent: string, data: string): void {
    this.running.get(agent)?.pty.write(data);
  }

  resize(agent: string, cols: number, rows: number): void {
    this.running.get(agent)?.pty.resize(cols, rows);
  }

  close(agent: string): void {
    const held = this.running.get(agent);
    if (!held) return;
    this.running.delete(agent);
    held.pty.kill();
  }

  live(agent: string): boolean {
    return this.running.has(agent);
  }

  dispose(): void {
    for (const agent of [...this.running.keys()]) this.close(agent);
  }
}
