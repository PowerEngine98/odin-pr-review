import { beforeEach, describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph } from "@odin/core";

import { forgetFrames, forgetRan, frames } from "./vscode-stub.js";

function graphOf(live: boolean): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: {
      generator: "test",
      baseRef: "main",
      headRef: live ? "feat/x" : "origin/feat/x",
      ...(live ? { worktree: true } : {}),
      pullRequest: { number: 7, title: "Seven", url: "https://example.invalid/o/r/pull/7" },
    },
    nodes: [
      {
        id: "n:src/a.ts",
        path: "src/a.ts",
        status: "modified",
        language: "typescript",
        binary: false,
        stats: { additions: 1, deletions: 0 },
        symbols: [],
        hunks: [],
      },
    ],
    edges: [],
  } as unknown as ChangeGraph;
}

function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("discussing a tour frame on a committed reading", () => {
  beforeEach(() => {
    forgetFrames();
    forgetRan();
  });

  it("goes live, carries the tour across, and hands the frame to the live reading", async () => {
    const { GraphPanel } = await import("../src/panel.js");
    for (const held of GraphPanel.readings()) held.dispose();
    GraphPanel.store = memento() as never;
    const tours = new Map<string, unknown>();
    GraphPanel.tours = {
      read: (key: string) => tours.get(key),
      write: (key: string, saved: unknown) => void tours.set(key, saved),
      flush: () => {},
    } as never;

    const committed = graphOf(false);
    GraphPanel.show(committed, layoutGraph(committed), "/repo", undefined, undefined, undefined, undefined, "committed");
    const before = GraphPanel.readings()[0]!;
    tours.set((before as unknown as { tourKey(): string }).tourKey(), { tour: { topics: ["t"] }, progress: {} });
    const committedFrame = frames[frames.length - 1]!;

    const moved: [unknown, unknown][] = [];
    const follower = (old: unknown, next: unknown) => void moved.push([old, next]);
    GraphPanel.followers.add(follower);

    let asked: unknown[] = [];
    GraphPanel.onGoLive = async (repo, number) => {
      asked = [repo, number];
      const live = graphOf(true);
      (GraphPanel as unknown as { promoting?: string[] }).promoting = ["committed"];
      GraphPanel.show(live, layoutGraph(live), "/repo", undefined, undefined, undefined, undefined, "live");
    };

    committedFrame.say({ type: "goLiveDiscuss", payload: { attached: { topic: 1, frame: 2, say: "why?" } } });
    await settle();

    expect(asked).toEqual(["/repo", 7]);
    const liveFrame = frames[frames.length - 1]!;
    expect(liveFrame).not.toBe(committedFrame);
    const sent = liveFrame.sent.map((one) => one.type);
    expect(sent).toContain("tour");
    expect(sent.indexOf("tour")).toBeLessThan(sent.indexOf("discussPending"));
    expect(liveFrame.sent.find((one) => one.type === "discussPending")).toMatchObject({
      attached: { topic: 1, frame: 2, say: "why?" },
    });
    expect(moved.length).toBe(1);
    expect(moved[0]![0]).toBe(before);
    GraphPanel.followers.delete(follower);
  });

  it("tells the page why when going live fails, and leaves nothing waiting", async () => {
    const { GraphPanel } = await import("../src/panel.js");
    for (const held of GraphPanel.readings()) held.dispose();
    GraphPanel.store = memento() as never;
    const committed = graphOf(false);
    GraphPanel.show(committed, layoutGraph(committed), "/repo", undefined, undefined, undefined, undefined, "committed");
    const frame = frames[frames.length - 1]!;
    GraphPanel.onGoLive = async () => {
      throw new Error("/repo has uncommitted changes.");
    };
    frame.say({ type: "goLiveDiscuss", payload: { attached: { topic: 1 } } });
    await settle();
    expect(frame.sent.find((one) => one.type === "goLiveFailed")).toMatchObject({
      message: "VS Code could not go live: /repo has uncommitted changes.",
    });

    const live = graphOf(true);
    GraphPanel.show(live, layoutGraph(live), "/repo", undefined, undefined, undefined, undefined, "live");
    await settle();
    expect(frames[frames.length - 1]!.sent.some((one) => one.type === "discussPending")).toBe(false);
  });
});
