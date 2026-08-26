import { spawn } from "node:child_process";

import type { AgentKind } from "./discover.js";

/**
 * One turn of one agent, as it happens.
 *
 * Streamed rather than awaited whole because the whole point of the terminal
 * beside the conversation is watching it work. A turn is minutes on anything
 * worth asking for, and a comment that says nothing until it says everything is
 * indistinguishable from one that has hung.
 */
export interface AgentRun {
  /** Everything the tool has printed, in order, including its complaints. */
  transcript: string;
  /**
   * What it printed as its answer, and nothing else.
   *
   * The one honest line between a message and a log. Every tool here is being
   * run in its answer-once mode — `--print`, `exec`, `--prompt` — and in that
   * mode standard output is the reply while progress, warnings and complaints
   * go to standard error. Guessing at where a message starts inside one stream
   * would be exactly that: a guess, wrong differently for each tool.
   */
  output: string;
  /** What it exited with. Zero is the only one that means the turn worked. */
  code: number;
  /**
   * The answer, when the tool narrated its turn and said which part was it.
   *
   * Absent for a tool that simply prints: there the whole of standard output is
   * the answer, and picking a part of it out would be a guess.
   */
  answer?: string;
  /** True when it was stopped rather than finishing. */
  stopped: boolean;
}

export interface RunRequest {
  kind: AgentKind;
  /** What the reader asked for, already assembled with its context. */
  prompt: string;
  /**
   * How to invoke it, when the plain one-shot arguments are not what is wanted.
   *
   * Carrying a conversation on takes different arguments from starting one, and
   * which of those applies is a question about what has been said before —
   * which is the session's business, not this function's.
   */
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /**
   * How long a turn may take before it is stopped.
   *
   * Generous, because these are minutes by design. Bounded all the same: a tool
   * that has stopped for input nobody will ever type looks exactly like one
   * thinking hard, and the queue behind it never moves again.
   */
  timeoutMs?: number;
  /** Called with each chunk as it arrives, for the terminal to show. */
  onOutput?: (chunk: string) => void;
}

/** A turn in progress, and the one thing that can be done to it from outside. */
export interface RunHandle {
  done: Promise<AgentRun>;
  /** Ends the turn. The transcript keeps whatever was printed before it. */
  stop(): void;
}

/** Thirty minutes: long enough for real work, short enough to end a hang. */
const LIMIT = 30 * 60 * 1000;

/**
 * Starts an agent on a prompt and hands back its turn.
 *
 * The prompt goes as the last argument rather than through a shell, so a
 * comment containing a backtick, a semicolon or a `$(…)` is a comment rather
 * than a command. That matters more here than almost anywhere else in this
 * codebase: the text being passed is written by whoever is reviewing, quoting
 * code from a branch that may have come from anywhere.
 *
 * Standard input is closed immediately. Every one of these tools has an
 * interactive mode and most fall into it when they find a terminal; a turn
 * waiting on a keystroke that will never come is the failure this exists to
 * make impossible.
 */
export function runAgent(request: RunRequest): RunHandle {
  const chunks: string[] = [];
  const out: string[] = [];
  let stopped = false;
  let settled = false;

  const child = spawn(
    request.kind.command,
    [...(request.args ?? request.kind.once), request.prompt],
    {
    cwd: request.cwd,
    env: request.env ?? process.env,
    // No shell, deliberately. See above.
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const take = (chunk: Buffer | string): void => {
    const text = String(chunk);
    chunks.push(text);
    request.onOutput?.(text);
  };
  /*
   * A narrated turn arrives as one JSON object per line, and none of it is
   * worth showing raw: a log of protocol is not a log. Each line is turned into
   * a line a person can read, and the answer is picked out of the same stream.
   *
   * The raw output is still kept. If the tool changes its shape under us the
   * parse quietly yields nothing, and falling back to what it printed is the
   * difference between a thin answer and none at all.
   */
  const narrated = request.kind.streams;
  let pending = "";
  let answer: string | undefined;

  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    out.push(text);

    if (!narrated) {
      take(text);
      return;
    }

    pending += text;
    for (;;) {
      const at = pending.indexOf("\n");
      if (at < 0) break;
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      if (!line.trim()) continue;

      const said = narrated.read(line);
      if (said?.answer !== undefined) answer = said.answer;
      if (said?.show) take(`${said.show}\n`);
    }
  });
  // Kept, and kept in order with the rest. What a tool prints here is usually
  // the reason a turn produced nothing, and dropping it leaves a conversation
  // where the agent said nothing and nobody can say why.
  child.stderr?.on("data", take);

  const done = new Promise<AgentRun>((resolve) => {
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        transcript: chunks.join(""),
        output: out.join(""),
        ...(answer !== undefined ? { answer } : {}),
        code,
        stopped,
      });
    };

    const timer = setTimeout(() => {
      stopped = true;
      take(`\n[odin] stopped after ${Math.round((request.timeoutMs ?? LIMIT) / 60000)} minutes\n`);
      child.kill("SIGTERM");
      // A tool that ignores the polite one still has to go: the queue behind it
      // cannot move while it holds its place.
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, request.timeoutMs ?? LIMIT);

    child.on("error", (error) => {
      take(`\n[odin] ${error instanceof Error ? error.message : String(error)}\n`);
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 0));
  });

  return {
    done,
    stop(): void {
      if (settled) return;
      stopped = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    },
  };
}

/**
 * What the agent is handed, which is the conversation and not merely the ask.
 *
 * An agent joining a thread halfway through needs to know what has already been
 * said in it — otherwise two of them do the same work, or one answers a
 * question another has already answered. The team behaviour the reader is
 * asking for is not something the tools negotiate between themselves; it comes
 * from each of them being able to read the same thread.
 */
export interface PromptContext {
  /** Who is being asked, so it can sign what it writes. */
  agent: string;
  /** The file and lines the remark is anchored to, when it is anchored. */
  place?: string;
  /** The conversation so far, oldest first. */
  said: { author: string; body: string }[];
  /** The ask itself, which is the last thing the reader wrote. */
  ask: string;
  /** The other agents switched on, so it knows who else may answer. */
  others: string[];
  /**
   * Who has claimed this conversation, when somebody has.
   *
   * Told rather than inferred from the thread. An agent reading "On it" in a
   * transcript has to work out whether that claim is still standing, whether it
   * covers what is being asked now, and whether it was its own — and each of
   * those is a chance to decide wrongly in the direction of doing the work
   * anyway, which is the expensive direction.
   */
  owner?: string;
}

/**
 * The prompt, assembled.
 *
 * Deliberately plain text with the rules stated once at the top. Every one of
 * these tools takes a single string and none of them share a format for
 * anything richer, so the alternative is six spellings of the same instructions
 * that drift apart the first time one of them is edited.
 */
export function promptFor(context: PromptContext): string {
  const lines: string[] = [];

  lines.push(
    `You are ${context.agent}, working with a reviewer inside Odin, a pull request review tool.`,
    `You are one of several agents reading the same comment thread: ${
      context.others.length ? context.others.join(", ") : "you are the only one"
    }.`,
    "",
    "How this works:",
    "- Reply as a short message in the thread, the way a colleague would. Not a report.",
    "- If you are taking it, say so in a few words first, then do it.",
    "- The reviewer reads every message. Keep them auditable: what you did, what you changed, what you could not.",
    "- You share one working tree with the other agents. Say which files you touched.",
  );

  /*
   * Whose conversation this is, said outright.
   *
   * The ordering already sends a follow-up to the agent that claimed the
   * thread, so an agent reading this is almost always the owner. Almost: an
   * owner can be switched off mid-conversation, and then somebody else picks
   * the thread up and needs to know it is walking into work already in
   * progress rather than starting it.
   */
  if (context.owner && context.owner !== context.agent) {
    lines.push(
      `- ${context.owner} claimed this thread earlier and may have changed files already.`,
      "  Read what it said before doing anything, and do not redo work it has done.",
    );
  } else if (context.owner === context.agent) {
    lines.push("- This thread is yours. You claimed it earlier; carry on from where you left off.");
  }
  lines.push("");

  if (context.place) lines.push(`This is about ${context.place}.`, "");

  if (context.said.length > 0) {
    lines.push("The thread so far:");
    for (const remark of context.said) {
      lines.push(`${remark.author}: ${remark.body}`);
    }
    lines.push("");
  }

  lines.push("The reviewer asks:", context.ask);
  return lines.join("\n");
}
