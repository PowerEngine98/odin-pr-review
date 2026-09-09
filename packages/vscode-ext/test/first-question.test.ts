import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { layoutGraph, type ChangeGraph } from "@odin/core";

import { forgetFrames, frames } from "./vscode-stub.js";

/**
 * The first question of a session, which used to reload the whole change.
 *
 * Who is reading is written into the document when it is built, and on a freshly
 * opened tab the forge has not been asked yet — so the first question is what
 * sends Odin to find out. The answer arrived by building the document again, and
 * building it again replaces the page: the loader came back, every card was made
 * afresh, the camera lost its place, and the reader watched the change reload
 * underneath the question they had just written.
 *
 * On the first question and no other, because the second finds the answer
 * already known and returns before doing anything. That is what made it look
 * like a haunting rather than a bug.
 *
 * It is a name and a picture. They go over the channel every other piece of news
 * goes over, and nothing else about the drawing is touched.
 */
function change(): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: { generator: "test", baseRef: "main", headRef: "topic" },
    nodes: [
      {
        id: "n:one",
        path: "src/one.ts",
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
            lines: [{ kind: "add", text: "const a = 1;", newLine: 1 }],
          },
        ],
      },
    ],
    edges: [],
  } as ChangeGraph;
}

/** A store that forgets nothing, which the pairing session wants. */
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

async function until(what: () => boolean, ms = 8000): Promise<void> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("gave up waiting");
}

describe("asking the first question", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-first-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-first-repo-"));

    // A forge that knows who is reading, so the answer actually arrives —
    // which is the only condition under which the redraw ever happened.
    const gh = join(bin, "gh");
    writeFileSync(gh, "#!/bin/sh\necho marcoacosta\n");
    chmodSync(gh, 0o755);

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("tells the page who is reading without rebuilding it", async () => {
    forgetFrames();
    const { GraphPanel } = await import("../src/panel.js");
    GraphPanel.store = memento() as never;

    const graph = change();
    GraphPanel.show(graph, layoutGraph(graph), repo);

    const frame = frames[0]!;
    const built = frame.writes;
    expect(built).toBeGreaterThan(0);

    frame.say({
      type: "askAgents",
      payload: {
        path: "src/one.ts",
        line: 1,
        side: "RIGHT",
        body: "what is this for?",
      },
    });

    // The name arrives a beat later, over the channel.
    await until(() => frame.sent.some((one) => one.type === "viewer"));

    const said = frame.sent.find((one) => one.type === "viewer") as
      | { login?: string }
      | undefined;
    expect(said?.login).toBe("marcoacosta");

    /*
     * And the document was not replaced to say it. This is the assertion the
     * whole file is for: everything above it passed before the fix as well.
     */
    expect(frame.writes).toBe(built);
  }, 20_000);
});
