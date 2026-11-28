import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync, writeSync } from "node:fs";

export interface ProcRow {
  pid: number;
  ppid: number;
  stat: string;
  seconds: number;
  cpu: number;
  mem: number;
  rss: number;
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
  rerunnable: boolean;
  ports: number[];
  cpu: number;
  memPercent: number;
  memBytes: number;
  startedAt: number;
  endedAt?: number;
}

export function listening(text: string): Map<number, number[]> {
  const found = new Map<number, number[]>();
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) {
      const port = Number(/:(\d+)$/.exec(line)?.[1]);
      if (port && !(found.get(pid) ?? []).includes(port)) found.set(pid, [...(found.get(pid) ?? []), port]);
    }
  }
  return found;
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
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      stat: match[3]!,
      seconds: seconds(match[4]!),
      cpu: Number(match[5]),
      mem: Number(match[6]),
      rss: Number(match[7]) * 1024,
      command: match[8]!.trim(),
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
  const shells = new Set(rows.filter((row) => isShell(row.command)).map((row) => row.pid));
  for (const root of roots) walk(root, shells.has(root));
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
  [/\bbootRun\b|spring-boot|SpringApplication|\bspring\b/i, "spring"],
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
  mem: number;
  rss: number;
  alive: boolean;
  startedAt: number;
  endedAt?: number;
  out?: string;
  size: number;
  lastOutput: number;
  beat: number;
  looked: boolean;
  ports: number[];
  shell?: string;
  cwd?: string;
  adopted: number[];
}

export const GRADLE_CLIENT = /GradleWrapperMain|gradle-launcher|(^|\/)gradlew?(\s|$)/;
export const GRADLE_DAEMON = /GradleDaemon/;

export function daemonRuns(
  rows: readonly ProcRow[],
  client: { startedAt: number; cwd?: string },
  cwdOfPid: (pid: number) => string | undefined,
  now: number,
): number[] {
  if (!client.cwd) return [];
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  return rows
    .filter((row) => GRADLE_DAEMON.test(byPid.get(row.ppid)?.command ?? ""))
    .filter((row) => now - row.seconds * 1000 >= client.startedAt - 1000)
    .filter((row) => cwdOfPid(row.pid) === client.cwd)
    .map((row) => row.pid);
}

export function shellLine(command: string): { program: string; args: string[] } | undefined {
  const match = /^(\S+)((?:\s+-\w+)*)\s+(.+)$/s.exec(command.trim());
  if (!match || !isShell(command) || !/(^|\s)-\w*c\w*(\s|$)/.test(match[2] ?? "")) return undefined;
  return { program: match[1]!, args: [...(match[2] ?? "").trim().split(/\s+/).filter(Boolean), match[3]!] };
}

export function runnable(script: string): string {
  return script.replace(/\bsource\s+(\S+)\s*&&\s*/g, (all, file: string) => (existsSync(file) ? all : ""));
}

export async function cwdOf(pid: number): Promise<string | undefined> {
  const out = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  return out.split("\n").find((line) => line.startsWith("n/"))?.slice(1);
}

export function withColour(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    FORCE_COLOR: env.FORCE_COLOR ?? "1",
    SPRING_OUTPUT_ANSI_ENABLED: env.SPRING_OUTPUT_ANSI_ENABLED ?? "ALWAYS",
  };
}

export interface SavedProcesses {
  roots: Record<string, number[]>;
  procs: { pid: number; agent: string; command: string; startedAt: number; shell?: string; cwd?: string }[];
}

export interface ProcessMemory {
  read(): SavedProcesses | undefined;
  write(saved: SavedProcesses): void;
}

export const SAME_START_MS = 5000;

export const POLL_MS = 2000;
export const SHOWN_AFTER_S = 3;
export const GONE_AFTER_MS = 10_000;

export class ProcessWatch {
  private readonly tracked = new Map<number, Tracked>();
  private readonly removed = new Set<number>();
  private readonly attached = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = "";
  private busy = false;
  private restored = false;
  private saved = "";
  private readonly kept = new Map<string, Set<number>>();
  private readonly reruns = new Map<number, { agent: string; from: number }>();
  private replaced: { agent: string; from: number; to: number }[] = [];
  private readonly cwds = new Map<number, string>();

  private treeOf(rows: readonly ProcRow[], one: Tracked): ProcRow[] {
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const row = byPid.get(one.pid);
    if (!row) return [];
    const adopted = one.adopted.map((pid) => byPid.get(pid)).filter((each): each is ProcRow => Boolean(each));
    return [row, ...subtreeOf(rows, row.pid), ...adopted.flatMap((each) => [each, ...subtreeOf(rows, each.pid)])];
  }

  private async adopt(rows: readonly ProcRow[], now: number): Promise<void> {
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const daemonChildren = rows.filter((row) => GRADLE_DAEMON.test(byPid.get(row.ppid)?.command ?? ""));
    for (const row of daemonChildren) {
      if (!this.cwds.has(row.pid)) {
        const cwd = await cwdOf(row.pid);
        if (cwd) this.cwds.set(row.pid, cwd);
      }
    }
    const claimed = new Set([...this.tracked.values()].flatMap((one) => one.adopted));
    for (const one of this.tracked.values()) {
      one.adopted = one.adopted.filter((pid) => byPid.has(pid));
      if (!one.alive || !GRADLE_CLIENT.test(one.command)) continue;
      for (const pid of daemonRuns(rows, one, (each) => this.cwds.get(each), now)) {
        if (claimed.has(pid)) continue;
        claimed.add(pid);
        one.adopted.push(pid);
      }
    }
  }

  constructor(
    private readonly roots: () => Map<string, number[]>,
    private readonly post: (message: unknown) => void,
    private readonly iconUri: (name: string) => string | undefined,
    private readonly snapshot: () => Promise<string> = () => run("ps", ["-A", "-ww", "-o", "pid=,ppid=,stat=,etime=,pcpu=,pmem=,rss=,command="]),
    private readonly memory?: ProcessMemory,
  ) {}

  private restore(rows: readonly ProcRow[], now: number): void {
    if (this.restored) return;
    this.restored = true;
    const saved = this.memory?.read();
    if (!saved) return;
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    for (const [agent, pids] of Object.entries(saved.roots ?? {})) {
      const alive = pids.filter((pid) => byPid.has(pid));
      if (alive.length > 0) this.kept.set(agent, new Set(alive));
    }
    for (const one of saved.procs ?? []) {
      const row = byPid.get(one.pid);
      if (!row || row.command !== one.command) continue;
      if (Math.abs(now - row.seconds * 1000 - one.startedAt) > SAME_START_MS) continue;
      this.tracked.set(one.pid, {
        pid: one.pid,
        agent: one.agent,
        command: one.command,
        icon: techOf([row.command, ...subtreeOf(rows, row.pid).map((child) => child.command)]),
        stat: row.stat,
        cpu: row.cpu,
        mem: row.mem,
        rss: row.rss,
        alive: true,
        startedAt: one.startedAt,
        size: 0,
        lastOutput: 0,
        beat: 0,
        looked: false,
        ports: [],
        adopted: [],
        ...(one.shell ? { shell: one.shell } : {}),
        ...(one.cwd ? { cwd: one.cwd } : {}),
      });
    }
  }

  private remember(roots: Map<string, number[]>): void {
    if (!this.memory) return;
    const saved: SavedProcesses = {
      roots: Object.fromEntries([...roots].map(([agent, pids]) => [agent, [...new Set(pids)]])),
      procs: [...this.tracked.values()]
        .filter((one) => one.alive)
        .map((one) => ({
          pid: one.pid,
          agent: one.agent,
          command: one.command,
          startedAt: one.startedAt,
          ...(one.shell ? { shell: one.shell } : {}),
          ...(one.cwd ? { cwd: one.cwd } : {}),
        })),
    };
    const text = JSON.stringify(saved);
    if (text === this.saved) return;
    this.saved = text;
    this.memory.write(saved);
  }

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
    this.restore(rows, now);
    const roots = new Map<string, number[]>();
    for (const [agent, pids] of [...this.kept, ...this.roots()]) {
      roots.set(agent, [...new Set([...(roots.get(agent) ?? []), ...pids])].filter((pid) => byPid.has(pid)));
    }
    for (const [agent, pids] of roots) this.kept.set(agent, new Set(pids));
    for (const [agent, pids] of roots) {
      for (const row of launched(rows, pids)) {
        const rerun = [...this.reruns].find(([root]) => row.ppid === root || subtreeOf(rows, root).some((one) => one.pid === row.pid));
        if (this.tracked.has(row.pid) || this.removed.has(row.pid) || (!rerun && row.seconds < SHOWN_AFTER_S)) continue;
        const parent = byPid.get(row.ppid);
        const commands = [row.command, ...subtreeOf(rows, row.pid).map((one) => one.command)];
        this.tracked.set(row.pid, {
          pid: row.pid,
          agent,
          command: row.command,
          icon: techOf(commands),
          stat: row.stat,
          cpu: row.cpu,
          mem: row.mem,
          rss: row.rss,
          alive: true,
          startedAt: now - row.seconds * 1000,
          size: 0,
          lastOutput: 0,
          beat: 0,
          looked: false,
          ports: [],
          adopted: [],
          ...(parent && isShell(parent.command) ? { shell: parent.command } : {}),
        });
        if (rerun) {
          this.reruns.delete(rerun[0]);
          this.replaced.push({ agent, from: rerun[1].from, to: row.pid });
        }
      }
    }
    await this.adopt(rows, now);
    const owners = new Map<number, number>();
    for (const one of this.tracked.values()) {
      if (!one.alive || !byPid.has(one.pid)) continue;
      for (const each of this.treeOf(rows, one)) owners.set(each.pid, one.pid);
    }
    const ports = new Map<number, number[]>();
    if (owners.size > 0) {
      const out = await run("lsof", ["-a", "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fpn", "-p", [...owners.keys()].join(",")]);
      for (const [pid, held] of listening(out)) {
        const owner = owners.get(pid);
        if (owner) ports.set(owner, [...new Set([...(ports.get(owner) ?? []), ...held])].sort((a, b) => a - b));
      }
    }
    for (const one of this.tracked.values()) {
      one.ports = one.alive ? (ports.get(one.pid) ?? []) : [];
      const row = byPid.get(one.pid);
      if (one.alive && !row) {
        one.alive = false;
        one.endedAt = now;
      }
      if (row) {
        const tree = this.treeOf(rows, one);
        one.icon = techOf(tree.map((each) => each.command));
        one.stat = row.stat;
        one.cpu = tree.reduce((sum, each) => sum + each.cpu, 0);
        one.mem = tree.reduce((sum, each) => sum + each.mem, 0);
        one.rss = tree.reduce((sum, each) => sum + each.rss, 0);
      } else {
        one.cpu = 0;
        one.mem = 0;
        one.rss = 0;
      }
      if (!one.looked && one.alive) {
        one.looked = true;
        one.cwd ??= await cwdOf(one.pid);
        one.out = await stdoutFile(one.pid);
        if (one.out) one.size = readFrom(one.out, Number.MAX_SAFE_INTEGER).size;
      }
      if (one.out) {
        let grown = 0;
        try {
          grown = statSync(one.out).size;
        } catch {
          grown = one.size;
        }
        if (grown < one.size) one.size = 0;
        const read = readFrom(one.out, one.size);
        if (read.size > one.size) {
          one.lastOutput = now;
          one.beat += 1;
          if (this.attached.has(one.pid)) this.post({ type: "procData", agent: one.agent, pid: one.pid, data: read.text });
        }
        one.size = read.size;
      }
    }
    for (const one of [...this.tracked.values()]) {
      if (!one.alive && one.endedAt !== undefined && now - one.endedAt > GONE_AFTER_MS) {
        this.tracked.delete(one.pid);
        this.attached.delete(one.pid);
        this.removed.add(one.pid);
      }
    }
    this.remember(roots);
    this.send(now);
    for (const swap of this.replaced.splice(0)) this.post({ type: "procReplaced", ...swap });
  }

  views(agent: string, now = Date.now()): ProcView[] {
    return [...this.tracked.values()]
      .filter((one) => one.agent === agent)
      .sort((a, b) => b.rss - a.rss || a.startedAt - b.startedAt)
      .map((one) => ({
        pid: one.pid,
        command: one.command,
        icon: one.icon,
        status: statusOf(one.alive, one.stat, one.cpu, one.lastOutput, now),
        beat: one.beat,
        readable: Boolean(one.out),
        rerunnable: Boolean(one.shell && shellLine(one.shell)),
        ports: one.ports,
        cpu: Math.round(one.cpu * 10) / 10,
        memPercent: Math.round(one.mem * 10) / 10,
        memBytes: one.rss,
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
    const one = this.tracked.get(pid);
    const all = [...new Set([pid, ...subtreeOf(rows, pid).map((row) => row.pid), ...(one ? this.treeOf(rows, one).map((row) => row.pid) : [])])];
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

  async rerun(pid: number): Promise<void> {
    const one = this.tracked.get(pid);
    const line = one?.shell ? shellLine(one.shell) : undefined;
    if (!one || !line) return;
    if (one.alive) {
      await this.kill(pid);
      const stop = Date.now() + 10_000;
      while (Date.now() < stop && parsePs(await this.snapshot()).some((row) => row.pid === pid)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    let out: number | undefined;
    if (one.out) {
      try {
        out = openSync(one.out, "a");
        writeSync(out, "\n\x1b[2m── rerun by Odin ──\x1b[0m\n");
      } catch {
        out = undefined;
      }
    }
    const args = [...line.args.slice(0, -1), runnable(line.args.at(-1) ?? "")];
    const child = spawn(line.program, args, {
      cwd: one.cwd ?? process.cwd(),
      env: withColour(process.env),
      detached: true,
      stdio: ["ignore", out ?? "ignore", out ?? "ignore"],
    });
    child.unref();
    if (out !== undefined) closeSync(out);
    if (!child.pid) return;
    this.reruns.set(child.pid, { agent: one.agent, from: pid });
    this.kept.set(one.agent, new Set([...(this.kept.get(one.agent) ?? []), child.pid]));
    this.tracked.delete(pid);
    this.attached.delete(pid);
    this.removed.add(pid);
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
