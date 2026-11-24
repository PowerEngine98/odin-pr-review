import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { heardIn, projectFolder, TranscriptFollower } from "../src/transcript.js";

const line = (entry: object) => `${JSON.stringify(entry)}\n`;
const user = (content: unknown, extra: object = {}) => line({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (content: unknown, extra: object = {}) => line({ type: "assistant", message: { role: "assistant", content }, ...extra });

describe("what a CLI conversation said, read back from its transcript", () => {
  it("keeps what the reader typed and what the agent wrote, and nothing else", () => {
    const said = heardIn(
      [
        user("rename this to OrderTotal"),
        assistant([{ type: "text", text: "Renaming it." }, { type: "tool_use", name: "Edit" }]),
        user([{ type: "tool_result", content: "ok" }]),
        user("<command-name>/clear</command-name>"),
        assistant([{ type: "text", text: "from a helper" }], { isSidechain: true }),
        line({ type: "summary", summary: "x" }),
        "not json\n",
        assistant([{ type: "text", text: "Done: Order.kt now uses OrderTotal." }]),
      ].join("").split("\n"),
    );
    expect(said).toEqual([
      { role: "user", text: "rename this to OrderTotal" },
      { role: "assistant", text: "Renaming it." },
      { role: "assistant", text: "Done: Order.kt now uses OrderTotal." },
    ]);
  });

  it("is looked for where Claude keeps a folder's sessions", () => {
    expect(projectFolder("/work/my.app", "/home/someone")).toBe("/home/someone/.claude/projects/-work-my-app");
  });

  it("follows a resumed session from where it was when the CLI opened", () => {
    const folder = mkdtempSync(join(tmpdir(), "odin-transcript-"));
    writeFileSync(join(folder, "s1.jsonl"), user("old question") + assistant([{ type: "text", text: "old answer" }]));
    const heard: string[] = [];
    const follower = new TranscriptFollower(folder, "s1", (said) => heard.push(...said.map((one) => one.text)), () => undefined);
    follower.poll();
    appendFileSync(join(folder, "s1.jsonl"), user("new question"));
    follower.poll();
    appendFileSync(join(folder, "s1.jsonl"), assistant([{ type: "text", text: "new answer" }]).slice(0, 20));
    follower.poll();
    const rest = assistant([{ type: "text", text: "new answer" }]).slice(20);
    appendFileSync(join(folder, "s1.jsonl"), rest);
    follower.poll();
    expect(heard).toEqual(["new question", "new answer"]);
  });

  it("finds the session a fresh CLI started, and says which it is", () => {
    const folder = mkdtempSync(join(tmpdir(), "odin-transcript-"));
    const found: string[] = [];
    const heard: string[] = [];
    const follower = new TranscriptFollower(folder, undefined, (said) => heard.push(...said.map((one) => one.text)), (session) => found.push(session));
    writeFileSync(join(folder, "fresh-id.jsonl"), user("hello"));
    follower.poll();
    expect(found).toEqual(["fresh-id"]);
    expect(heard).toEqual(["hello"]);
  });
});

describe("one conversation, whichever view it is written in", () => {
  const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");
  const cli = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");
  const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
  const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");

  it("types a message for an agent whose CLI is open into that CLI, instead of starting a second process", () => {
    expect(pairing).toMatch(/if \(this\.handOff\(ask, agentId\)\) \{\s*this\.pump\(\);\s*return;\s*\}/);
    expect(pairing).toMatch(/if \(!this\.terminal\?\.holds\(agentId\)\) return false;/);
    expect(panel).toMatch(/holds: \(agent\) => terminals\.live\(agent\),\s*type: \(agent, text\) => terminals\.send\(agent, text\),/);
  });

  it("writes what happens in the CLI into the Log, and keeps the session the CLI used", () => {
    expect(panel).toMatch(/heard: \(agent, said\) =>\s*this\.pairing\(\)\.heard\(agent, said,/);
    expect(panel).toMatch(/adopt: \(agent, session\) => this\.pairing\(\)\.adopt\(agent, session\),/);
    expect(pairing).toMatch(/if \(to !== undefined && this\.rootOf\(to\)\) this\.reply\(to, this\.nameOf\(agentId\), agentId, one\.text, false\);/);
    expect(pairing).toMatch(/task: where\.fromTerminal \? "done" : "queued",/);
  });

  it("does not write back what Odin itself typed", () => {
    expect(cli).toMatch(/for \(const text of queue\) running\.typed\.push\(text\.trim\(\)\);/);
    expect(cli).toMatch(/const at = running\.typed\.indexOf\(one\.text\.trim\(\)\);/);
  });

  it("has no composer of its own in the CLI tab", () => {
    expect(terminal).toMatch(/\{#if tab !== "cli"\}\s*<form\s*class="terminal-ask"/);
  });
});

describe("the CLI screen", () => {
  const cli = readFileSync(join(__dirname, "../../webview/src/app/hud/Cli.svelte"), "utf8");

  it("stretches its lines so the rows fill the screen, leaving no strip under the last one", () => {
    expect(cli).toMatch(/term\.options\.lineHeight = 1;\s*fit\.fit\(\);\s*term\.options\.lineHeight = fillingLineHeight\(term, holder\);\s*fit\.fit\(\);/);
  });
});

describe("the CLI tab's size", () => {
  const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");
  const screen = readFileSync(join(__dirname, "../../webview/src/app/hud/Cli.svelte"), "utf8");

  it("is the height the console was dragged to, since a terminal has no content height of its own to grow into", () => {
    expect(terminal).toMatch(/class:filling=\{tab === "cli" && !folded\}/);
    expect(terminal).toMatch(/\.terminal\.filling \{\s*height: 100vh;\s*\}/);
  });

  it("shrinks with the console instead of holding it open", () => {
    expect(screen).toMatch(/\.cli \{\s*display: flex;\s*flex: 1;\s*flex-direction: column;\s*min-height: 0;\s*\}/);
  });
});
