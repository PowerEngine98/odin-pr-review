/**
 * What an agent actually changed, kept as a list rather than as prose.
 *
 * A terminal already shows a turn as it happens, and it is the wrong shape for
 * this question. The log is minutes long, interleaves four tools, and describes
 * an edit as one line — `Edit(src/media/VideoPreview.tsx)` — which says a file
 * was touched and nothing whatever about what happened to it. The question a
 * reviewer asks afterwards is the other one: what did it write, where, and is
 * that still what the file says.
 *
 * So the edits are lifted out of the stream as they go past and kept as their
 * own record: before, after, when, and the file. That is enough to draw them as
 * the change they are, to fly the drawing to the line, and — because the after
 * text is kept verbatim — to say later whether the file still reads that way.
 */

/** One edit, as the tool announced it. */
export interface Change {
  /** Absolute or repo-relative, exactly as the tool spelled it. */
  path: string;
  /** What was there. Empty for a file being written whole. */
  before: string;
  /** What is there now. Empty for a deletion. */
  after: string;
  /** Whether the tool replaced part of a file or wrote all of it. */
  whole: boolean;
}

/** One edit, once the host has said where and when it happened. */
export interface Delta extends Change {
  /** Stable, and stable across a reload: the ledger is written down. */
  id: string;
  /**
   * Which agent made it, when that can be said.
   *
   * Absent more often than not, and that is the honest state rather than a
   * gap. The ledger is built from what the file watcher saw, because the
   * watcher is the only thing that sees every change to a checkout whoever
   * made it — an agent, a formatter, the reader's own hands. Attribution comes
   * from a tool having announced the same file a moment earlier, which only
   * the tools that narrate their work ever do.
   *
   * A change nobody can be blamed for is still a change to the branch under
   * review, and leaving it out would make the list quietly untrue.
   */
  agent?: string;
  /** Repo-relative, so it can be matched against a card. */
  path: string;
  /** When, in epoch milliseconds. Formatted for reading by `clockOf`. */
  at: number;
  /**
   * Where `after` starts in the file, 1-based, when the host could find it.
   *
   * Absent when it could not — a file the agent wrote and something else has
   * since rewritten, or an edit whose text moved out from under the search.
   * An entry with no line still says what was written; it simply has nowhere
   * to fly to.
   */
  line?: number;
  /**
   * A short contiguous run of the new text, for finding this entry again.
   *
   * `after` is what the entry draws, and a drawing may be several separated
   * passages with a marker between them — text that appears nowhere in any
   * file. Searching for that would mark every entry outdated, correctly and
   * uselessly. This is one unbroken run taken from the change itself, which is
   * what the line and the outdated mark are both worked out from.
   */
  probe?: string;
  /**
   * Whether the file still reads the way this entry says it left it.
   *
   * Worked out by the host against the file on disk, because that is the only
   * thing that knows. Stamped rather than stored: it is a fact about now.
   */
  stale?: boolean;
  /** The conversation this came out of, so the entry can point back at it. */
  ask?: number;
}

/**
 * The edits inside one assistant event.
 *
 * Read off the tool calls rather than the prose. An agent's own account of what
 * it changed is a summary written after the fact, and the whole reason for a
 * ledger is that summaries are where the discrepancies hide.
 *
 * Only the tools that write. A `Read` or a `Grep` changed nothing and belongs
 * in the log, which already has it.
 */
export function changesIn(event: unknown): Change[] {
  const message = (event as { message?: { content?: unknown[] } }).message;
  const found: Change[] = [];

  for (const block of message?.content ?? []) {
    const part = block as Record<string, unknown>;
    if (part.type !== "tool_use") continue;
    const name = typeof part.name === "string" ? part.name : "";
    const input = (part.input ?? {}) as Record<string, unknown>;
    const path = typeof input.file_path === "string" ? input.file_path : "";
    if (!path) continue;

    if (name === "Edit" || name === "NotebookEdit") {
      const before = text(input.old_string ?? input.old_source);
      const after = text(input.new_string ?? input.new_source);
      // A no-op edit is a tool call that happened, not a change that did.
      if (before === after) continue;
      found.push({ path, before, after, whole: false });
      continue;
    }

    if (name === "MultiEdit" && Array.isArray(input.edits)) {
      /*
       * Kept apart, one entry per edit.
       *
       * A single call can replace six unrelated passages in one file, and
       * folding them into one entry would give the ledger a before and after
       * that never existed together — as well as one line to fly to for six
       * places. They share a moment, which is what makes them read as one act.
       */
      for (const one of input.edits) {
        const edit = one as Record<string, unknown>;
        const before = text(edit.old_string);
        const after = text(edit.new_string);
        if (before === after) continue;
        found.push({ path, before, after, whole: false });
      }
      continue;
    }

    if (name === "Write") {
      found.push({ path, before: "", after: text(input.content), whole: true });
    }
  }

  return found;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The time of day, as a clock reads it.
 *
 * Twelve hour, because that is what the reader asked for and what the machine
 * beside them is set to. Not `toLocaleTimeString`: the ledger is written down
 * and read back on the same entries, and a format that changes with the host's
 * locale gives a list where yesterday's rows are spelled differently from
 * today's.
 */
export function clockOf(at: number): string {
  const when = new Date(at);
  const hours = when.getHours();
  const oclock = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(when.getMinutes()).padStart(2, "0");
  return `${oclock}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** The day, for the heading that separates one session's work from the next. */
export function dayOf(at: number): string {
  const when = new Date(at);
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(
    when.getDate(),
  ).padStart(2, "0")}`;
}

/** A line of the drawn change, which is what the ledger renders. */
export interface Line {
  kind: "same" | "del" | "add";
  text: string;
  /** The line it was, 1-based, where it had one. */
  was?: number;
  /** The line it is, 1-based, where it has one. */
  now?: number;
}

/**
 * How much unchanged code is worth showing around a change.
 *
 * Three, as every diff tool settles on: enough to recognise where you are,
 * little enough that a one-line edit is not a screen of context.
 */
const AROUND = 3;

/**
 * The change between two texts, as lines to draw.
 *
 * A real diff rather than "all of the before, then all of the after", which is
 * how a suggestion in a comment is drawn and is fine there — a suggestion is a
 * handful of lines somebody typed. An edit is a passage a tool replaced, and
 * the passages these tools replace routinely share most of their lines. Drawn
 * the crude way, a one-word change to a twelve-line block is twenty-four rows
 * of which two matter.
 *
 * `at` is where `before` started in the file, so the numbers down the side are
 * the file's own rather than one-based on the fragment. Without it the rows are
 * numbered from the top of the passage, which is honest — it is what is known —
 * and still the wrong number to show beside a line.
 */
export function linesOf(before: string, after: string, at?: number): Line[] {
  const was = before === "" ? [] : before.split("\n");
  const now = after === "" ? [] : after.split("\n");
  const same = common(was, now);

  const drawn: Line[] = [];
  let a = 0;
  let b = 0;
  const start = at ?? 1;

  for (const step of same) {
    while (a < step.a) drawn.push({ kind: "del", text: was[a]!, was: start + a++ });
    while (b < step.b) drawn.push({ kind: "add", text: now[b]!, now: start + b++ });
    drawn.push({ kind: "same", text: was[a]!, was: start + a, now: start + b });
    a++;
    b++;
  }
  while (a < was.length) drawn.push({ kind: "del", text: was[a]!, was: start + a++ });
  while (b < now.length) drawn.push({ kind: "add", text: now[b]!, now: start + b++ });

  return trimmed(drawn);
}

/** Unchanged runs at the ends and in the middle, cut back to `AROUND`. */
function trimmed(lines: Line[]): Line[] {
  const keep = new Set<number>();
  for (let at = 0; at < lines.length; at++) {
    if (lines[at]!.kind === "same") continue;
    for (let n = Math.max(0, at - AROUND); n <= Math.min(lines.length - 1, at + AROUND); n++) {
      keep.add(n);
    }
  }
  // Nothing changed at all: show the passage rather than an empty box.
  if (keep.size === 0) return lines.slice(0, AROUND * 2);

  const out: Line[] = [];
  let cut = false;
  for (let at = 0; at < lines.length; at++) {
    if (keep.has(at)) {
      out.push(lines[at]!);
      cut = false;
      continue;
    }
    // One marker per gap, rather than one per line dropped.
    if (!cut) {
      cut = true;
      out.push({ kind: "same", text: "⋯" });
    }
  }
  return out;
}

/**
 * The lines two texts have in common, in order.
 *
 * A plain longest-common-subsequence table. The passages a tool replaces are
 * tens of lines, not thousands, so the quadratic table is microseconds and the
 * alternative — a Myers diff nobody in this repository would have reason to
 * read again — buys nothing. Bounded all the same, because a `Write` of a whole
 * file is not tens of lines, and there `before` is empty so no table is built.
 */
function common(was: string[], now: string[]): { a: number; b: number }[] {
  if (was.length === 0 || now.length === 0) return [];
  if (was.length * now.length > 4_000_000) return [];

  const wide = now.length + 1;
  const table = new Uint32Array((was.length + 1) * wide);
  for (let a = was.length - 1; a >= 0; a--) {
    for (let b = now.length - 1; b >= 0; b--) {
      table[a * wide + b] =
        was[a] === now[b]
          ? table[(a + 1) * wide + b + 1]! + 1
          : Math.max(table[(a + 1) * wide + b]!, table[a * wide + b + 1]!);
    }
  }

  const steps: { a: number; b: number }[] = [];
  let a = 0;
  let b = 0;
  while (a < was.length && b < now.length) {
    if (was[a] === now[b]) {
      steps.push({ a, b });
      a++;
      b++;
    } else if (table[(a + 1) * wide + b]! >= table[a * wide + b + 1]!) {
      a++;
    } else {
      b++;
    }
  }
  return steps;
}

/**
 * Where a passage sits in a file, 1-based, or nothing when it does not.
 *
 * Used twice and for two different questions: to find the line an entry should
 * fly to when it is recorded, and to answer whether the file still reads that
 * way when the ledger is drawn. Both are the same search, and it is a plain
 * one — the text as written, found or not found. Something cleverer that landed
 * on an approximate match would make the outdated pill a guess, and a pill that
 * is sometimes wrong is worse than one that is sometimes absent.
 */
export function lineOf(content: string, passage: string): number | undefined {
  if (passage === "") return undefined;
  const at = content.indexOf(passage);
  if (at < 0) return undefined;
  // How many newlines are behind it, which is the line it starts on.
  let line = 1;
  for (let n = 0; n < at; n++) if (content.charCodeAt(n) === 10) line++;
  return line;
}

/**
 * How much of one entry is worth keeping.
 *
 * A `Write` can carry a file of any size, and the ledger is persisted in the
 * workspace's own storage alongside every comment in the reading. Truncated
 * with a word saying so rather than dropped: an entry that says a file was
 * written and shows the first hundred lines of it is useful; one that silently
 * shows a hundred lines as though they were the whole thing is not.
 */
export const ROOM = 8000;

/**
 * The longest unbroken run of new text in a drawn change.
 *
 * Unbroken because a passage with a gap marker in it exists in no file, and the
 * longest because the more of it there is the less likely it is to match
 * somewhere else by accident. Falls back to the unchanged lines for a pure
 * deletion, which has no new text of its own but still happened somewhere.
 */
export function probeOf(lines: Line[]): string {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const line of lines) {
    // The marker, which is not a line of anything.
    if (line.kind === "same" && line.was === undefined && line.now === undefined) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    if (line.kind === "del") continue;
    run.push(line.text);
  }
  if (run.length > 0) runs.push(run);

  const best = runs.sort((a, b) => b.length - a.length)[0] ?? [];
  return best.join("\n");
}

export function within(body: string): string {
  return body.length <= ROOM ? body : `${body.slice(0, ROOM)}\n… truncated`;
}
