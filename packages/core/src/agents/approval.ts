import type { Agency } from "./discover.js";

/**
 * Whether an agent already has permission for what it is about to do.
 *
 * The rung the reader put it on is a standing answer, and re-asking a question
 * that has already been answered is how a permission prompt becomes something
 * people click through without reading. So a request at or below the rung is
 * allowed without anybody being interrupted, and the prompt is kept for what it
 * is actually for: an agent reaching past what it was given.
 *
 * Pure, and deliberately not where the socket is. What may happen is a rule;
 * what did happen is plumbing, and only one of the two is worth being able to
 * read without a running editor.
 */

/**
 * What a tool call actually does, as far as permission is concerned.
 *
 * Three kinds, because that is how many distinctions the rungs make. The names
 * the tools use are not a stable vocabulary — they differ per agent and change
 * between versions — so they are classified rather than enumerated, and
 * anything unrecognised is treated as the most dangerous kind it could be.
 */
export type Doing = "reads" | "writes" | "runs";

/**
 * Tool names that only look at things.
 *
 * Matched loosely and on purpose: a tool called `ReadFile`, `read_file` or
 * `Read` is the same question, and a list that had to be exact would go stale
 * silently — as a prompt for every read, which is the same as no prompt at all
 * once somebody has clicked through thirty of them.
 */
const READS = [
  /^read/i,
  /^glob/i,
  /^grep/i,
  /^ls$/i,
  /^list/i,
  /^search/i,
  /^find/i,
  /^notebookread/i,
  /^todo/i,
  /^task$/i,
  /^webfetch/i,
  /^websearch/i,
];

/** Tool names that change files in the checkout, and nothing else. */
const WRITES = [/^write/i, /^edit/i, /^multiedit/i, /^notebookedit/i, /^apply/i, /^patch/i];

/**
 * What this call is, from its name.
 *
 * Unrecognised means `runs`, which is the strictest answer available. A tool
 * nobody here has heard of is exactly the case where guessing generously is
 * the expensive mistake: the cost of being wrong the other way is one prompt.
 */
export function doingOf(tool: string): Doing {
  const name = tool.replace(/^mcp__[^_]+__/, "");
  if (READS.some((pattern) => pattern.test(name))) return "reads";
  if (WRITES.some((pattern) => pattern.test(name))) return "writes";
  return "runs";
}

/**
 * Whether the rung already covers this, or the reader has to be asked.
 *
 * `full` never reaches here — an agent on it is run with permission checks off
 * and has nothing to ask. `ask` never covers anything, which is what it means.
 */
export function permitted(rung: Agency, doing: Doing): boolean {
  if (rung === "full") return true;
  if (rung === "ask") return false;
  if (rung === "read") return doing === "reads";
  // `edits`: files in the checkout, freely. Running commands is the separate
  // decision, and it is the one still worth interrupting for.
  return doing !== "runs";
}

/** What a reader is being asked, in a sentence rather than a tool name. */
export function describeRequest(tool: string, input: unknown): string {
  const doing = doingOf(tool);
  const held = (input ?? {}) as Record<string, unknown>;

  const command = typeof held.command === "string" ? held.command : "";
  const path =
    typeof held.file_path === "string"
      ? held.file_path
      : typeof held.path === "string"
        ? held.path
        : "";

  if (doing === "runs" && command) return `run \`${short(command)}\``;
  if (doing === "writes" && path) return `write \`${path}\``;
  if (doing === "reads" && path) return `read \`${path}\``;
  return `use ${tool}`;
}

/** Long enough to recognise, short enough for a line in a thread. */
function short(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 120 ? one : `${one.slice(0, 120)}…`;
}
