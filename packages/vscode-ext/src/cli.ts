import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, unwatchFile, watchFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentKind } from "@odin/core";

import type { Pty, PtyOptions } from "./pty.js";
import { projectFolder, TranscriptFollower, type Heard } from "./transcript.js";

export const SCROLLBACK = 512 * 1024;

export interface CliHost {
  repo(): string;
  kind(agentId: string): (AgentKind & { path?: string }) | undefined;
  conversation(agentId: string): string | undefined;
  env(): NodeJS.ProcessEnv;
  open(file: string, args: string[], options: PtyOptions): Pty;
  post(message: unknown): void;
  heard?(agent: string, said: Heard[]): void;
  adopt?(agent: string, session: string): void;
  ended?(agent: string): void;
  tools?(agent: string): string[];
}

interface Running {
  pty: Pty;
  screen: string;
  resumed?: string;
  ready: boolean;
  settle?: ReturnType<typeof setTimeout>;
  follower?: TranscriptFollower;
  session?: string;
  report?: string;
  typed: string[];
}

export function reportedSession(text: string): string | undefined {
  try {
    const id = (JSON.parse(text) as { session_id?: unknown }).session_id;
    return typeof id === "string" && /^[\w-]+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function unreport(running: Running): void {
  if (!running.report) return;
  unwatchFile(running.report);
  rmSync(running.report, { force: true });
  running.report = undefined;
}

export const SETTLED_MS = 700;
export const ENTER_MS = 120;

export const REPAINT_MS = 80;

export function cliArgs(kind: AgentKind, conversation: string | undefined, fresh?: string): string[] {
  if (conversation && kind.interactive) return kind.interactive.resume(conversation);
  if (fresh && kind.interactive?.start) return kind.interactive.start(fresh);
  return [];
}

export class CliSessions {
  private readonly running = new Map<string, Running>();
  private readonly waiting = new Map<string, string[]>();

  constructor(private readonly host: CliHost) {}

  open(agent: string, cols: number, rows: number, asker: string): void {
    const held = this.running.get(agent);
    if (held) {
      this.host.post({ type: "cliReplay", agent, for: asker, data: held.screen, ...(held.resumed ? { resumed: held.resumed } : {}) });
      held.pty.resize(Math.max(20, cols - 1), rows);
      setTimeout(() => {
        if (this.running.get(agent) === held) held.pty.resize(cols, rows);
      }, REPAINT_MS);
      return;
    }
    const kind = this.host.kind(agent);
    if (!kind) {
      this.host.post({ type: "cliExit", agent, code: 127, error: `${agent} is not installed here.` });
      return;
    }
    const conversation = this.host.conversation(agent);
    const started = conversation ? undefined : randomUUID();
    const report = agent === "claude" && this.host.heard && kind.interactive?.reports ? join(tmpdir(), `odin-cli-${randomUUID()}.json`) : undefined;
    const args = [
      ...cliArgs(kind, conversation, started),
      ...(this.host.tools?.(agent) ?? []),
      ...(report && kind.interactive?.reports ? kind.interactive.reports(report) : []),
    ];
    const session = conversation ?? (started && kind.interactive?.start ? started : undefined);
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
    const running: Running = { pty, screen: "", ready: false, typed: [], ...(conversation && kind.interactive ? { resumed: conversation } : {}) };
    this.running.set(agent, running);
    const follow = (id: string, found?: () => void): TranscriptFollower => {
      const follower = new TranscriptFollower(
        projectFolder(this.host.repo()),
        id,
        (said) => {
          const fresh = said.filter((one) => {
            if (one.role !== "user") return true;
            const at = running.typed.indexOf(one.text.trim());
            if (at < 0) return true;
            running.typed.splice(at, 1);
            return false;
          });
          if (fresh.length > 0) this.host.heard?.(agent, fresh);
        },
        found,
      );
      follower.start();
      return follower;
    };
    if (agent === "claude" && this.host.heard && session) {
      running.session = session;
      running.follower = follow(session, started ? () => this.host.adopt?.(agent, session) : undefined);
    }
    if (report) {
      running.report = report;
      watchFile(report, { interval: 500 }, () => {
        let text = "";
        try {
          text = readFileSync(report, "utf8");
        } catch {
          return;
        }
        const id = reportedSession(text);
        if (!id || id === running.session || this.running.get(agent) !== running) return;
        running.follower?.stop();
        running.session = id;
        running.follower = follow(id);
        this.host.adopt?.(agent, id);
      });
    }
    pty.onData((data) => {
      running.screen = (running.screen + data).slice(-SCROLLBACK);
      this.host.post({ type: "cliData", agent, data });
      if (running.ready) return;
      if (running.settle) clearTimeout(running.settle);
      running.settle = setTimeout(() => {
        running.ready = true;
        this.flush(agent);
      }, SETTLED_MS);
    });
    pty.onExit((code) => {
      if (running.settle) clearTimeout(running.settle);
      running.follower?.stop();
      unreport(running);
      if (this.running.get(agent) === running) this.running.delete(agent);
      this.host.ended?.(agent);
      this.host.post({ type: "cliExit", agent, code });
    });
    this.host.post({ type: "cliReplay", agent, for: asker, data: "", ...(running.resumed ? { resumed: running.resumed } : {}) });
  }

  send(agent: string, text: string): void {
    const queue = this.waiting.get(agent) ?? [];
    queue.push(text);
    this.waiting.set(agent, queue);
    if (this.running.get(agent)?.ready) this.flush(agent);
  }

  private flush(agent: string): void {
    const running = this.running.get(agent);
    const queue = this.waiting.get(agent);
    if (!running || !queue?.length) return;
    this.waiting.delete(agent);
    let at = 0;
    for (const text of queue) running.typed.push(text.trim());
    for (const text of queue) {
      setTimeout(() => running.pty.write(text), at);
      setTimeout(() => running.pty.write("\r"), at + ENTER_MS);
      at += ENTER_MS * 3;
    }
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
    held.follower?.stop();
    unreport(held);
    held.pty.kill();
  }

  agents(): string[] {
    return [...this.running.keys()];
  }

  pidOf(agent: string): number | undefined {
    return this.running.get(agent)?.pty.pid;
  }

  live(agent: string): boolean {
    return this.running.has(agent);
  }

  dispose(): void {
    for (const agent of [...this.running.keys()]) this.close(agent);
  }
}
