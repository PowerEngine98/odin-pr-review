import { mkdtempSync, chmodSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverAgents, KNOWN_AGENTS } from "../src/agents/discover.js";
import { markOf } from "../src/agents/marks.js";
import { avatarFor, markOf } from "../src/agents/marks.js";

/**
 * A directory of fake agents, which is the only honest way to test this.
 *
 * What is being checked is a decision about the machine the reader is on, and
 * that machine has whatever it happens to have. Standing up executables with
 * the right names on a PATH of our own makes the answer something the test
 * controls rather than something it discovers.
 */
function fakeBin(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-agents-"));
  return dir;
}

function put(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

describe("finding the agents this machine can run", () => {
  let bin: string;
  beforeAll(() => {
    bin = fakeBin();
  });
  afterAll(() => rmSync(bin, { recursive: true, force: true }));

  const look = (extra: Record<string, string> = {}) =>
    discoverAgents({
      cwd: bin,
      timeoutMs: 4000,
      env: { PATH: `${bin}:/usr/bin:/bin`, ...extra },
    });

  it("finds nothing in an empty directory", async () => {
    expect(await look()).toEqual([]);
  });

  it("reports one that is installed and answers", async () => {
    put(bin, "claude", 'echo "claude 1.2.3"');
    const found = await look();
    expect(found.map((a) => a.id)).toEqual(["claude"]);
    expect(found[0]?.version_).toBe("claude 1.2.3");
    expect(found[0]?.path).toBe(join(bin, "claude"));
  });

  it("does not offer one that is on PATH and will not run", async () => {
    /*
     * The failure this exists for: a shim left behind by an uninstall, a
     * binary for the wrong architecture, a tool that wants a login first.
     * `which` finds all of those. Offering one would mean the reader enabling
     * it, writing a comment and watching nothing happen — with the panel
     * saying the agent is there.
     */
    put(bin, "codex", "exit 1");
    expect((await look()).map((a) => a.id)).toEqual(["claude"]);
  });

  it("finds several at once", async () => {
    put(bin, "codex", 'echo "codex 0.9"');
    put(bin, "gemini", 'echo "gemini 2"');
    const found = await look();
    expect(found.map((a) => a.id).sort()).toEqual(["claude", "codex", "gemini"]);
  });

  it("keeps the first line of a tool that says too much", async () => {
    put(bin, "aider", 'echo "aider 0.1"; echo "and a banner"; echo "and a tip"');
    const found = await look();
    expect(found.find((a) => a.id === "aider")?.version_).toBe("aider 0.1");
  });

  it("gives up on one that never answers", async () => {
    // A tool waiting on a keystroke that will never come looks exactly like a
    // tool thinking hard, and the panel would wait for it forever.
    put(bin, "cursor-agent", "sleep 30");
    const found = await discoverAgents({
      cwd: bin,
      timeoutMs: 300,
      env: { PATH: `${bin}:/usr/bin:/bin` },
    });
    expect(found.map((a) => a.id)).not.toContain("cursor");
  }, 10_000);

  it("names every known tool distinctly", () => {
    // The id is what a setting is filed under and the name is what `@name`
    // matches in a comment. Two agents sharing either would mean one of them
    // silently taking the other's work.
    const ids = KNOWN_AGENTS.map((a) => a.id);
    const names = KNOWN_AGENTS.map((a) => a.name.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * A face for each agent.
 *
 * Everybody else in a thread has a picture, and an agent writing into the same
 * thread without one reads as a system message rather than as somebody talking
 * — which defeats the point of putting them in the comments at all.
 */
describe("what an agent looks like in a thread", () => {
  it("gives every known agent its own colour", () => {
    // The colour is what actually does the telling apart. Two agents sharing
    // one would make the list unreadable at a glance, which is the only way it
    // is ever read.
    const colours = KNOWN_AGENTS.map((agent) => markOf(agent.id).color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("has something for an agent it has never heard of", () => {
    const mark = markOf("something-new");
    expect(mark.color).toBeTruthy();
    expect(mark.path).toBeTruthy();
  });

  it("builds an image a document can carry with it", () => {
    // Not fetched: a webview refuses a remote image, and the page `odin view`
    // writes has no server behind it.
    const face = avatarFor("claude");
    expect(face.startsWith("data:image/svg+xml,")).toBe(true);
    // Nothing in it points anywhere. The one `http` inside is the SVG
    // namespace, which is a name and not an address — no agent fetches it.
    expect(face).not.toContain("href");
    expect(face).not.toContain("src=");
    expect(face.replace("http://www.w3.org/2000/svg", "")).not.toContain("http");
  });

  it("escapes the characters that would end the attribute", () => {
    /*
     * An unescaped `<` or `#` inside a data URI ends the source attribute or
     * starts a fragment, and what the reader gets is a broken-image glyph
     * beside every message an agent wrote.
     */
    const face = avatarFor("gemini");
    expect(face).not.toContain("<");
    expect(face).not.toContain(">");
    expect(face).not.toContain('"');
    // The colour travels as an escaped hash rather than as one.
    expect(face).toContain("%23");
  });

  it("draws a stroked mark as a stroke and a filled one as a fill", () => {
    // A stroked path drawn as a fill is a blob; a filled one drawn as a stroke
    // is an outline of a blob. Either is a face nobody recognises.
    expect(avatarFor("codex")).toContain("stroke-width");
    expect(avatarFor("gemini")).not.toContain("stroke-width");
  });
});

/**
 * opencode, which names its rungs after agents rather than flags.
 *
 * `plan` looks and does not touch; `build` is the primary one that writes, and
 * how much it may do without asking is the reader's own permission config —
 * theirs to set and not ours to override.
 */
describe("opencode", () => {
  const kind = () => KNOWN_AGENTS.find((agent) => agent.id === "opencode")!;

  it("is looked for", () => {
    expect(kind()).toBeDefined();
    expect(kind().command).toBe("opencode");
  });

  it("is asked one question at a time", () => {
    // The bare command starts its terminal interface, which would sit waiting
    // for a keystroke that never comes.
    expect(kind().once).toEqual(["run"]);
  });

  it("has the two rungs it actually has, and not a third", () => {
    /*
     * There is no "ask me nothing" switch, and a rung with the same arguments
     * as the one below it would be a control that reads as doing something and
     * does not. The panel shows only the rungs a tool offers.
     */
    expect(kind().agency).toEqual({
      read: ["--agent", "plan"],
      edits: ["--agent", "build"],
    });
    expect(kind().agency?.full).toBeUndefined();
  });

  it("says nothing about carrying a conversation, because it cannot be told one", () => {
    // `--session` continues a session that exists; there is no naming one that
    // does not, so each turn is a fresh one and the page says so.
    expect(kind().session).toBeUndefined();
  });

  it("has a face of its own", () => {
    const mine = markOf("opencode");
    expect(mine).not.toEqual(markOf("something-nobody-planned-for"));
    expect(mine.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
