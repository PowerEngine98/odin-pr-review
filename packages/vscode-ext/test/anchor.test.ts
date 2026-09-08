import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PairingSession } from "../src/pairing.js";
import { asked, forgetAsked, readerSays } from "./vscode-stub.js";

/**
 * A remark keeping hold of its code while an agent moves it.
 *
 * The situation, in order: the reader writes about a line; another message is
 * already in the queue; the agent taking that one inserts lines above; the file
 * is now numbered differently. Everything downstream of the remark — the mark
 * in the margin, the composer, and the prompt built when this message is
 * finally taken — was written against the old number, and the last of those is
 * the one that does damage, because it points an agent at code the reader never
 * looked at.
 *
 * Driven against a real file and a real agent, because every part of it is a
 * question about what is on disk at the moment something is built.
 */
const FILE = [
  "export function total(items) {",
  "  let sum = 0;",
  "  for (const item of items) {",
  "    sum += item.price;",
  "  }",
  "  return sum;",
  "}",
  "",
].join("\n");

function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
    held,
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

describe("a remark whose code moves under it", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-anchor-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-anchor-repo-"));
    mkdirSync(join(repo, "src"), { recursive: true });

    // Its own arguments to the log, which is where the prompt an agent was
    // actually handed becomes visible from outside.
    const file = join(bin, "claude");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi',
        'for a in "$@"; do p="$a"; done',
        'echo "PROMPT: $p" >&2',
        'echo "CLAUDE SAYS: done"',
      ].join("\n"),
    );
    chmodSync(file, 0o755);

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    forgetAsked();
    writeFileSync(join(repo, "src/total.ts"), FILE);
  });

  /** A live session with nobody switched on, so a message sits in the queue. */
  async function idle() {
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {}, true);
    await paired.look();
    return { paired, store };
  }

  const about = {
    path: "src/total.ts",
    line: 2,
    side: "RIGHT" as const,
    author: "marco",
  };

  it("remembers the code, not only the line", async () => {
    const { paired } = await idle();
    paired.ask({ ...about, body: "start it at one" });
    expect(paired.local()[0]?.anchor?.text).toBe("  let sum = 0;");
  }, 20_000);

  it("moves the remark when something is inserted above it", async () => {
    /*
     * The mark in the margin, the conversation panel and the composer all draw
     * from this. Left alone they sit on a number that now names an import.
     */
    const { paired } = await idle();
    paired.ask({ ...about, body: "start it at one" });

    writeFileSync(join(repo, "src/total.ts"), `// a header\n// another\n${FILE}`);
    expect(paired.local()[0]?.line).toBe(4);
  }, 20_000);

  it("keeps a span a span as it moves", async () => {
    const { paired } = await idle();
    paired.ask({ ...about, line: 4, startLine: 3, body: "this loop" });

    writeFileSync(join(repo, "src/total.ts"), `// a header\n${FILE}`);
    expect(paired.local()[0]).toMatchObject({ startLine: 4, line: 5 });
  }, 20_000);

  it("hands the agent the line the code is on now, not the one it was on", async () => {
    /*
     * The expensive one. A message can wait minutes in the queue behind another
     * agent editing the very file it is about, and the prompt is built when it
     * is taken rather than when it was written.
     */
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {}, true);
    await paired.look();
    paired.ask({ ...about, body: "start it at one" });

    writeFileSync(join(repo, "src/total.ts"), `// a header\n// another\n${FILE}`);
    paired.setOrder(["claude"]);

    await until(() => paired.transcript("claude").includes("PROMPT:"), 20_000);
    const prompt = paired.transcript("claude");
    expect(prompt).toContain("src/total.ts:4");
    expect(prompt).toContain("it was at 2");
  }, 30_000);

  it("leaves a remark alone when nothing has moved", async () => {
    const { paired } = await idle();
    paired.ask({ ...about, body: "start it at one" });
    expect(paired.local()[0]?.line).toBe(2);
    expect(paired.local()[0]?.adrift).toBeUndefined();
  }, 20_000);
});

describe("a remark whose code has gone", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-gone-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-gone-repo-"));
    mkdirSync(join(repo, "src"), { recursive: true });

    const file = join(bin, "claude");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi',
        'for a in "$@"; do p="$a"; done',
        'echo "PROMPT: $p" >&2',
        'echo "CLAUDE SAYS: done"',
      ].join("\n"),
    );
    chmodSync(file, 0o755);

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    forgetAsked();
    writeFileSync(join(repo, "src/total.ts"), FILE);
  });

  const about = {
    path: "src/total.ts",
    line: 2,
    side: "RIGHT" as const,
    author: "marco",
  };

  async function askedThenRewritten(order = true) {
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {}, true);
    await paired.look();
    paired.ask({ ...about, body: "start it at one" });
    // Rewritten, not moved: the passage is not in the file anywhere now.
    writeFileSync(
      join(repo, "src/total.ts"),
      FILE.replace("  let sum = 0;", "  let running = 0;"),
    );
    if (order) paired.setOrder(["claude"]);
    return paired;
  }

  it("marks it adrift rather than leaving it pointing at something else", async () => {
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {}, true);
    await paired.look();
    paired.ask({ ...about, body: "start it at one" });
    writeFileSync(
      join(repo, "src/total.ts"),
      FILE.replace("  let sum = 0;", "  let running = 0;"),
    );

    const shown = paired.local()[0];
    expect(shown?.adrift).toBe(true);
    // And it keeps the line it had. There is nowhere honest to move it to, and
    // the number is still where the reader wrote it.
    expect(shown?.line).toBe(2);
  }, 20_000);

  it("asks the reader before sending it anywhere", async () => {
    /*
     * There are only bad defaults here. Sending it on points an agent at a line
     * naming code nobody has seen; dropping it loses a question somebody wrote.
     * Neither is the tool's decision.
     */
    readerSays(undefined);
    const paired = await askedThenRewritten();
    await until(() => asked.length > 0, 20_000);

    expect(asked[0]?.message).toContain("no longer in src/total.ts");
    expect(asked[0]?.choices).toContain("Ask anyway");
    expect(paired.transcript("claude")).not.toContain("PROMPT:");
  }, 30_000);

  it("holds the agent while the reader is deciding", async () => {
    /*
     * The agent is spoken for from the moment its message is taken, not from
     * the moment a process starts. Those were the same instant until a decision
     * the reader might have to make was put between them — and for as long as
     * that dialogue is open the agent would otherwise read as idle, so the
     * queue hands it a second message and the page draws it as free while a
     * question about its first one is on screen.
     */
    readerSays(undefined);
    const paired = await askedThenRewritten();
    expect(paired.busy()).toContain("claude");
  }, 30_000);

  it("says so in the thread when the reader closes the dialogue", async () => {
    // A warning that appeared once in the corner and vanished is not a record.
    // The conversation is where the record of this whole thing lives.
    readerSays(undefined);
    const paired = await askedThenRewritten();
    await until(() => paired.local().some((one) => one.author === "Odin"), 20_000);

    const note = paired.local().find((one) => one.author === "Odin");
    expect(note?.body).toContain("no longer in the file");
  }, 30_000);

  it("sends it with the code quoted when the reader says to", async () => {
    /*
     * Honestly, which is the point. The prompt says the line number no longer
     * names the passage and quotes what it was, so the agent looks for the code
     * rather than editing whatever is sitting on that line.
     */
    readerSays("Ask anyway");
    const paired = await askedThenRewritten();
    await until(() => paired.transcript("claude").includes("PROMPT:"), 20_000);

    const prompt = paired.transcript("claude");
    expect(prompt).toContain("no longer there");
    expect(prompt).toContain("let sum = 0;");
  }, 30_000);
});

describe("a reading of committed code", () => {
  it("anchors nothing, because the working tree is not what is being read", async () => {
    /*
     * The file on disk is somebody else's branch, or an older state of this
     * one. Looking a remark's passage up in it would anchor the remark to
     * whatever that file happens to contain, which is worse than not anchoring.
     */
    const repo = mkdtempSync(join(tmpdir(), "odin-committed-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/total.ts"), FILE);

    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {});
    paired.ask({
      path: "src/total.ts",
      line: 2,
      side: "RIGHT" as const,
      author: "marco",
      body: "start it at one",
    });

    expect(paired.local()[0]?.anchor).toBeUndefined();

    writeFileSync(join(repo, "src/total.ts"), `// a header\n${FILE}`);
    expect(paired.local()[0]?.line).toBe(2);

    rmSync(repo, { recursive: true, force: true });
  });
});
