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
      { role: "work", text: "→ Edit" },
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

describe("a fresh CLI's session, told apart from the ones already there", () => {
  it("is the file that appeared or grew after the CLI opened, whatever the clock says", () => {
    const folder = mkdtempSync(join(tmpdir(), "odin-transcript-"));
    writeFileSync(join(folder, "older.jsonl"), user("from before"));
    const found: string[] = [];
    const heard: string[] = [];
    const follower = new TranscriptFollower(folder, undefined, (said) => heard.push(...said.map((one) => one.text)), (session) => found.push(session));
    follower.poll();
    expect(found).toEqual([]);
    appendFileSync(join(folder, "older.jsonl"), user("continued here"));
    follower.poll();
    expect(found).toEqual(["older"]);
    expect(heard).toEqual(["continued here"]);
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

describe("the Log, while the CLI holds the conversation", () => {
  const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");

  it("shows a message written in the Log, though the CLI is the one that answers it", () => {
    expect(pairing).toMatch(/this\.terminal\.type\(agentId, [^\n]+\);\s*this\.printAsked\(agentId, claiming\?\.id \?\? id, ask\.label \|\| ask\.body\);/);
  });

  it("shows what was typed in the CLI, and what the agent answered there", () => {
    expect(pairing).toMatch(/this\.printAsked\(agentId, comment\.id, one\.text\);\s*this\.terminalBusy\(agentId, true\);\s*continue;\s*\}\s*this\.print\(agentId, `\\n\$\{one\.text\}\\n`\);/);
  });

  it("marks an ask the same way a background turn does, so the Log draws it as the reader's", () => {
    expect(pairing).toMatch(/\.map\(\(line\) => `\[odin:ask \$\{thread\}\] \$\{line\}`\)/);
  });
});

describe("Shift+Enter in the CLI", () => {
  const screen = readFileSync(join(__dirname, "../../webview/src/app/hud/Cli.svelte"), "utf8");

  it("starts a new line instead of sending, the way Option+Enter does in Claude's own terminal", () => {
    expect(screen).toMatch(/const NEW_LINE = "\\x1b\\r";/);
    expect(screen).toMatch(/if \(!isShiftEnter\(event\)\) return true;\s*if \(event\.type === "keydown"\) notify\("cliInput", \{ agent, data: NEW_LINE \}\);\s*return false;/);
    expect(screen).toMatch(/event\.key === "Enter" && event\.shiftKey && !event\.ctrlKey && !event\.altKey && !event\.metaKey/);
  });
});

describe("the clipboard in the CLI", () => {
  const screen = readFileSync(join(__dirname, "../../webview/src/app/hud/Cli.svelte"), "utf8");
  const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");

  it("lets the editor see copy and paste, which it only does from keys that reach the page", () => {
    expect(screen).toMatch(/onkeydown=\{\(event\) => \{\s*if \(!isClipboard\(event\)\) event\.stopPropagation\(\);\s*\}\}/);
    expect(screen).toMatch(/\["c", "v", "x", "a"\]\.includes\(key\) && \(event\.metaKey \|\| \(event\.ctrlKey && event\.shiftKey\)\)/);
  });

  it("copies the terminal's own selection, which is not a selection the page knows about", () => {
    expect(screen).toMatch(/\(key === "c" \|\| key === "x"\) && term\?\.hasSelection\(\)\) \{\s*notify\("copyText", \{ text: term\.getSelection\(\) \}\);/);
  });

  it("pastes a picture as a file Claude can attach, pasted the way a terminal pastes", () => {
    expect(screen).toMatch(/holder\.addEventListener\("paste", pasted, true\);/);
    expect(screen).toMatch(/notify\("cliImages", \{ agent, images \}\)/);
    expect(panel).toMatch(/const paths = keepPasted\(images, \(this\.images \?\?= imageFolder\(\)\)\);\s*if \(paths\.length > 0\) this\.cli\(\)\.input\(agent, `\\x1b\[200~\$\{paths\.join\(" "\)\}\\x1b\[201~`\);/);
  });
});

describe("the Log, while the CLI works", () => {
  const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");
  const cli = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");

  it("shows the tools the agent runs, as a background turn shows them, and when its turn ends", () => {
    const said = heardIn(
      [
        assistant([{ type: "tool_use", name: "Bash", input: { command: "git status" } }]),
        user([{ type: "tool_result", content: "clean" }]),
        line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Clean." }], stop_reason: "end_turn" } }),
        user("[Request interrupted by user]"),
      ].join("").split("\n"),
    );
    expect(said).toEqual([
      { role: "work", text: "→ Bash(git status)" },
      { role: "assistant", text: "Clean." },
      { role: "done", text: "" },
      { role: "done", text: "" },
    ]);
  });

  it("is working while the CLI works, and idle when the turn ends or the CLI stops", () => {
    expect(pairing).toMatch(/if \(one\.role === "work"\) \{\s*this\.terminalBusy\(agentId, true\);\s*this\.print\(agentId, `\$\{one\.text\}\\n`\);/);
    expect(pairing).toMatch(/if \(one\.role === "done"\) \{\s*this\.terminalBusy\(agentId, false\);/);
    expect(pairing).toMatch(/this\.inTerminal\.set\(agentId, id\);\s*this\.state\.set\(agentId, "working"\);/);
    expect(cli).toMatch(/if \(this\.running\.get\(agent\) === running\) this\.running\.delete\(agent\);\s*this\.host\.ended\?\.\(agent\);/);
  });

  it("hands the next waiting message over once the CLI is free", () => {
    expect(pairing).toMatch(/this\.changed\(\);\s*if \(!busy\) this\.pump\(\);/);
  });
});

describe("a question the agent asks inside the CLI", () => {
  const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");
  const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");

  it("is noticed in the transcript, since only the terminal can draw it", () => {
    const said = heardIn(assistant([{ type: "tool_use", name: "AskUserQuestion", input: { questions: [] } }]).split("\n"));
    expect(said.map((one) => one.role)).toEqual(["work", "asking"]);
  });

  it("says in the Log where to answer it, and brings the CLI tab forward", () => {
    expect(pairing).toMatch(/is asking you something in the CLI tab\. Answer it there\./);
    expect(terminal).toMatch(/const askedInCli = \$derived\(ui\.cliAsking\.includes\(id\)\);\s*\$effect\(\(\) => \{\s*if \(askedInCli\) tab = "cli";/);
  });

  it("lets go once anything else happens in the CLI, or it stops", () => {
    expect(pairing).toMatch(/if \(this\.askingInTerminal\.delete\(agentId\)\) this\.changed\(\);/);
  });
});

describe("following a transcript written in more than ASCII", () => {
  it("loses nothing however many accents and dashes come before, even an entry arriving in pieces", () => {
    const folder = mkdtempSync(join(tmpdir(), "odin-transcript-"));
    const file = join(folder, "s1.jsonl");
    writeFileSync(file, user("¿Dónde está la sesión? — ñandú, café, acción").repeat(40));
    const heard: string[] = [];
    const follower = new TranscriptFollower(folder, "s1", (said) => heard.push(...said.map((one) => `${one.role}:${one.text}`)), () => undefined);
    follower.poll();
    appendFileSync(file, user("código inválido — ¿cuántos intentos quedan?"));
    follower.poll();
    const last = Buffer.from(line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Quedan 2 — listo." }], stop_reason: "end_turn" } }));
    const cut = last.indexOf(Buffer.from("—")) + 1;
    appendFileSync(file, last.subarray(0, cut));
    follower.poll();
    appendFileSync(file, last.subarray(cut));
    follower.poll();
    expect(heard).toEqual(["user:código inválido — ¿cuántos intentos quedan?", "assistant:Quedan 2 — listo.", "done:"]);
  });
});

describe("stopping an agent whose turn is in the CLI", () => {
  const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");
  const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");

  it("interrupts the CLI, and never leaves the console working with nothing running", () => {
    expect(pairing).toMatch(/if \(this\.terminal\?\.holds\(agentId\)\) \{\s*this\.terminal\.interrupt\(agentId\);/);
    expect(pairing).toMatch(/this\.print\(agentId, "\[odin\] Stopped in the CLI\.\\n"\);\s*\}\s*this\.terminalBusy\(agentId, false\);/);
    expect(panel).toMatch(/interrupt: \(agent\) => terminals\.input\(agent, "\\x1b"\),/);
  });
});
