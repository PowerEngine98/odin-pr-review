import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readClaude, readOpencode, type Said } from "./stream.js";

const run = promisify(execFile);

/**
 * A coding agent that could take work from a comment thread.
 *
 * Deliberately a description rather than a connection. Whether the tool is
 * installed, what it is called and how it is started are three different
 * questions from whether the reader wants it to answer anything, and only the
 * first three are settled here.
 */
export interface AgentKind {
  /** Stable across runs and across machines. What settings are filed under. */
  id: string;
  /** What the panel calls it, and what `@name` in a comment matches. */
  name: string;
  /** The executable to look for on PATH. */
  command: string;
  /**
   * Arguments that make it answer one prompt and exit.
   *
   * Every one of these tools also has an interactive mode, and that is the
   * wrong one: a session waiting on a keystroke that will never come looks
   * exactly like an agent thinking hard.
   */
  once: string[];
  /** Asked for a version, which is the cheapest proof it will actually run. */
  version: string[];
  /**
   * How a conversation is carried from one turn to the next, if it can be.
   *
   * Absent for most tools, and that absence is the honest answer rather than a
   * gap: a tool that cannot be told which conversation to continue starts fresh
   * every turn, and pretending otherwise would mean an agent that answers as
   * though it remembers something it does not.
   *
   * Both halves are needed, and they are not the same arguments. Starting names
   * an id that must not already exist; carrying on names one that must. Sending
   * the wrong one is not a subtle failure — the tool refuses outright.
   */
  session?: {
    /** Begins a conversation under an id we chose. */
    start(id: string): string[];
    /** Carries that conversation on. */
    resume(id: string): string[];
  };
  /**
   * How much rope an agent is given, in that tool's own words.
   *
   * Four rungs, because every one of these tools offers roughly these four and
   * calls them something different: look but do not touch, ask before each
   * thing, write files freely but ask before running anything, and no
   * questions at all.
   *
   * A tool missing a rung simply has no entry for it, and asking for that rung
   * gets the tool's default rather than a flag invented for the occasion.
   */
  agency?: Partial<Record<Agency, string[]>>;
  /**
   * How to tell it where to ask, for a tool that can be told.
   *
   * Given the path to a server description, answers the arguments that point
   * the tool at it. Absent for tools with no such notion — those simply refuse
   * what they were not permitted, and say so, which is a worse experience than
   * being asked but an honest one.
   */
  asks?: (config: string) => string[];
  /**
   * How to make it narrate, for a tool that can.
   *
   * Without this a turn prints nothing until it ends — so a terminal watching
   * four minutes of work shows an empty box for four minutes and then eight
   * paragraphs at once. The one thing the reader wants during those minutes is
   * the one thing the quiet mode cannot say.
   *
   * `read` turns one line of the stream into a line for the log, and picks out
   * the answer when it arrives. Absent for tools with no such mode: they keep
   * printing at the end, which is what they did before.
   */
  streams?: { args: string[]; read(line: string): Said | undefined };
}

/**
 * The tools worth looking for.
 *
 * A fixed list rather than anything on PATH that looks like an agent. What is
 * being decided here is that a comment the reader writes will be handed to a
 * program, and guessing which programs those are from their names is not a
 * mistake worth being able to make.
 */
/**
 * How much an agent may do without being asked.
 *
 * A ladder rather than a switch, because the useful setting is rarely at either
 * end: most of the work here is editing files in a checkout the reader is
 * looking at, and "may edit, must ask before running things" is a different
 * risk from "may run anything".
 */
export type Agency = "read" | "ask" | "edits" | "full";

/** The rungs, weakest first, for anything that has to show them in order. */
export const AGENCY: readonly Agency[] = ["read", "ask", "edits", "full"];

export const KNOWN_AGENTS: readonly AgentKind[] = [
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    once: ["--print"],
    version: ["--version"],
    /*
     * Its own streaming mode, measured against the tool: `stream-json` needs
     * `--verbose` alongside it, and emits one JSON object per event —
     * assistant text, thinking, each tool call, and a final result.
     */
    streams: {
      args: ["--output-format", "stream-json", "--verbose"],
      read: readClaude,
    },
    /*
     * Its own permission prompt, routed to a tool of ours.
     *
     * Claude spawns the named server itself, which is why this is a path to a
     * script rather than anything in this process: the thing that asks is a
     * child of the tool, and its only way back is a socket it can open by name.
     */
    asks: (config) => ["--mcp-config", config, "--permission-prompt-tool", "mcp__odin__approve"],
    /*
     * Its own named modes, which map onto the ladder almost exactly. `manual`
     * is the tool's default and is left unsaid rather than restated: passing a
     * flag that means "behave normally" is a flag that can be wrong.
     */
    agency: {
      read: ["--permission-mode", "plan"],
      edits: ["--permission-mode", "acceptEdits"],
      full: ["--permission-mode", "bypassPermissions"],
    },
    /*
     * Measured against the tool rather than read off its help.
     *
     * `--session-id` takes a UUID of our choosing, which is what makes recovery
     * possible at all: the id exists before the conversation does, so there is
     * nothing to harvest out of the output and nothing to lose if the turn
     * fails before it prints anything.
     *
     * It refuses a second time — "Session ID … is already in use" — so the two
     * cases genuinely are two sets of arguments. `--resume` on the same id
     * brings the conversation back with what was said in it still in mind.
     */
    session: {
      start: (id) => ["--print", "--session-id", id],
      resume: (id) => ["--print", "--resume", id],
    },
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    once: ["exec"],
    version: ["--version"],
    /*
     * A sandbox rather than a permission mode, so the rungs are about what the
     * process can reach. The top one is both halves at once: full access alone
     * still leaves the approval prompts, and a prompt here has nobody to
     * answer it.
     */
    agency: {
      read: ["--sandbox", "read-only"],
      edits: ["--sandbox", "workspace-write"],
      full: ["--dangerously-bypass-approvals-and-sandbox"],
    },
  },
  {
    id: "gemini",
    name: "Gemini",
    command: "gemini",
    once: ["--prompt"],
    version: ["--version"],
    agency: {
      read: ["--approval-mode", "plan"],
      edits: ["--approval-mode", "auto_edit"],
      full: ["--approval-mode", "yolo"],
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor-agent",
    once: ["--print"],
    version: ["--version"],
  },
  {
    id: "antigravity",
    name: "Antigravity",
    command: "antigravity",
    once: ["--print"],
    version: ["--version"],
  },
  {
    id: "opencode",
    name: "opencode",
    command: "opencode",
    /*
     * `run` takes the message as positional arguments, which is why this is
     * the subcommand rather than a flag: everything after it is the prompt.
     * The bare command starts its terminal interface, which would sit waiting
     * for a keystroke that never comes.
     */
    once: ["run"],
    version: ["--version"],
    /*
     * No streaming mode to ask for, so nothing is added to the command line:
     * this is the tool's ordinary output, read rather than requested. What it
     * prints is written for a terminal — colour codes around every tool name,
     * and tool calls run together with the prose because the codes, not the
     * newlines, were separating them.
     */
    streams: {
      args: [],
      read: readOpencode,
    },
    /*
     * Its rungs are agents rather than flags. `plan` is the one that looks and
     * does not touch, `build` is the primary one that writes — and how much
     * `build` may do without asking is the reader's own permission config,
     * which is theirs to set and not ours to override.
     *
     * So there is no `full`: this tool has no "ask me nothing" switch, and a
     * rung with the same arguments as the one below it would be a control that
     * reads as doing something and does not.
     */
    agency: {
      read: ["--agent", "plan"],
      edits: ["--agent", "build"],
    },
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    once: ["--message"],
    version: ["--version"],
    /* One rung only: it answers yes to everything or it asks. */
    agency: { full: ["--yes-always"] },
  },
];

/** An agent this machine actually has, and what it answered when asked. */
export interface FoundAgent extends AgentKind {
  /** Where the executable is, which is also the proof that it is there. */
  path: string;
  /** Whatever it printed for `--version`, trimmed. Empty if it printed nothing. */
  version_: string;
}

export interface DiscoverRequest {
  cwd: string;
  /** How long any one tool gets to say what version it is. */
  timeoutMs?: number;
  /** The environment to look in, for a host whose PATH is not the shell's. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Which of the known agents this machine can actually run.
 *
 * Two questions, because either alone gives a wrong answer often enough to
 * matter. `which` finds a name on PATH — including a stale symlink into a
 * version manager's directory that was uninstalled months ago, which resolves
 * happily and fails to execute. Running it proves it executes but says nothing
 * about where it came from, and a tool that is merely slow to start would be
 * declared missing.
 *
 * Asked of all of them at once: this runs while the reader is looking at the
 * panel waiting for it to fill in, and the total is then the slowest tool
 * rather than the sum of them.
 */
export async function discoverAgents(
  request: DiscoverRequest,
): Promise<FoundAgent[]> {
  const timeout = request.timeoutMs ?? 4000;
  const options = {
    cwd: request.cwd,
    timeout,
    env: request.env ?? process.env,
    // A tool that decides to print its entire help text is not a reason to
    // hold a buffer open.
    maxBuffer: 1024 * 64,
  };

  /*
   * Where each tool is, asked of all of them at once.
   *
   * `which` is milliseconds and spawns nothing heavy, so this half is free and
   * the answer rules most of the list out before anything expensive happens.
   */
  const on = await Promise.all(
    KNOWN_AGENTS.map(async (kind): Promise<{ kind: AgentKind; path: string } | undefined> => {
      try {
        const { stdout } = await run("which", [kind.command], options);
        const path = stdout.split("\n")[0]?.trim() ?? "";
        return path ? { kind, path } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const present = on.filter((one): one is { kind: AgentKind; path: string } => one !== undefined);

  /*
   * And whether each one will actually run, a couple at a time.
   *
   * This half is not free. Every one of these tools is a Node application, and
   * starting one costs between a tenth of a second and well over a second — so
   * asking all of them together is six interpreters booting at once, on a
   * machine that is already running an editor and whatever the reader is
   * building. The whole list takes about as long either way; what changes is
   * whether the machine notices.
   */
  const found: FoundAgent[] = [];
  const AT_ONCE = 2;
  for (let i = 0; i < present.length; i += AT_ONCE) {
    const batch = present.slice(i, i + AT_ONCE);
    const answers = await Promise.all(
      batch.map(async ({ kind, path }): Promise<FoundAgent | undefined> => {
        try {
          const { stdout } = await run(kind.command, kind.version, options);
          return { ...kind, path, version_: stdout.trim().split("\n")[0] ?? "" };
        } catch {
          /*
           * On PATH and will not run.
           *
           * Common enough to be worth a branch of its own: a shim left behind
           * by an uninstall, a binary for the wrong architecture, a tool that
           * needs a login before it will do anything at all. Offering it as
           * available would mean the reader enabling it, writing a comment, and
           * watching nothing happen.
           */
          return undefined;
        }
      }),
    );
    for (const answer of answers) if (answer) found.push(answer);
  }

  return found;
}
