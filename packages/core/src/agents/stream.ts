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

/** What one event is worth showing, and whether it was the answer. */
export interface Said {
  /** A line for the log, already readable. Absent for events worth no words. */
  show?: string;
  /** The turn's answer, on the event that carries it. */
  answer?: string;
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
         */
        for (const line of part.thinking.trim().split("\n")) {
          said.push(`… ${line}`);
        }
      } else if (part.type === "tool_use") {
        said.push(`→ ${describeTool(part)}`);
      }
    }
    return said.length ? { show: said.join("\n") } : undefined;
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

  const about = command || path;
  return about ? `${name}(${short(about)})` : name;
}

/** Long enough to recognise, short enough for one line of a log. */
function short(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 80 ? one : `${one.slice(0, 80)}…`;
}
