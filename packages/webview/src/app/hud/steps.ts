/**
 * A line of an agent's working-out, read back as the act it describes.
 *
 * The log is written as text — `→ Read(…/media/VideoPreview.tsx)` — because
 * text is what survives being streamed, written to disk, truncated at both ends
 * and read back after a reload. Nothing about that is worth changing.
 *
 * What is worth changing is that a page of it is undifferentiated. Forty lines
 * scroll past in one colour, and the three questions a reader has while
 * watching — is it still reading, has it started writing, is it running
 * something — are answerable only by reading every line. Those three are the
 * whole of what a glance should tell you, so they are what this picks out: what
 * kind of act it was, and which file or command it was about.
 *
 * Parsing what was formatted a moment ago looks like a round trip and is not.
 * The alternative is a structured log all the way through — which would have to
 * survive the same streaming, truncation and storage, and would mean the record
 * on disk was no longer something a person could read.
 */

/** What an act does, as far as anybody watching needs to tell them apart. */
export type Kind = "read" | "write" | "run" | "other";

export interface Step {
  /** The tool, as it spelled itself. */
  tool: string;
  kind: Kind;
  /** Everything after the name — the file, the command, what it found. */
  rest: string;
}

/**
 * Which tools do which of the three things.
 *
 * A closed list rather than a guess from the name. A tool nobody here has heard
 * of is drawn plainly, which is honest; drawn as a write because its name has
 * "set" in it would be a log that lies about what an agent did.
 */
const READS = new Set([
  "Read",
  "Glob",
  "Grep",
  "List",
  "LS",
  "Search",
  "WebFetch",
  "Webfetch",
  "Fetch",
  "WebSearch",
  "NotebookRead",
]);

const WRITES = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Patch",
  "Update",
]);

const RUNS = new Set(["Bash", "Shell", "Run", "Terminal"]);

/** `→ Name(argument)`, which is how every tool call is written down. */
const CALL = /^\s*→\s*([A-Za-z][A-Za-z0-9_]*)\s*(\(|$|\s)/;

/**
 * One line, as an act — or nothing, when it is not one.
 *
 * Most lines of a log are not: they are the agent's reasoning, its prose, a
 * warning, a blank. Those are left exactly as they are.
 */
export function stepOf(line: string): Step | null {
  const found = line.match(CALL);
  if (!found) return null;

  const tool = found[1]!;
  const rest = line.slice(line.indexOf(tool) + tool.length);
  return { tool, kind: kindOf(tool), rest };
}

/**
 * How many segments a path has to have before it is worth cutting down.
 *
 * Three, and only for the paths that start somewhere absolute. A path written
 * relative to the project is already saying what a reader needs — `src/app/hud`
 * is where the file is — and cutting it would throw information away for
 * nothing. The unreadable ones are unreadable because they begin at somebody's
 * home directory and walk down through a worktree, and every line of the turn
 * repeats the same walk.
 */
const DEEP = 3;

/**
 * The same line with its paths said the way a person would say them.
 *
 * Done here as well as where the line is written, and that is not belt and
 * braces. A log is text and it is kept: what an agent printed this afternoon is
 * on disk and comes back after a reload, so a change to how lines are written
 * improves the lines written after it and leaves every earlier line exactly as
 * unreadable as it was. Doing it as the line is drawn fixes the history too —
 * and it is the only thing that can, since the history is all that is left of
 * those turns.
 *
 * It also covers the tools Odin did not format. Not everything that reaches
 * this box came through `describeTool`; a tool that prints its own progress
 * prints its own paths.
 */
export function tidy(text: string): string {
  // `=` ends a token as surely as a space does: a command reads
  // `JAVA_HOME=~/.sdkman/…`, and the path is the part after the name of the
  // variable rather than the whole assignment.
  return text.replace(/[^\s()"'`=]*\/[^\s()"'`=]*/g, (token) => {
    // A URL is not a path: cutting the host off the front of one leaves
    // something that names nothing at all.
    if (token.includes("://")) return token;
    // Only what starts somewhere absolute. See `DEEP`.
    if (!token.startsWith("/") && !token.startsWith("~/")) return token;

    const parts = token.split("/").filter(Boolean);
    if (parts.length < DEEP) return token;
    // The last segment, which is the part that differs from line to line. See
    // `place` in the stream reader for why the parent folder is not kept.
    return parts[parts.length - 1] ?? token;
  });
}

export function kindOf(tool: string): Kind {
  if (READS.has(tool)) return "read";
  if (WRITES.has(tool)) return "write";
  if (RUNS.has(tool)) return "run";
  return "other";
}
