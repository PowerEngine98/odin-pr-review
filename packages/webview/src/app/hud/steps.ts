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

export function kindOf(tool: string): Kind {
  if (READS.has(tool)) return "read";
  if (WRITES.has(tool)) return "write";
  if (RUNS.has(tool)) return "run";
  return "other";
}
