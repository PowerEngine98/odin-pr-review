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
 * opencode's output, which is written for a terminal rather than for a reader.
 *
 * It has no streaming mode to ask for, so what arrives is what it would have
 * drawn on a screen: colour codes around every tool name, a banner naming the
 * agent and the model, and tool calls run together with the prose around them
 * because the escape sequences — not the newlines — were what separated them.
 * Shown raw, a turn reads as a wall of `[0m` and `[90m` with a sentence
 * somewhere inside it, which is worse than showing nothing.
 *
 * So the codes are taken off, and used on the way out for the one thing they
 * were carrying: where one thing ends and the next begins. What comes out is
 * the shape Claude's stream already produces — a marked line per tool call,
 * and the prose left as prose.
 */
export function readOpencode(line: string): Said | undefined {
  const said: string[] = [];
  for (const piece of pieces(line)) {
    // The tool's own bullet, which says the same thing the arrow below says.
    const plain = piece.replace(/^[→▸●•\-]\s*/, "").trim();
    if (!plain) continue;

    const tool = plain.match(TOOL);
    if (tool) {
      // Walked off here too. This tool is handed a working directory the same
      // way, so its commands carry the same prefix, and a reader of this log is
      // no more interested in it than a reader of the other one.
      const about = (tool[2] ?? "").trim().replace(/^["']|["']$/g, "");
      said.push(about ? `→ ${tool[1]}(${short(gist(about))})` : `→ ${tool[1]}`);
      continue;
    }

    /*
     * What the last tool found, kept on the last tool's line.
     *
     * `0 matches` on a line of its own says nothing — a reader has to look up
     * to find out what found nothing — and it is the half of a search that
     * matters. Claude's stream has no equivalent because its tool results are
     * not shown at all; here they arrive whether they are wanted or not, so
     * they are put where they mean something.
     */
    const last = said[said.length - 1];
    if (last?.startsWith("→ ") && RESULT.test(plain)) {
      said[said.length - 1] = `${last} · ${short(plain)}`;
      continue;
    }

    said.push(plain);
  }
  return said.length > 0 ? { show: said.join("\n") } : undefined;
}

/** What a search or a read says about how it went. */
const RESULT = /^(\d+\s+match|no matches|failed|error\b|not found)/i;

/**
 * The tools opencode announces, as it spells them.
 *
 * A closed list rather than "a capitalised word at the start of a piece": the
 * prose is full of sentences beginning with a capital, and a log that turned
 * every one of them into a tool call would be lying about what ran.
 */
const TOOL =
  /^(Read|Write|Edit|Patch|Bash|Glob|Grep|List|Task|Todo|Webfetch|Fetch)\b[:\s]*(.*)$/;

/** Colour, cursor movement, and the rest of what a terminal is sent. */
const CODES = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u001b]*(?:\u001b\\|\u0007)?/g;

/**
 * One printed line, split where the colours said something ended.
 *
 * The codes are the only punctuation this output has: a tool name is written in
 * one colour and what it found in another, with no newline between them, so
 * dropping the codes without splitting on them glues a sentence to a file path
 * and the reader gets a wall. Split first, strip after, and drop the pieces
 * that were nothing but colour.
 *
 * Pieces are joined back up when the split was inside a sentence rather than
 * between two things — the colours change mid-sentence for emphasis as well as
 * for structure, and a paragraph broken at every emphasis is its own kind of
 * unreadable.
 */
function pieces(line: string): string[] {
  const parts = line
    .split(/(?=\u001b\[)/)
    .map((part) => part.replace(CODES, "").trim())
    .filter((part) => part.length > 0);

  const out: string[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last !== undefined && !TOOL.test(part) && !TOOL.test(last)) {
      out[out.length - 1] = `${last} ${part}`;
      continue;
    }
    out.push(part);
  }
  return out;
}
