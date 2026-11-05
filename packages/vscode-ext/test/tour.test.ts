import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRun, ChangeGraph, FoundAgent, RunRequest } from "@odin/core";
import type { Tour } from "@odin/core/tour/tour.js";

import {
  dependencyOrder,
  isStale,
  makeTour,
  pickAgent,
  START,
  TourStore,
  tourArgs,
  tourContext,
  type SavedTour,
} from "../src/tour.js";

function node(id: string, path: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    path,
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 10, deletions: 2 },
    hunks: [],
    symbols: [],
    ...extra,
  };
}

function edge(from: string, to: string) {
  return {
    id: `e:${from}-${to}`,
    from: { nodeId: from, side: "head", line: 1 },
    to: { nodeId: to, side: "head", line: 1 },
    kind: "call",
    resolver: "test",
  };
}

function graph(nodes: unknown[], edges: unknown[] = [], meta: Record<string, unknown> = {}): ChangeGraph {
  return {
    schemaVersion: 1,
    meta: { baseRef: "main", headRef: "feature", generator: "test", headSha: "h1", mergeBase: "b1", ...meta },
    nodes,
    edges,
  } as unknown as ChangeGraph;
}

const tour: Tour = {
  version: 1,
  title: "Orders",
  topics: [
    {
      id: "placing-an-order",
      title: "Placing an order",
      summary: "How a click becomes a saved order.",
      frames: [{ kind: "go", file: "Main.kt", say: "It starts here." }],
    },
  ],
};

describe("the order a tour reads the change in", () => {
  it("puts what is referred to before what refers to it", () => {
    const change = graph(
      [node("a", "Main.kt"), node("b", "OrderService.kt"), node("c", "Order.kt")],
      [edge("a", "b"), edge("b", "c")],
    );
    expect(dependencyOrder(change).map((one) => one.path)).toEqual([
      "Order.kt",
      "OrderService.kt",
      "Main.kt",
    ]);
  });

  it("breaks ties by path", () => {
    const change = graph([node("a", "b/Zeta.kt"), node("b", "a/Alpha.kt"), node("c", "a/Beta.kt")]);
    expect(dependencyOrder(change).map((one) => one.path)).toEqual([
      "a/Alpha.kt",
      "a/Beta.kt",
      "b/Zeta.kt",
    ]);
  });

  it("gets through a cycle rather than stopping at it", () => {
    const change = graph(
      [node("a", "A.kt"), node("b", "B.kt"), node("c", "Main.kt")],
      [edge("a", "b"), edge("b", "a"), edge("c", "a")],
    );
    expect(dependencyOrder(change).map((one) => one.path)).toEqual(["A.kt", "B.kt", "Main.kt"]);
  });

  it("leaves out untouched files and databases", () => {
    const change = graph(
      [
        node("a", "Main.kt"),
        node("b", "Order.kt", { status: "phantom" }),
        node("c", "orders", { kind: "database" }),
      ],
      [edge("a", "b"), edge("a", "c")],
    );
    expect(dependencyOrder(change).map((one) => one.path)).toEqual(["Main.kt"]);
  });

  it("tells the agent the base, the title and the sizes", () => {
    const change = graph([node("a", "Main.kt")], [], {
      worktree: true,
      pullRequest: { number: 1, title: "Place orders" },
    });
    expect(tourContext(change)).toEqual({
      title: "Place orders",
      base: "b1",
      worktree: true,
      files: [{ path: "Main.kt", additions: 10, deletions: 2 }],
    });
  });
});

describe("keeping a tour", () => {
  let dir: string | undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const saved = (): SavedTour => ({
    tour,
    headSha: "h1",
    mergeBase: "b1",
    progress: START,
    at: "2026-01-01T00:00:00.000Z",
  });

  it("has nothing for a reading it never kept one for", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-tour-"));
    expect(new TourStore(dir).read("repo main feature committed")).toBeUndefined();
  });

  it("gives back what it was given, under its own reading", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-tour-"));
    const store = new TourStore(dir);
    store.write("repo main feature committed", saved());
    expect(store.read("repo main feature committed")).toEqual(saved());
    expect(store.read("repo main other committed")).toBeUndefined();
    expect(readdirSync(join(dir, "tours"))).toHaveLength(1);
  });

  it("writes progress a moment after it stops arriving", () => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "odin-tour-"));
    const key = "repo main feature committed";
    const store = new TourStore(dir, 500);
    store.write(key, saved());
    store.progress(key, { topic: 0, frame: 1, watched: [], frames: {} });
    store.progress(key, { topic: 0, frame: 2, watched: ["placing-an-order"], frames: { "paying": 3 } });
    expect(new TourStore(dir).read(key)?.progress).toEqual(START);
    expect(store.read(key)?.progress.frame).toBe(2);
    vi.advanceTimersByTime(500);
    expect(new TourStore(dir).read(key)?.progress).toEqual({
      topic: 0,
      frame: 2,
      watched: ["placing-an-order"],
      frames: { "paying": 3 },
    });
  });

  it("writes waiting progress at once when flushed", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-tour-"));
    const key = "repo main feature live";
    const store = new TourStore(dir, 10_000);
    store.write(key, saved());
    store.progress(key, { topic: 1, frame: 0, watched: [], frames: {} });
    store.flush();
    expect(new TourStore(dir).read(key)?.progress.topic).toBe(1);
  });

  it("says a tour is stale once the change has moved on", () => {
    expect(isStale(saved(), graph([]))).toBe(false);
    expect(isStale(saved(), graph([], [], { headSha: "h2" }))).toBe(true);
    expect(isStale(saved(), graph([], [], { mergeBase: "b2" }))).toBe(true);
  });
});

describe("asking for a tour", () => {
  const claude = {
    id: "claude",
    name: "Claude",
    command: "claude",
    once: ["--print"],
    version: ["--version"],
  } as FoundAgent;
  const codex = {
    id: "codex",
    name: "Codex",
    command: "codex",
    once: ["exec"],
    version: ["--version"],
    agency: { read: ["--sandbox", "read-only"] },
  } as unknown as FoundAgent;

  it("prefers Claude, and otherwise takes the first found", () => {
    expect(pickAgent([codex, claude])?.id).toBe("claude");
    expect(pickAgent([codex])?.id).toBe("codex");
    expect(pickAgent([])).toBeUndefined();
  });

  it("ends Claude's tool list before the prompt", () => {
    expect(tourArgs(claude).at(-1)).toBe("--print");
    expect(tourArgs(codex)).toEqual(["exec", "--sandbox", "read-only"]);
  });

  const context = tourContext(graph([node("a", "Main.kt")]));
  const answering = (...answers: string[]) => {
    const asked: string[] = [];
    const run = (request: RunRequest) => {
      asked.push(request.prompt);
      const output = answers[asked.length - 1] ?? "";
      const done: Promise<AgentRun> = Promise.resolve({
        transcript: output,
        output,
        code: 0,
        stopped: false,
      });
      return { done, stop() {} };
    };
    return { asked, run };
  };

  it("sends a rejected answer back once with what was wrong", async () => {
    const { asked, run } = answering("{\"version\":1}", JSON.stringify(tour));
    const made = await makeTour({ agent: claude, context, cwd: "/repo", run }).done;
    expect(made.ok).toBe(true);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain("Your previous answer was rejected:");
  });

  it("gives up after the second rejection", async () => {
    const { asked, run } = answering("nope", "still nope");
    const made = await makeTour({ agent: claude, context, cwd: "/repo", run }).done;
    expect(made.ok).toBe(false);
    expect(asked).toHaveLength(2);
  });
});
