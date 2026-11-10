import { describe, expect, it, vi } from "vitest";

import { KNOWN_AGENTS, type AgentKind } from "@odin/core";

import { CliSessions, cliArgs, ENTER_MS, SCROLLBACK, SETTLED_MS } from "../src/cli.js";
import { pythonPty, type Pty } from "../src/pty.js";

function until(what: () => boolean, ms = 8000): Promise<void> {
  const stop = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const look = () => {
      if (what()) resolve();
      else if (Date.now() > stop) reject(new Error("gave up waiting"));
      else setTimeout(look, 25);
    };
    look();
  });
}

describe.skipIf(process.platform === "win32")("a terminal Odin runs a CLI in", () => {
  it("is a real terminal: the program sees its size, gets what is typed, and hears a resize", async () => {
    const pty = pythonPty("sh", ["-c", "stty size; read a; stty size; echo got:$a"], {
      cwd: process.cwd(),
      env: process.env,
      cols: 90,
      rows: 20,
    });
    let seen = "";
    let code: number | undefined;
    pty.onData((data) => (seen += data));
    pty.onExit((exit) => (code = exit));
    await until(() => seen.includes("20 90"));
    pty.resize(120, 33);
    await new Promise((resolve) => setTimeout(resolve, 150));
    pty.write("hello\r");
    await until(() => code !== undefined);
    expect(seen).toContain("33 120");
    expect(seen).toContain("got:hello");
    expect(code).toBe(0);
  }, 20_000);
});

function fakePty() {
  const written: string[] = [];
  const sizes: [number, number][] = [];
  let data: (text: string) => void = () => {};
  let exit: (code: number) => void = () => {};
  let killed = false;
  const pty: Pty = {
    write: (text) => written.push(text),
    resize: (cols, rows) => sizes.push([cols, rows]),
    kill: () => {
      killed = true;
    },
    onData: (listener) => (data = listener),
    onExit: (listener) => (exit = listener),
  };
  return { pty, written, sizes, say: (text: string) => data(text), end: (code: number) => exit(code), killed: () => killed };
}

function sessions(conversation?: string) {
  const posted: Record<string, unknown>[] = [];
  const spawned: { file: string; args: string[]; cols: number; rows: number }[] = [];
  const terminal = fakePty();
  const claude = KNOWN_AGENTS.find((one) => one.id === "claude")!;
  const cli = new CliSessions({
    repo: () => "/code/shop",
    kind: (agent) => (agent === "claude" ? { ...claude, path: "/bin/claude" } : undefined),
    conversation: () => conversation,
    env: () => ({}),
    open: (file, args, options) => {
      spawned.push({ file, args, cols: options.cols, rows: options.rows });
      return terminal.pty;
    },
    post: (message) => posted.push(message as Record<string, unknown>),
  });
  return { cli, posted, spawned, terminal };
}

describe("the CLI tab of an agent's console", () => {
  it("runs the agent's own command interactively, carrying on Odin's conversation with it", () => {
    const { cli, spawned } = sessions("conversation-1");
    cli.open("claude", 100, 30, "page");
    expect(spawned).toEqual([{ file: "/bin/claude", args: ["--resume", "conversation-1"], cols: 100, rows: 30 }]);
  });

  it("starts fresh when Odin has no conversation with the agent yet", () => {
    const { cli, spawned } = sessions();
    cli.open("claude", 80, 24, "page");
    expect(spawned[0]!.args).toEqual([]);
  });

  it("passes keys and sizes through, and streams what it prints", () => {
    const { cli, posted, terminal } = sessions();
    cli.open("claude", 80, 24, "page");
    cli.input("claude", "/mcp\r");
    cli.resize("claude", 120, 40);
    terminal.say("MCP servers");
    expect(terminal.written).toEqual(["/mcp\r"]);
    expect(terminal.sizes).toEqual([[120, 40]]);
    expect(posted).toContainEqual({ type: "cliData", agent: "claude", data: "MCP servers" });
  });

  it("hands a page that opens later the screen so far, and runs only one session", () => {
    const { cli, posted, spawned, terminal } = sessions();
    cli.open("claude", 80, 24, "first");
    terminal.say("hello ");
    terminal.say("world");
    cli.open("claude", 90, 24, "second");
    expect(spawned).toHaveLength(1);
    expect(posted).toContainEqual({ type: "cliReplay", agent: "claude", for: "second", data: "hello world" });
  });

  it("keeps a bounded scrollback", () => {
    const { cli, posted, terminal } = sessions();
    cli.open("claude", 80, 24, "first");
    terminal.say("x".repeat(SCROLLBACK + 10));
    cli.open("claude", 80, 24, "second");
    const replay = posted.find((one) => one.type === "cliReplay" && one.for === "second")!;
    expect((replay.data as string).length).toBe(SCROLLBACK);
  });

  it("says when the session ends, and can be started again", () => {
    const { cli, posted, spawned, terminal } = sessions();
    cli.open("claude", 80, 24, "page");
    terminal.end(0);
    expect(posted).toContainEqual({ type: "cliExit", agent: "claude", code: 0 });
    expect(cli.live("claude")).toBe(false);
    cli.open("claude", 80, 24, "page");
    expect(spawned).toHaveLength(2);
  });

  it("stops when asked, and when the reading closes", () => {
    const { cli, terminal } = sessions();
    cli.open("claude", 80, 24, "page");
    cli.dispose();
    expect(terminal.killed()).toBe(true);
  });

  it("says so when the agent is not installed", () => {
    const { cli, posted, spawned } = sessions();
    cli.open("gemini", 80, 24, "page");
    expect(spawned).toHaveLength(0);
    expect(posted[0]).toMatchObject({ type: "cliExit", agent: "gemini", code: 127 });
  });
});

describe("how each CLI picks up a conversation", () => {
  const kind = (id: string) => KNOWN_AGENTS.find((one) => one.id === id) as AgentKind;
  it("names the conversation the way the tool asks for it", () => {
    expect(cliArgs(kind("claude"), "c1")).toEqual(["--resume", "c1"]);
    expect(cliArgs(kind("codex"), "c1")).toEqual(["resume", "c1"]);
    expect(cliArgs(kind("opencode"), "c1")).toEqual(["--session", "c1"]);
    expect(cliArgs(kind("gemini"), "c1")).toEqual([]);
    expect(cliArgs(kind("claude"), undefined)).toEqual([]);
  });
});

describe("a slash command sent from the console's box", () => {
  it("waits for a starting CLI to finish drawing, then types it and presses Enter", () => {
    vi.useFakeTimers();
    try {
      const { cli, terminal } = sessions();
      cli.send("claude", "/resume");
      cli.open("claude", 80, 24, "page");
      terminal.say("welcome");
      vi.advanceTimersByTime(SETTLED_MS - 100);
      terminal.say(" to Claude");
      vi.advanceTimersByTime(SETTLED_MS - 1);
      expect(terminal.written).toEqual([]);
      vi.advanceTimersByTime(ENTER_MS + 10);
      expect(terminal.written).toEqual(["/resume", "\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes straight in when the CLI is already up", () => {
    vi.useFakeTimers();
    try {
      const { cli, terminal } = sessions();
      cli.open("claude", 80, 24, "page");
      terminal.say("ready");
      vi.advanceTimersByTime(SETTLED_MS + 10);
      cli.send("claude", "/mcp");
      vi.advanceTimersByTime(ENTER_MS + 10);
      expect(terminal.written).toEqual(["/mcp", "\r"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

