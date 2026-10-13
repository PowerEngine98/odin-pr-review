/**
 * An agent's turn as it happens, rather than all at once when it ends.
 *
 * In its plain answer-once mode a tool prints nothing until it has finished —
 * so a terminal watching a turn that takes four minutes shows an empty box for
 * four minutes and then eight paragraphs. What the reader wants to know in
 * those four minutes is the one thing that mode cannot tell them: that it is
 * doing something, and roughly what.
 *
 * The tools that can stream do it as newline-delimited JSON, one object per
 * event. This turns those objects into lines a person can read, and picks the
 * final answer out of the same stream.
 */

import { changesIn, type Change } from "./deltas.js";

/** What one event is worth showing, and whether it was the answer. */
export interface Said {
  /** A line for the log, already readable. Absent for events worth no words. */
  show?: string;
  /** The turn's answer, on the event that carries it. */
  answer?: string;
  /**
   * What it wrote, when the event was a tool call that writes.
   *
   * Beside `show` rather than inside it. The log line says an edit happened and
   * is all a reader watching a turn wants; the change itself is a record kept
   * for afterwards, and the two want different shapes and different lifetimes.
   */
  did?: Change[];
}

/**
 * Claude's stream, which is the only one Odin reads so far.
 *
 * Measured against the tool rather than taken from documentation: the shapes
 * here are what `--output-format stream-json --verbose` actually emits, checked
 * by running it. Anything unrecognised is skipped rather than guessed at — a
 * log with a line of raw JSON in it is worse than a log with a gap.
 */
export function readClaude(line: string): Said | undefined {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not JSON at all. Some builds print a banner before the stream starts, and
    // a banner is worth showing; a fragment of a split line is not.
    const text = line.trim();
    return text && !text.startsWith("{") ? { show: text } : undefined;
  }

  if (event.type === "result") {
    const answer = typeof event.result === "string" ? event.result : undefined;
    return answer ? { answer } : undefined;
  }

  if (event.type === "assistant") {
    const message = event.message as { content?: unknown[] } | undefined;
    const said: string[] = [];
    for (const block of message?.content ?? []) {
      const part = block as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") {
        said.push(part.text);
      } else if (part.type === "thinking" && typeof part.thinking === "string") {
        /*
         * Marked, because it is the agent working rather than the agent
         * answering — and a reader skimming a log should be able to tell.
         *
         * Every line of it, not only the first. A page of reasoning marked once
         * at the top is one marked line followed by a dozen that look exactly
         * like the answer, and whatever reads this back has no way to tell
         * where the thinking stopped.
         *
         * Blank lines are not marked, because a mark on a blank line is a log
         * entry carrying nothing. Reasoning arrives with the paragraph breaks
         * still in it, and interleaved turns emit thinking blocks that are
         * whitespace and nothing else, so marking every line without asking
         * whether there was a line produced exactly what the panel was showing:
         * runs of entries reading `…` and no more, one after another, between
         * the tool calls that were the only things left saying anything. The
         * break is a thing a paragraph has, not a thing an agent thought.
         */
        for (const line of part.thinking.trim().split("\n")) {
          if (line.trim()) said.push(`… ${line}`);
        }
      } else if (part.type === "tool_use") {
        said.push(`→ ${describeTool(part)}`);
      }
    }
    const did = changesIn(event);
    if (said.length === 0 && did.length === 0) return undefined;
    return {
      ...(said.length ? { show: said.join("\n") } : {}),
      ...(did.length ? { did } : {}),
    };
  }

  /*
   * Everything else is machinery: the hooks that ran at startup, the session
   * banner, rate limit accounting, and the results coming back from tools. The
   * reader is watching to see what the agent is doing, and none of that is it.
   */
  return undefined;
}

/**
 * A tool call in a few words.
 *
 * The name alone says almost nothing — `Bash`, `Read`, `Edit` are all things
 * an agent does constantly. What makes the line worth reading is the argument:
 * which file, which command.
 */
function describeTool(part: Record<string, unknown>): string {
  const name = typeof part.name === "string" ? part.name : "tool";
  const input = (part.input ?? {}) as Record<string, unknown>;

  const path =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : typeof input.pattern === "string"
          ? input.pattern
          : "";
  const command = typeof input.command === "string" ? input.command : "";

  if (path) return `${name}(${place(path)})`;
  return command ? `${name}(${short(gist(command))})` : name;
}

/**
 * How much of a command or an argument reaches the log.
 *
 * It was eighty, which is the width of a terminal and has nothing to do with
 * the box these lines are actually drawn in — that box wraps, and has done
 * since it was written. What eighty bought instead was a panel in which three
 * consecutive commands all read `Bash(cd age…)`: the walk to the worktree used
 * the whole allowance on its own, the cut landed three letters into a folder
 * name, and the path-shortening that runs when the line is drawn then threw
 * away everything in front of that folder — so what survived of the command
 * was three characters of the boilerplate that was supposed to be removed.
 *
 * So it is far enough out now that an ordinary command reaches the reader
 * whole, which is the point of a log: it is consulted precisely when the detail
 * is what is wanted. What is left is a guard against the one shape that has no
 * bound at all — a heredoc with a file inside it, or a base64 blob pasted as an
 * argument — where the line is not a line and would push everything else off
 * the screen. Anything that long is being cut at the end, with its beginning
 * intact, so what a reader loses is the tail of something they can already
 * recognise rather than the whole of something they cannot.
 */
const ROOM = 400;

/** One line of a log: whitespace flattened, and only the runaways cut. */
function short(text: string): string {
  /*
   * Flattened because the transcript is line-based all the way to the page —
   * a newline inside one of these becomes a second entry, drawn as though the
   * agent had done a second thing, and the tail of a multi-line command loses
   * the tool name that said what it was.
   */
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= ROOM ? one : `${one.slice(0, ROOM)}…`;
}

/**
 * A path as somebody would say it out loud, which is the filename.
 *
 * A log of a turn in a worktree reads `/Users/somebody/workspace/thinginc/
 * thinglabs/thing/.claude/worktrees/agent-a45/…` on every line — the same
 * prefix every time, and the filename, the only part anybody is reading for,
 * cut off the end by a truncation that ran from the front.
 *
 * Keeping the parent folder as well was the first attempt and it was still the
 * wrong shape: in a worktree the parent is `agent-a45` or `worktrees` as often
 * as it is anything meaningful, so what a reader got was a column of identical
 * `…/worktrees/agent-…`. The filename is the part that differs from line to
 * line, and difference is the whole of what a log is scanned for.
 */
function place(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * One walk to a directory, in the shapes a shell actually writes it.
 *
 * The path is a bare word most of the time, and the three ways it stops being
 * one all turn up in practice: quoted with double quotes because the checkout
 * is under a folder with a space in its name, quoted with single quotes for the
 * same reason by a tool that prefers them, and left bare with the spaces
 * escaped one at a time. The bare alternative reads backslash-escapes as part
 * of the word for that last case — without it, a walk to `/Users/marco\
 * acosta/thing` matched as far as the backslash, failed to find the `&&`, and
 * the whole line was left with its boilerplate on.
 *
 * `;` as well as `&&` because both are written, and the difference between them
 * is about what happens when the walk fails rather than about what was run.
 */
const WALK = /^\s*cd\s+(?:"[^"]*"|'[^']*'|(?:\\.|[^\s\\])+)\s*(?:&&|;)\s*([\s\S]+)$/;

/**
 * A command with the walk to it taken off.
 *
 * These tools are handed a working directory rather than inheriting one, so
 * almost every command they run begins by walking to it: `cd <forty characters
 * of path> && the thing they actually ran`. Truncated from the front, the log
 * showed the walk and hid the command.
 *
 * Repeatedly, because one walk is not always all there is. A command that goes
 * to the checkout and then down into a package writes both — `cd <repo> && cd
 * packages/core && yarn build` — and taking off only the first left a line that
 * still opened with a `cd`, which was indistinguishable from the fault this
 * exists to fix. Each pass takes a strictly shorter tail than it was given, so
 * this stops.
 *
 * What is never returned is nothing. A command that is only a walk — `cd
 * somewhere`, with nothing after it — is still the thing the agent ran, and a
 * log entry reading `Bash()` says less than one that admits it was a walk.
 */
function gist(command: string): string {
  let rest = command;
  for (let walked = rest.match(WALK); walked; walked = rest.match(WALK)) {
    rest = walked[1]!;
  }
  return rest.trim() || command;
}

/**
 * opencode's stream, which it calls "raw JSON events".
 *
 * Measured against the tool: `opencode run --format json` emits one JSON object
 * per line, each carrying a `type` and a `part`. The shapes below are what it
 * actually printed, checked by running it.
 *
 * Its ordinary output is drawn for a terminal rather than for a reader — colour
 * codes around every tool name, a banner naming the agent and the model, and a
 * different rendering per tool (`$ cmd` for a shell run, `→ Read path` for a
 * read) that changes between versions. Shown raw that is a wall of `[0m` and
 * `[90m` with a sentence somewhere inside it, and parsed by eye it breaks the
 * moment the tool restyles a line. So the machine-readable form is asked for
 * instead, which also puts every event on standard output, where every other
 * narrated tool already is.
 */
export function readOpencode(line: string): Said | undefined {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not JSON at all. opencode prints a banner before the stream starts in
    // some builds, and a banner is worth showing; a fragment of a split line
    // is not.
    const text = line.trim();
    return text && !text.startsWith("{") ? { show: text } : undefined;
  }

  const part = (event.part ?? {}) as Record<string, unknown>;

  /*
   * The agent talking. Every text part is the whole of what it said at that
   * point rather than a delta — measured: a thousand-character answer arrived
   * as one event — so the last of them is the turn's answer. Kept beside the
   * log line because the reply is a message while the log is the working-out.
   */
  if (event.type === "text") {
    const text = unmarked(String(part.text ?? ""));
    if (!text) return undefined;
    return { show: text, answer: text };
  }

  // The agent working rather than the agent answering, marked the way Claude's
  // thinking is: a reader skimming a log should be able to tell the two apart.
  if (event.type === "reasoning") {
    const thought = unmarked(String(part.text ?? ""));
    const lines = thought.split("\n").map((one) => one.trim()).filter(Boolean);
    if (lines.length === 0) return undefined;
    return { show: lines.map((one) => `… ${one}`).join("\n") };
  }

  if (event.type === "tool_use") {
    const show = describeOpencode(part);
    const did = editedByOpencode(part);
    if (!show && did.length === 0) return undefined;
    return {
      ...(show ? { show } : {}),
      ...(did.length ? { did } : {}),
    };
  }

  /*
   * Everything else is machinery: a step beginning and ending, and the token
   * accounting that comes with it. The reader is watching to see what the agent
   * is doing, and none of that is it.
   */
  return undefined;
}

/**
 * A chat marker a model leaked into its own text.
 *
 * Measured: the default model wrote a literal `</think>` at the front of a text
 * part, so an answer arrived as `</think>Done.` and a search's result as
 * `</think>3`. A marker is not a thing the agent said, so it comes off — and
 * only from the front, where it is a marker rather than a quotation.
 */
function unmarked(text: string): string {
  return text.replace(/^(?:\s*<\/(?:think|thinking|response)>\s*)+/i, "").trim();
}

/**
 * opencode's tool ids, in the spelling a log reads.
 *
 * A closed list rather than a guess from the name, for the same reason the
 * page's own act classification is one: a tool drawn as a write because its
 * name has "set" in it would be a log that lies about what an agent did.
 */
const OPENCODE_TOOL: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Patch",
  multiedit: "MultiEdit",
  bash: "Bash",
  shell: "Shell",
  glob: "Glob",
  grep: "Grep",
  list: "List",
  ls: "LS",
  webfetch: "Webfetch",
  fetch: "Fetch",
  websearch: "WebSearch",
  task: "Task",
  todowrite: "Todo",
};

/** The tools handed a path, whose argument is worth saying as a filename. */
const NAMES_A_FILE = new Set(["read", "write", "edit", "patch", "multiedit", "list", "ls"]);

/** One tool call, as a line of the log. */
function describeOpencode(part: Record<string, unknown>): string {
  const tool = typeof part.tool === "string" ? part.tool : "";
  const name =
    OPENCODE_TOOL[tool] ?? (tool ? tool[0]!.toUpperCase() + tool.slice(1) : "Tool");

  const state = (part.state ?? {}) as Record<string, unknown>;
  const input = (state.input ?? {}) as Record<string, unknown>;
  const path =
    typeof input.filePath === "string"
      ? input.filePath
      : typeof input.path === "string"
        ? input.path
        : "";
  const command = typeof input.command === "string" ? input.command : "";
  const pattern = typeof input.pattern === "string" ? input.pattern : "";
  const url = typeof input.url === "string" ? input.url : "";

  // A file is named by its filename, the others by what they were handed. The
  // filename is the part that differs from line to line; the parent folders are
  // the same walk on every line. See `place`.
  if (NAMES_A_FILE.has(tool) && path) return `→ ${name}(${short(place(path))})`;
  if (command) return `→ ${name}(${short(gist(command))})`;
  if (pattern) return `→ ${name}(${short(pattern)})`;
  if (url) return `→ ${name}(${short(url)})`;
  if (path) return `→ ${name}(${short(place(path))})`;
  return `→ ${name}`;
}

/**
 * The edits inside one tool call, for the ledger.
 *
 * Read off the tool's own arguments rather than its prose. Only the tools that
 * write: a `read` or a `grep` changed nothing and belongs in the log, which
 * already has it.
 */
function editedByOpencode(part: Record<string, unknown>): Change[] {
  const tool = typeof part.tool === "string" ? part.tool : "";
  const state = (part.state ?? {}) as Record<string, unknown>;
  const input = (state.input ?? {}) as Record<string, unknown>;
  const path =
    typeof input.filePath === "string"
      ? input.filePath
      : typeof input.path === "string"
        ? input.path
        : "";
  if (!path) return [];

  if (tool === "edit") {
    const before = typeof input.oldString === "string" ? input.oldString : "";
    const after = typeof input.newString === "string" ? input.newString : "";
    // A no-op edit is a tool call that happened, not a change that did.
    if (before === after) return [];
    return [{ path, before, after, whole: false }];
  }

  if (tool === "write") {
    const content = typeof input.content === "string" ? input.content : "";
    return [{ path, before: "", after: content, whole: true }];
  }

  return [];
}
