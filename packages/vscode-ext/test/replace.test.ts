import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph } from "@odin/core";

import { forgetFrames, frames } from "./vscode-stub.js";

/**
 * Where a remark that has not been sent yet should now be.
 *
 * The store renumbers the remarks it holds, because it has the passage each was
 * written against. A draft waiting on a verdict, and the box the reader is
 * typing into, are not in the store — and in a live reading an agent's edit
 * moves every line below it. The region picked a minute ago now covers
 * different code, nothing on screen says so, and pressing send files the remark
 * against lines nobody looked at.
 *
 * The page keeps the picked code with each one and asks; this is the answer.
 */
const FILE = [
  "export function total(items) {", // 1
  "  let sum = 0;", // 2
  "  for (const item of items) {", // 3
  "    sum += item.price;", // 4
  "  }", // 5
  "  return sum;", // 6
  "}", // 7
  "",
].join("\n");

function graphOf(live: boolean): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: {
      generator: "test",
      baseRef: "main",
      headRef: live ? "topic-live" : "topic",
      ...(live ? { worktree: true } : {}),
    },
    nodes: [
      {
        id: "n:one",
        path: "src/total.ts",
        status: "modified",
        language: "typescript",
        binary: false,
        stats: { additions: 1, deletions: 0 },
        symbols: [],
        hunks: [
          {
            header: "",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [{ kind: "add", text: "  let sum = 0;", newLine: 2 }],
          },
        ],
      },
    ],
    edges: [],
  } as ChangeGraph;
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

/**
 * One panel, opened once and asked repeatedly.
 *
 * Opening it again would not make a second frame: a reading already on screen
 * is revealed rather than rebuilt, which is the whole of the tab rule. So the
 * frame is kept and the messages are sent into it.
 */
async function open(live: boolean, repo: string) {
  forgetFrames();
  const { GraphPanel } = await import("../src/panel.js");
  GraphPanel.store = memento() as never;

  const graph = graphOf(live);
  GraphPanel.show(graph, layoutGraph(graph), repo);
  return frames[0]!;
}

async function answer(
  frame: { say: (m: unknown) => void; sent: { type?: string }[] },
  anchors: unknown[],
): Promise<{ id: string; line?: number; startLine?: number; gone?: boolean }[]> {
  frame.sent.length = 0;
  frame.say({ type: "replace", payload: { anchors } });

  const stop = Date.now() + 4000;
  while (Date.now() < stop && !frame.sent.some((one) => one.type === "replaced")) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const said = frame.sent.find((one) => one.type === "replaced") as
    | { payload?: { spans?: never[] } }
    | undefined;
  return (said?.payload?.spans ?? []) as never;
}

describe("an unsent remark in a live reading", () => {
  let repo: string;
  let frame: Awaited<ReturnType<typeof open>>;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "odin-replace-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/total.ts"), FILE);
    frame = await open(true, repo);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  beforeEach(() => writeFileSync(join(repo, "src/total.ts"), FILE));

  const picked = {
    id: "a",
    path: "src/total.ts",
    text: "  for (const item of items) {\n    sum += item.price;",
    line: 4,
    startLine: 3,
  };

  it("follows its code down the file", async () => {
    // Nine lines go in above it — an agent taking an earlier remark — and every
    // number below moves. This is the whole of the fault.
    writeFileSync(join(repo, "src/total.ts"), `// a header\n// another\n${FILE}`);
    const [span] = await answer(frame, [picked]);

    expect(span).toEqual({ id: "a", line: 6, startLine: 5 });
  });

  it("says nothing when it has not moved", async () => {
    // A span left out is a span left alone, which is the cheapest way to say
    // "nothing to do" and the one the page already understands.
    const [span] = await answer(frame, [picked]);
    expect(span).toEqual({ id: "a" });
  });

  it("says its code has gone rather than guessing", async () => {
    /*
     * Something rewrote the passage. There is nowhere honest to put the remark,
     * and moving it to whatever now sits on those lines is precisely the
     * failure this exists to prevent — done silently, which is worse.
     */
    writeFileSync(
      join(repo, "src/total.ts"),
      FILE.replace("    sum += item.price;", "    sum += price(item);"),
    );
    const [span] = await answer(frame, [picked]);
    expect(span).toEqual({ id: "a", gone: true });
  });

  it("leaves a remark alone when the file cannot be read", async () => {
    const [span] = await answer(frame, [{ ...picked, path: "src/nothing.ts" }]);
    expect(span).toEqual({ id: "a" });
  });
});

describe("an unsent remark in a reading of committed code", () => {
  let repo: string;
  let frame: Awaited<ReturnType<typeof open>>;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "odin-replace-committed-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/total.ts"), `// a header\n${FILE}`);
    frame = await open(false, repo);
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("is never moved, whatever the working tree happens to say", async () => {
    /*
     * The file on disk is not the file being read — it is somebody else's
     * branch, or an older state of this one. Searching it for a remark's
     * passage would anchor the remark to whatever that file contains, which is
     * worse than not anchoring at all. Nothing moves under a committed reading,
     * so nothing needs to.
     */
    const [span] = await answer(frame, [
      {
        id: "a",
        path: "src/total.ts",
        text: "  let sum = 0;",
        line: 2,
      },
    ]);
    expect(span).toEqual({ id: "a" });
  });
});
