import type { DiffLine, FileStatus, Hunk } from "../model/types.js";
import { stripPrefix, unquotePath } from "./unquote.js";

/** One file's worth of parsed patch, before it becomes a graph node. */
export interface ParsedFile {
  /** Head-side path, or the base path when the file was deleted. */
  path: string;
  /** Base-side path. Equals `path` unless the file was renamed or added. */
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  /** Present for renames/copies, 0-100. */
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Splits `diff --git <a> <b>` into its two paths.
 *
 * The line is genuinely ambiguous when paths contain spaces and are unquoted,
 * so this tries the quoted forms first and then looks for the split point that
 * yields a well-formed `a/... b/...` pair. Callers get authoritative paths from
 * the `---`/`+++` or `rename from`/`rename to` headers whenever those exist;
 * this is only the fallback.
 */
function splitDiffHeaderPaths(rest: string): [string, string] | undefined {
  if (rest.startsWith('"')) {
    // Find the closing quote that is not escaped.
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "\\") { i++; continue; }
      if (rest[i] !== '"') continue;
      const left = rest.slice(0, i + 1);
      const right = rest.slice(i + 1).trimStart();
      if (right) return [unquotePath(left), unquotePath(right)];
    }
    return undefined;
  }

  // Unquoted: prefer a split where the right half starts with `b/`.
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] !== " ") continue;
    const right = rest.slice(i + 1);
    if (right.startsWith("b/") || right === "/dev/null") {
      return [rest.slice(0, i), right];
    }
  }

  const half = rest.indexOf(" ");
  if (half < 0) return undefined;
  return [rest.slice(0, half), rest.slice(half + 1)];
}

/** Mutable accumulator used while walking the patch. */
interface Draft {
  aPath?: string;
  bPath?: string;
  renameFrom?: string;
  renameTo?: string;
  minusPath?: string;
  plusPath?: string;
  status?: FileStatus;
  binary: boolean;
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

function newDraft(): Draft {
  return { binary: false, hunks: [], additions: 0, deletions: 0 };
}

function finish(d: Draft): ParsedFile | undefined {
  // Resolve the authoritative paths, most trustworthy source first.
  const from = d.renameFrom ?? d.minusPath ?? d.aPath;
  const to = d.renameTo ?? d.plusPath ?? d.bPath;

  const added = from === "/dev/null" || (d.status === "added");
  const deleted = to === "/dev/null" || (d.status === "deleted");

  const headPath = added ? to : deleted ? from : (to ?? from);
  if (!headPath || headPath === "/dev/null") return undefined;

  let status: FileStatus;
  if (added) status = "added";
  else if (deleted) status = "deleted";
  else if (from && to && from !== to) status = "renamed";
  else status = "modified";

  const file: ParsedFile = {
    path: headPath,
    status,
    binary: d.binary,
    hunks: d.hunks,
    additions: d.additions,
    deletions: d.deletions,
  };
  if (!added && from && from !== "/dev/null") file.oldPath = from;
  if (d.similarity !== undefined) file.similarity = d.similarity;
  if (d.oldMode) file.oldMode = d.oldMode;
  if (d.newMode) file.newMode = d.newMode;
  return file;
}

/**
 * Parses `git diff` output (unified format) into per-file records.
 *
 * Deliberately tolerant: unknown extended headers are ignored rather than
 * throwing, because git grows new ones and a review tool should degrade to
 * "shows fewer details" rather than "shows nothing".
 *
 * Combined diffs (`@@@`, produced for merge commits) are not supported and
 * raise, because silently dropping one parent's changes would be misleading.
 */
export function parseUnifiedDiff(patch: string): ParsedFile[] {
  const lines = patch.split("\n");
  const files: ParsedFile[] = [];

  let draft: Draft | undefined;
  let hunk: Hunk | undefined;
  let oldCursor = 0;
  let newCursor = 0;
  /** True once we are inside the body of a hunk and `+`/`-` mean line kinds. */
  let inHunk = false;

  const closeFile = () => {
    if (!draft) return;
    const done = finish(draft);
    if (done) files.push(done);
    draft = undefined;
    hunk = undefined;
    inHunk = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      closeFile();
      draft = newDraft();
      const paths = splitDiffHeaderPaths(line.slice("diff --git ".length));
      if (paths) {
        draft.aPath = stripPrefix(unquotePath(paths[0]));
        draft.bPath = stripPrefix(unquotePath(paths[1]));
      }
      continue;
    }

    if (!draft) continue;

    if (line.startsWith("@@@")) {
      throw new Error(
        "combined diffs are not supported; diff a single parent instead",
      );
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
      hunk = {
        header: hunkMatch[5] ?? "",
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      };
      draft.hunks.push(hunk);
      oldCursor = oldStart;
      newCursor = newStart;
      inHunk = true;
      continue;
    }

    if (inHunk && hunk) {
      if (line.startsWith("\\")) {
        // "\ No newline at end of file" annotates the preceding line.
        const prev = hunk.lines[hunk.lines.length - 1];
        if (prev) prev.noNewline = true;
        continue;
      }

      const marker = line[0];
      if (marker === "+" || marker === "-" || marker === " ") {
        const text = line.slice(1);
        let entry: DiffLine;
        if (marker === "+") {
          entry = { kind: "add", text, newLine: newCursor++ };
          // `@@ -0,0` means the file has no base side; a position in it would
          // be a zero printed in the gutter beside every line.
          if (oldCursor >= 1) entry.oldAnchor = oldCursor;
          draft.additions++;
        } else if (marker === "-") {
          entry = { kind: "del", text, oldLine: oldCursor++ };
          if (newCursor >= 1) entry.newAnchor = newCursor;
          draft.deletions++;
        } else {
          entry = { kind: "ctx", text, oldLine: oldCursor++, newLine: newCursor++ };
        }
        hunk.lines.push(entry);
        continue;
      }

      // An empty line inside a hunk is a context line whose marker git dropped.
      // Real patches keep the space, but editors and copy/paste often eat it.
      if (line === "" && i < lines.length - 1) {
        hunk.lines.push({
          kind: "ctx",
          text: "",
          oldLine: oldCursor++,
          newLine: newCursor++,
        });
        continue;
      }

      // Anything else ends the hunk and is re-examined as a header below.
      inHunk = false;
      hunk = undefined;
    }

    if (line.startsWith("--- ")) {
      draft.minusPath = stripPrefix(unquotePath(line.slice(4).trimEnd()));
    } else if (line.startsWith("+++ ")) {
      draft.plusPath = stripPrefix(unquotePath(line.slice(4).trimEnd()));
    } else if (line.startsWith("new file mode ")) {
      draft.status = "added";
      draft.newMode = line.slice("new file mode ".length).trim();
    } else if (line.startsWith("deleted file mode ")) {
      draft.status = "deleted";
      draft.oldMode = line.slice("deleted file mode ".length).trim();
    } else if (line.startsWith("old mode ")) {
      draft.oldMode = line.slice("old mode ".length).trim();
    } else if (line.startsWith("new mode ")) {
      draft.newMode = line.slice("new mode ".length).trim();
    } else if (line.startsWith("rename from ")) {
      draft.renameFrom = unquotePath(line.slice("rename from ".length).trimEnd());
    } else if (line.startsWith("rename to ")) {
      draft.renameTo = unquotePath(line.slice("rename to ".length).trimEnd());
    } else if (line.startsWith("copy from ")) {
      draft.renameFrom = unquotePath(line.slice("copy from ".length).trimEnd());
    } else if (line.startsWith("copy to ")) {
      draft.renameTo = unquotePath(line.slice("copy to ".length).trimEnd());
    } else if (line.startsWith("similarity index ")) {
      const pct = Number.parseInt(line.slice("similarity index ".length), 10);
      if (Number.isFinite(pct)) draft.similarity = pct;
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      draft.binary = true;
    }
  }

  closeFile();
  return files;
}
