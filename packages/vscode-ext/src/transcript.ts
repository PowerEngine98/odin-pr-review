import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readClaude } from "@odin/core";

export interface Heard {
  role: "user" | "assistant" | "work" | "done" | "asking";
  text: string;
}

const INTERRUPTED = /^\[Request interrupted/;

const ASKS_READER = new Set(["AskUserQuestion", "ExitPlanMode"]);

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
    let entry: {
      type?: string;
      isSidechain?: boolean;
      isMeta?: boolean;
      message?: { role?: string; content?: unknown; stop_reason?: unknown };
      attachment?: { type?: string; prompt?: unknown; origin?: { kind?: string } };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain || entry.isMeta) continue;
    const queued = entry.type === "attachment" ? entry.attachment : undefined;
    if (queued?.type === "queued_command" && queued.origin?.kind === "human" && typeof queued.prompt === "string") {
      const text = queued.prompt.trim();
      if (text && !text.startsWith("<")) out.push({ role: "user", text });
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (entry.type === "assistant" && Array.isArray(content)) {
      const others = content.filter((part: { type?: string }) => part?.type !== "text");
      const work = others.length ? readClaude(JSON.stringify({ type: "assistant", message: { content: others } }))?.show : undefined;
      if (work) out.push({ role: "work", text: work });
      const asks = others.some((part: { type?: string; name?: string }) => part?.type === "tool_use" && ASKS_READER.has(part.name ?? ""));
      if (asks) out.push({ role: "asking", text: "" });
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
  private partial: Buffer = Buffer.alloc(0);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly folder: string,
    private readonly session: string,
    private readonly heard: (said: Heard[]) => void,
    private found?: () => void,
  ) {
    try {
      this.read = statSync(join(folder, `${session}.jsonl`)).size;
    } catch {
      this.read = 0;
    }
    this.file = join(folder, `${session}.jsonl`);
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
    const file = this.file;
    if (!file) return;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size > 0 && this.found) {
      const found = this.found;
      this.found = undefined;
      found();
    }
    if (size <= this.read) return;
    let fresh: Buffer;
    try {
      fresh = readFileSync(file).subarray(this.read, size);
    } catch {
      return;
    }
    this.read = size;
    const held = Buffer.concat([this.partial, fresh]);
    const end = held.lastIndexOf(0x0a);
    if (end < 0) {
      this.partial = held;
      return;
    }
    this.partial = Buffer.from(held.subarray(end + 1));
    const said = heardIn(held.subarray(0, end).toString("utf8").split("\n"));
    if (said.length > 0) this.heard(said);
  }
}
