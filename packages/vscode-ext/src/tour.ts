import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  forgeEnv,
  runAgent,
  type AgentKind,
  type ChangeGraph,
  type FoundAgent,
  type RunHandle,
} from "@odin/core";
import { parseTour, tourPrompt, type Tour, type TourContext } from "@odin/core/tour/tour.js";

import { log } from "./log.js";

/**
 * "Give me a tour", the host's half: an agent asked for one, its answer held to
 * the rules, and the result kept on disk with how far the reader has got.
 *
 * The page plays a tour and knows nothing about how it was made. What it is
 * handed here is a tour that has already passed `parseTour` against the files
 * of this change — an answer that names a file the canvas does not draw never
 * reaches it — and the reader's place in it, so closing the tab halfway through
 * a lesson and coming back tomorrow resumes rather than restarts.
 */

/** Where the reader is in a tour: the topic, the frame, and what they finished. */
export interface TourProgress {
  topic: number;
  frame: number;
  /** Ids of the topics played to their end. */
  watched: string[];
  frames: Record<string, number>;
}

/** A tour as it is kept: the tour, what it was made against, and the reader's place. */
export interface SavedTour {
  tour: Tour;
  /** The commit and the base the change was read at when the tour was written. */
  headSha?: string;
  mergeBase?: string;
  progress: TourProgress;
  /** ISO-8601, when it was made. */
  at: string;
}

export const START: TourProgress = { topic: 0, frame: 0, watched: [], frames: {} };

/* ------------------------------------------------------------ the change */

/** Whether a node is a file the change touched, which is all a tour may visit. */
function changed(node: ChangeGraph["nodes"][number]): boolean {
  return node.status !== "phantom" && node.kind !== "database";
}

/**
 * The changed files, what is depended on first.
 *
 * The same order the page lays its columns out in, so the agent reads the
 * change the way the reader sees it: an edge runs from the file that refers to
 * the file referred to, and a file is placed once everything it refers to has
 * been. Ties go by path, so the order is the same on every run.
 *
 * A cycle — two files that refer to each other — has no file ready to place,
 * and then the one with the fewest unplaced dependencies goes next rather than
 * the walk giving up on the rest.
 */
export function dependencyOrder(graph: ChangeGraph): ChangeGraph["nodes"] {
  const nodes = graph.nodes.filter(changed);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const needs = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set()]));
  for (const edge of graph.edges) {
    const from = edge.from.nodeId;
    const to = edge.to.nodeId;
    if (from === to || !byId.has(from) || !byId.has(to)) continue;
    needs.get(from)!.add(to);
  }

  const placed = new Set<string>();
  const order: ChangeGraph["nodes"] = [];
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  const waiting = [...nodes].sort(byPath);

  while (waiting.length > 0) {
    const unmet = (node: { id: string }) =>
      [...needs.get(node.id)!].filter((id) => !placed.has(id)).length;
    let at = waiting.findIndex((node) => unmet(node) === 0);
    if (at < 0) {
      at = 0;
      for (let i = 1; i < waiting.length; i++) {
        if (unmet(waiting[i]!) < unmet(waiting[at]!)) at = i;
      }
    }
    const [next] = waiting.splice(at, 1);
    placed.add(next!.id);
    order.push(next!);
  }
  return order;
}

/** What the agent is told about the change. */
export function tourContext(graph: ChangeGraph): TourContext {
  const title = graph.meta.pullRequest?.title;
  return {
    ...(title ? { title } : {}),
    base: graph.meta.mergeBase ?? graph.meta.baseRef,
    worktree: graph.meta.worktree === true,
    files: dependencyOrder(graph).map((node) => ({
      path: node.path,
      additions: node.stats.additions,
      deletions: node.stats.deletions,
    })),
  };
}

/**
 * Whether a kept tour was written for an earlier state of the change.
 *
 * Still delivered when it is: its anchors are lines of code rather than
 * numbers, so most of it lands where it did, and the page says it may be out of
 * date rather than the reader losing a tour to a one-line fix.
 */
export function isStale(saved: SavedTour, graph: ChangeGraph): boolean {
  return saved.headSha !== graph.meta.headSha || saved.mergeBase !== graph.meta.mergeBase;
}

/* ---------------------------------------------------------------- keeping */

/**
 * Tours on disk, one file per reading, in the extension's own storage.
 *
 * Named by a hash of the reading's conversation key, which already says what
 * makes two readings the same change: the repository, the base, the branch, and
 * whether it is read live. Progress arrives on every frame, so it is written a
 * moment after it stops arriving rather than every time.
 */
export class TourStore {
  private readonly pending = new Map<string, { progress: TourProgress; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly dir: string,
    private readonly delayMs = 500,
  ) {}

  private file(key: string): string {
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
    return join(this.dir, "tours", `${hash}.json`);
  }

  read(key: string): SavedTour | undefined {
    try {
      const saved = JSON.parse(readFileSync(this.file(key), "utf8")) as SavedTour;
      if (!saved?.tour || !Array.isArray(saved.tour.topics)) return undefined;
      const waiting = this.pending.get(key);
      return {
        ...saved,
        progress: waiting?.progress ?? { ...START, ...saved.progress },
      };
    } catch {
      return undefined;
    }
  }

  write(key: string, saved: SavedTour): void {
    this.cancel(key);
    const path = this.file(key);
    try {
      mkdirSync(join(this.dir, "tours"), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(saved));
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      log(`tour: could not keep the tour (${String(error)})`);
    }
  }

  /** The reader's place, written once they have stopped moving for a moment. */
  progress(key: string, progress: TourProgress): void {
    this.cancel(key);
    const timer = setTimeout(() => this.flush(key), this.delayMs);
    this.pending.set(key, { progress, timer });
  }

  /** Whatever progress is waiting, written now. */
  flush(key?: string): void {
    for (const at of key ? [key] : [...this.pending.keys()]) {
      const waiting = this.pending.get(at);
      if (!waiting) continue;
      this.cancel(at);
      const saved = this.read(at);
      if (saved) this.write(at, { ...saved, progress: waiting.progress });
    }
  }

  private cancel(key: string): void {
    const waiting = this.pending.get(key);
    if (waiting) clearTimeout(waiting.timer);
    this.pending.delete(key);
  }
}

/* ----------------------------------------------------------------- making */

/** Claude when it is here, the first agent found otherwise. */
export function pickAgent(found: readonly FoundAgent[]): FoundAgent | undefined {
  return found.find((agent) => agent.id === "claude") ?? found[0];
}

/**
 * How the agent is run: once, and only allowed to look.
 *
 * A tour is reading and nothing else. Claude is given the read-only tools and
 * the three git commands the prompt asks for, and nothing that writes; its list
 * of tools takes every argument after it, so `--print` goes after the list to
 * end it before the prompt. Every other tool is put on its own read-only rung,
 * where it has one.
 */
export function tourArgs(kind: AgentKind): string[] {
  if (kind.id === "claude") {
    return [
      "--allowedTools",
      "Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(git log:*)",
      ...kind.once,
    ];
  }
  const looking = kind.agency?.read ?? [];
  return kind.holdsPrompt ? [...looking, ...kind.once] : [...kind.once, ...looking];
}

/** Three minutes for a small change, up to twelve for a large one. */
export function tourTimeout(context: TourContext): number {
  const lines = context.files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const minutes = Math.max(3, Math.min(12, 3 + lines / 250));
  return Math.round(minutes * 60 * 1000);
}

export type Made = { ok: true; tour: Tour } | { ok: false; why: string; stopped?: boolean };

export interface MakeRequest {
  agent: AgentKind;
  context: TourContext;
  cwd: string;
  /** What to ask instead of a tour from scratch: a correction of one. */
  prompt?: string;
  /** Each step, as it starts, for the page to say. */
  step?: (note: string) => void;
  /** Replaced in tests; the real agent otherwise. */
  run?: typeof runAgent;
}

/** A tour being made, and the one thing that can be done to it from outside. */
export interface Making {
  done: Promise<Made>;
  stop(): void;
}

/**
 * A tour, asked for and checked.
 *
 * One answer that fails the rules is sent back once with what was wrong with
 * it: agents get a path or a field name wrong far more often than they get a
 * whole tour wrong, and the second answer is nearly always the first with that
 * fixed. A second failure is reported rather than tried a third time.
 */
export function makeTour(request: MakeRequest): Making {
  const run = request.run ?? runAgent;
  const files = request.context.files.map((file) => file.path);
  const prompt = request.prompt ?? tourPrompt(request.context);
  const timeoutMs = tourTimeout(request.context);
  let current: RunHandle | undefined;
  let stopped = false;

  const once = async (asked: string): Promise<{ answer: string } | { why: string }> => {
    if (stopped) return { why: "Stopped." };
    current = run({
      kind: request.agent,
      prompt: asked,
      args: tourArgs(request.agent),
      cwd: request.cwd,
      env: forgeEnv(),
      timeoutMs,
    });
    const result = await current.done;
    current = undefined;
    if (result.stopped) {
      return { why: stopped ? "Stopped." : `${request.agent.name} took too long.` };
    }
    const answer = (result.answer ?? result.output).trim();
    if (result.code !== 0 && !answer) {
      const tail = result.transcript.trim().split("\n").slice(-3).join(" ");
      return { why: `${request.agent.name} failed (exit ${result.code})${tail ? `: ${tail}` : ""}` };
    }
    return { answer };
  };

  const done = (async (): Promise<Made> => {
    request.step?.(`Reading the change and writing the tour (${request.agent.name})`);
    log(`tour: asking ${request.agent.name} about ${files.length} files`);
    const first = await once(prompt);
    if ("why" in first) return { ok: false, why: first.why, ...(stopped ? { stopped } : {}) };

    request.step?.("Checking it");
    const parsed = parseTour(first.answer, files);
    if (parsed.ok) return { ok: true, tour: parsed.tour };
    log(`tour: first answer rejected: ${parsed.errors.join("; ")}`);

    request.step?.("Retrying");
    const again = await once(
      `${prompt}\n\nYour previous answer was rejected: ${parsed.errors.join("; ")}. Answer again with corrected JSON only.`,
    );
    if ("why" in again) return { ok: false, why: again.why, ...(stopped ? { stopped } : {}) };
    request.step?.("Checking it");
    const second = parseTour(again.answer, files);
    if (second.ok) return { ok: true, tour: second.tour };
    log(`tour: second answer rejected: ${second.errors.join("; ")}`);
    return { ok: false, why: `The tour did not hold up: ${second.errors.slice(0, 5).join("; ")}` };
  })();

  return {
    done,
    stop(): void {
      stopped = true;
      current?.stop();
    },
  };
}
