import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readClaude } from "@odin/core";

export interface Heard {
  role: "user" | "assistant" | "work" | "done";
  text: string;
}

const INTERRUPTED = /^\[Request interrupted/;

export function projectFolder(cwd: string, home = homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function heardIn(lines: readonly string[]): Heard[] {
  const out: Heard[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { role?: string; content?: unknown; stop_reason?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain || entry.isMeta) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (entry.type === "assistant" && Array.isArray(content)) {
      const others = content.filter((part: { type?: string }) => part?.type !== "text");
      const work = others.length ? readClaude(JSON.stringify({ type: "assistant", message: { content: others } }))?.show : undefined;
      if (work) out.push({ role: "work", text: work });
    }
    const text = textOf(content).trim();
    if (entry.type === "user" && INTERRUPTED.test(text)) {
      out.push({ role: "done", text: "" });
      continue;
    }
    if (text && !text.startsWith("<")) out.push({ role: entry.type, text });
    if (entry.type === "assistant" && entry.message?.stop_reason === "end_turn") out.push({ role: "done", text: "" });
  }
  return out;
}

export class TranscriptFollower {
  private file: string | undefined;
  private read = 0;
  private partial = "";
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly before = new Map<string, number>();

  constructor(
    private readonly folder: string,
    private session: string | undefined,
    private readonly heard: (said: Heard[]) => void,
    private readonly found: (session: string) => void,
  ) {
    if (session) return;
    try {
      for (const name of readdirSync(folder)) {
        if (name.endsWith(".jsonl")) this.before.set(name, statSync(join(folder, name)).size);
      }
    } catch {
      return;
    }
  }

  start(every = 1000): void {
    this.timer = setInterval(() => this.poll(), every);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.poll();
  }

  poll(): void {
    const file = this.locate();
    if (!file) return;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size <= this.read) return;
    let text = "";
    try {
      text = readFileSync(file, "utf8").slice(this.read);
    } catch {
      return;
    }
    this.read = size;
    const lines = (this.partial + text).split("\n");
    this.partial = lines.pop() ?? "";
    const said = heardIn(lines);
    if (said.length > 0) this.heard(said);
  }

  private locate(): string | undefined {
    if (this.file) return this.file;
    if (this.session) {
      const named = join(this.folder, `${this.session}.jsonl`);
      try {
        this.read = statSync(named).size;
        this.file = named;
        return undefined;
      } catch {
        return undefined;
      }
    }
    let newest: { path: string; at: number } | undefined;
    try {
      for (const name of readdirSync(this.folder)) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(this.folder, name);
        const facts = statSync(path);
        const was = this.before.get(name);
        if (was !== undefined && facts.size <= was) continue;
        if (!newest || facts.mtimeMs > newest.at) newest = { path, at: facts.mtimeMs };
      }
    } catch {
      return undefined;
    }
    if (!newest) return undefined;
    this.file = newest.path;
    const name = newest.path.slice(newest.path.lastIndexOf("/") + 1);
    this.read = this.before.get(name) ?? 0;
    this.session = newest.path.slice(newest.path.lastIndexOf("/") + 1, -".jsonl".length);
    this.found(this.session);
    return this.file;
  }
}
