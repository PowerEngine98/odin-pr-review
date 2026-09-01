/**
 * Pictures named in text, found and said.
 *
 * A picture reaches this page as a path rather than as bytes. A screenshot
 * pasted into a conversation becomes a file on this machine, the remark carries
 * where it went, and the agent's own log names that file again every time it
 * opens it. Both are right for the agent and useless for the reader, who cannot
 * open `/var/folders/qz/T/odin-pasted-3f/pasted-1.png` and had no reason to
 * want the string.
 *
 * So two questions, both about text and neither about drawing, kept out of the
 * components that draw: which pictures a line names, and what a line says once
 * the pictures in it are read as pictures rather than spelled out.
 */

/** What a picture is written as, by the extensions the host will serve. */
const KINDS = "png|jpe?g|gif|webp|bmp|svg";

/**
 * A path to a picture, sitting in a line of somebody else's output.
 *
 * Absolute only, and that is a limitation rather than an oversight: the host is
 * handed the path exactly as written and resolves it as given, so a relative
 * one would resolve against the editor's own working directory rather than
 * against the checkout the agent is standing in — which is a file that is
 * either absent or the wrong one. A tool line naming `src/logo.png` is left as
 * the text it is.
 *
 * Bounded by whitespace and by the punctuation a path is usually wrapped in,
 * because that is all there is to go on: `Read(/tmp/a/b.png)` has to give up
 * the bracket and `"…/b.png"` the quote. A path with a space in it cannot be
 * told from a path followed by a sentence, so it is not found at all — nothing
 * is drawn, and the line reads as it did before.
 */
const NAMED = new RegExp(
  `(?:^|[\\s"'\`(\\[<])((?:/|[A-Za-z]:[\\\\/])[^\\s"'\`)\\]<>|,]*\\.(?:${KINDS}))\\b`,
  "gi",
);

/**
 * Every picture a line names, in the order it names them, once each.
 *
 * Once each because a tool that reads a file and then writes about it puts the
 * same path on the same line twice, and two of the same screenshot under one
 * line of a log is a log that has started repeating itself.
 */
export function picturesNamed(text: string): string[] {
  const found: string[] = [];
  NAMED.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NAMED.exec(text)) !== null) {
    const path = match[1];
    if (path && !found.includes(path)) found.push(path);
  }
  return found;
}

/** What a picture is called, which is the only part of a path worth showing. */
export function nameOf(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return (at >= 0 ? path.slice(at + 1) : path) || path;
}

/** A picture written in markdown, which is how a remark carries one. */
const WRITTEN = /!\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * What a remark says, for the places that have room for a line and no more.
 *
 * A queued question, a row in the list of threads, the tooltip on a mark: each
 * of them takes the first line of a remark and prints it. A remark whose whole
 * content is a pasted screenshot has `![pasted image](/var/folders/…)` as that
 * line, so what the reader got was a temporary directory where a summary
 * should have been — and for a picture-only question, nothing else at all.
 *
 * The picture is said instead of spelled: its own description where it has one,
 * and the word otherwise. Somewhere with room draws the picture as well, but
 * that is the drawing's business and this still has to read on its own.
 */
export function saidOf(body: string): string {
  return body
    .replace(WRITTEN, (_whole, alt: string) => alt.trim() || "picture")
    .trim();
}
