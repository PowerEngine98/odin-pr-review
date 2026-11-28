import { execFile } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface ProcRow {
  pid: number;
  ppid: number;
  stat: string;
  seconds: number;
  cpu: number;
  command: string;
}

export type ProcStatus = "running" | "idle" | "stopped" | "terminated";

export interface ProcView {
  pid: number;
  command: string;
  icon: string;
  status: ProcStatus;
  beat: number;
  readable: boolean;
  startedAt: number;
  endedAt?: number;
}

export function seconds(etime: string): number {
  const [days, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = (rest ?? "").split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  return Number(days) * 86400 + h * 3600 + m * 60 + s;
}

export function parsePs(text: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      stat: match[3]!,
      seconds: seconds(match[4]!),
      cpu: Number(match[5]),
      command: match[6]!.trim(),
    });
  }
  return rows;
}

const SHELL = /^(\S*\/)?-?(zsh|bash|sh|fish|dash)(\s|$)/;

export function isShell(command: string): boolean {
  return SHELL.test(command);
}

export function launched(rows: readonly ProcRow[], roots: readonly number[]): ProcRow[] {
  const children = new Map<number, ProcRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const found: ProcRow[] = [];
  const walk = (pid: number, underShell: boolean): void => {
    for (const child of children.get(pid) ?? []) {
      if (isShell(child.command)) walk(child.pid, true);
      else if (underShell) found.push(child);
      else walk(child.pid, false);
    }
  };
  for (const root of roots) walk(root, false);
  return found;
}

export function subtreeOf(rows: readonly ProcRow[], pid: number): ProcRow[] {
  const children = new Map<number, ProcRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const out: ProcRow[] = [];
  const walk = (at: number): void => {
    for (const child of children.get(at) ?? []) {
      out.push(child);
      walk(child.pid);
    }
  };
  walk(pid);
  return out;
}

const TECH: [RegExp, string][] = [
  [/\bbootRun\b|spring/i, "java"],
  [/\bvitest\b/, "vitest"],
  [/\bvite\b/, "vite"],
  [/\bnext\b/, "next"],
  [/\bstorybook\b/, "storybook"],
  [/\bplaywright\b/, "playwright"],
  [/\bjest\b/, "jest"],
  [/\bcypress\b/, "cypress"],
  [/\bgradlew?\b|GradleWrapperMain|gradle-launcher/, "gradle"],
  [/\bmvnw?\b|maven/, "maven"],
  [/(^|\/)java(\s|$)|\.jar\b/, "java"],
  [/\bkotlinc?\b/, "kotlin"],
  [/\bpnpm\b/, "pnpm"],
  [/\byarn\b/, "yarn"],
  [/\bnpm\b|\bnpx\b/, "npm"],
  [/\bbun\b/, "bun"],
  [/\bdeno\b/, "deno"],
  [/\btsc\b|\btsx\b|ts-node/, "typescript"],
  [/(^|\/)node(\s|$)/, "nodejs"],
  [/python|uvicorn|pytest|\bpip\b/, "python"],
  [/\bdocker\b|docker-compose/, "docker"],
  [/\bkubectl\b/, "kubernetes"],
  [/\bterraform\b/, "terraform"],
  [/\bcargo\b|rustc/, "rust"],
  [/(^|\/)go(\s|$)/, "go"],
  [/\bmake\b/, "makefile"],
  [/\bgh\b/, "github-actions-workflow"],
  [/(^|\/)git(\s|$)/, "git"],
];

export function techOf(commands: readonly string[]): string {
  for (const [pattern, icon] of TECH) if (commands.some((one) => pattern.test(one))) return icon;
  return "console";
}

export function statusOf(alive: boolean, stat: string, cpu: number, lastOutput: number, now: number): ProcStatus {
  if (!alive) return "terminated";
  if (stat.startsWith("T")) return "stopped";
  if (now - lastOutput < 8000 || cpu >= 1) return "running";
  return "idle";
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : stdout));
  });
}

export async function stdoutFile(pid: number): Promise<string | undefined> {
  const out = await run("lsof", ["-a", "-p", String(pid), "-d", "1", "-Fn"]);
  const path = out.split("\n").find((line) => line.startsWith("n/"))?.slice(1);
  if (!path) return undefined;
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

export function readFrom(path: string, from: number, most = 512 * 1024): { text: string; size: number } {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return { text: "", size: from };
  }
  if (size <= from) return { text: "", size };
  const start = Math.max(from, size - most);
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }
  return { text: buffer.toString("utf8"), size };
}

interface Tracked {
  pid: number;
  agent: string;
  command: string;
  icon: string;
  stat: string;
  cpu: number;
  alive: boolean;
  startedAt: number;
  endedAt?: number;
  out?: string;
  size: number;
  lastOutput: number;
  beat: number;
  looked: boolean;
}

export const POLL_MS = 2000;
export const SHOWN_AFTER_S = 3;

export class ProcessWatch {
  private readonly tracked = new Map<number, Tracked>();
  private readonly removed = new Set<number>();
  private readonly attached = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = "";
  private busy = false;

  constructor(
    private readonly roots: () => Map<string, number[]>,
    private readonly post: (message: unknown) => void,
    private readonly iconUri: (name: string) => string | undefined,
    private readonly snapshot: () => Promise<string> = () => run("ps", ["-A", "-o", "pid=,ppid=,stat=,etime=,pcpu=,command="]),
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.look();
    } finally {
      this.busy = false;
    }
  }

  private async look(): Promise<void> {
    const rows = parsePs(await this.snapshot());
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const now = Date.now();
    for (const [agent, pids] of this.roots()) {
      for (const row of launched(rows, pids)) {
        if (this.tracked.has(row.pid) || this.removed.has(row.pid) || row.seconds < SHOWN_AFTER_S) continue;
        const commands = [row.command, ...subtreeOf(rows, row.pid).map((one) => one.command)];
        this.tracked.set(row.pid, {
          pid: row.pid,
          agent,
          command: row.command,
          icon: techOf(commands),
          stat: row.stat,
          cpu: row.cpu,
          alive: true,
          startedAt: now - row.seconds * 1000,
          size: 0,
          lastOutput: 0,
          beat: 0,
          looked: false,
        });
      }
    }
    for (const one of this.tracked.values()) {
      const row = byPid.get(one.pid);
      if (one.alive && !row) {
        one.alive = false;
        one.endedAt = now;
      }
      if (row) {
        one.stat = row.stat;
        one.cpu = Math.max(row.cpu, ...subtreeOf(rows, row.pid).map((child) => child.cpu));
      }
      if (!one.looked && one.alive) {
        one.looked = true;
        one.out = await stdoutFile(one.pid);
        if (one.out) one.size = readFrom(one.out, Number.MAX_SAFE_INTEGER).size;
      }
      if (one.out) {
        const read = readFrom(one.out, one.size);
        if (read.size > one.size) {
          one.lastOutput = now;
          one.beat += 1;
          if (this.attached.has(one.pid)) this.post({ type: "procData", agent: one.agent, pid: one.pid, data: read.text });
        }
        one.size = read.size;
      }
    }
    this.send(now);
  }

  views(agent: string, now = Date.now()): ProcView[] {
    return [...this.tracked.values()]
      .filter((one) => one.agent === agent)
      .map((one) => ({
        pid: one.pid,
        command: one.command,
        icon: one.icon,
        status: statusOf(one.alive, one.stat, one.cpu, one.lastOutput, now),
        beat: one.beat,
        readable: Boolean(one.out),
        startedAt: one.startedAt,
        ...(one.endedAt ? { endedAt: one.endedAt } : {}),
      }));
  }

  private send(now: number): void {
    const agents = new Set([...this.tracked.values()].map((one) => one.agent));
    const lists = Object.fromEntries([...agents].map((agent) => [agent, this.views(agent, now)]));
    const icons = Object.fromEntries(
      [...new Set([...this.tracked.values()].map((one) => one.icon))]
        .map((name) => [name, this.iconUri(name)] as const)
        .filter((pair): pair is [string, string] => Boolean(pair[1])),
    );
    const message = JSON.stringify({ type: "processes", lists, icons });
    if (message === this.last) return;
    this.last = message;
    this.post(JSON.parse(message));
  }

  attach(pid: number): void {
    const one = this.tracked.get(pid);
    if (!one) return;
    this.attached.set(pid, 1);
    const text = one.out ? readFrom(one.out, 0).text : "";
    this.post({ type: "procReplay", agent: one.agent, pid, data: text, readable: Boolean(one.out), command: one.command });
  }

  detach(pid: number): void {
    this.attached.delete(pid);
  }

  async kill(pid: number): Promise<void> {
    const rows = parsePs(await this.snapshot());
    const all = [pid, ...subtreeOf(rows, pid).map((row) => row.pid)];
    for (const one of all) {
      try {
        process.kill(one, "SIGTERM");
      } catch {
        continue;
      }
    }
    setTimeout(() => {
      for (const one of all) {
        try {
          process.kill(one, "SIGKILL");
        } catch {
          continue;
        }
      }
    }, 3000);
    await this.poll();
  }

  async remove(pid: number): Promise<void> {
    const one = this.tracked.get(pid);
    if (one?.alive) await this.kill(pid);
    this.tracked.delete(pid);
    this.attached.delete(pid);
    this.removed.add(pid);
    this.send(Date.now());
  }
}
