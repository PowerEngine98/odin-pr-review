/**
 * Keeping a remark on the code it was written about, while the code moves.
 *
 * A comment is anchored by a line number, which is the right thing to store
 * when nothing under it changes. In a live reading something does: the reader
 * writes "this loop is wrong" against line 212, an agent takes an earlier
 * message and inserts nine lines above it, and line 212 is now somewhere in the
 * middle of an import block. Nothing announced the move. The mark still sits at
 * 212, the composer still says 212, and — the expensive one — the prompt handed
 * to the next agent still says `src/a.ts:212`, so it goes and edits whatever is
 * there now.
 *
 * The fix is to store what the remark was about as well as where it was. A line
 * number is a position; the text of the lines is an identity, and an identity
 * survives everything above it moving. So a remark carries the passage it was
 * written against, and where it is *now* is worked out by looking for that
 * passage in the file as it currently stands.
 *
 * This is deliberately exact. Something fuzzy — nearest match, similarity above
 * some threshold — would keep more remarks anchored and would sometimes anchor
 * one to code it was never about, silently, in the one place where being
 * silently wrong means an agent editing the wrong lines. When the passage is
 * gone it is gone, and that is a fact somebody has to be told rather than
 * papered over.
 */

/** Where a remark sits, as lines of a file. */
export interface Span {
  /** The last line, which is the one a single-line remark is on. */
  line: number;
  /** The first, when the remark covers more than one line. */
  startLine?: number;
}

/**
 * The lines a remark covers, as text.
 *
 * Taken from the file rather than from the drawing on purpose. The drawing is
 * the change as it was built, which may be a rebuild or two behind what is on
 * disk; the file is what an agent will open. Anchoring to anything else means
 * anchoring to a passage that may not be in the file at all, which fails on the
 * first use rather than usefully.
 */
export function passageAt(content: string, span: Span): string | undefined {
  const lines = content.split("\n");
  const first = (span.startLine ?? span.line) - 1;
  const last = span.line - 1;
  if (first < 0 || last < first || last >= lines.length) return undefined;
  const passage = lines.slice(first, last + 1).join("\n");
  // Whitespace anchors nothing: a blank line is in every file, several times.
  return passage.trim() === "" ? undefined : passage;
}

/**
 * Where that passage is now, or nothing when it is no longer there.
 *
 * `near` is where it used to be, and it decides between several matches rather
 * than finding them: a passage that appears three times in a file has moved to
 * whichever of the three is closest to where it was, because code moves short
 * distances far more often than it is duplicated at a distance. With one match
 * it changes nothing.
 */
export function whereNow(
  content: string,
  passage: string,
  near?: number,
): Span | undefined {
  if (passage === "") return undefined;
  const lines = content.split("\n");
  const wanted = passage.split("\n");

  const found: number[] = [];
  for (let at = 0; at + wanted.length <= lines.length; at++) {
    let same = true;
    for (let n = 0; n < wanted.length; n++) {
      if (lines[at + n] !== wanted[n]) {
        same = false;
        break;
      }
    }
    if (same) found.push(at + 1);
  }
  if (found.length === 0) return undefined;

  const start =
    near === undefined
      ? found[0]!
      : found.reduce((best, one) =>
          Math.abs(one - near) < Math.abs(best - near) ? one : best,
        );

  return wanted.length === 1
    ? { line: start }
    : { line: start + wanted.length - 1, startLine: start };
}

/**
 * Whether a remark has moved, and where to.
 *
 * Three answers, and they are three different situations that must not be
 * collapsed into two. `here` — the passage is where the remark says it is, and
 * nothing needs doing. `moved` — it is elsewhere in the file, and every line
 * number quoted about this remark should be the new one. `gone` — the passage
 * is not in the file any more, which is the case where guessing does damage and
 * somebody has to decide what the remark now means.
 */
export type Standing =
  | { state: "here"; span: Span }
  | { state: "moved"; span: Span; from: Span }
  | { state: "gone"; from: Span };

export function standingOf(content: string, passage: string, from: Span): Standing {
  const now = whereNow(content, passage, from.startLine ?? from.line);
  if (!now) return { state: "gone", from };
  const same =
    now.line === from.line && (now.startLine ?? now.line) === (from.startLine ?? from.line);
  return same ? { state: "here", span: now } : { state: "moved", span: now, from };
}

/** A span as it is written in a prompt and shown to a reader. */
export function spanText(span: Span): string {
  return span.startLine !== undefined && span.startLine < span.line
    ? `${span.startLine}-${span.line}`
    : String(span.line);
}
