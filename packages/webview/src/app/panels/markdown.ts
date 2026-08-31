/**
 * The markdown a review is written in, parsed into blocks a page can draw.
 *
 * A deliberately small subset, and its own module rather than part of the
 * component that draws it: the rules here are the ones every surface in this
 * page agrees on — a comment, an agent's answer, a question quoted in a log —
 * and they are worth being able to test without a browser to render them in.
 *
 * Nothing here produces markup. A block is data, and the template turns it into
 * real elements, so a sentence somebody wrote never becomes markup on its way
 * to the screen because it is never turned into markup at all.
 */

/** What a suggestion written here would replace, and where those lines live. */
export interface Suggestion {
  before: string[];
  startLine: number;
  language: string;
}

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "del"; text: string };

export type Block =
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "quote"; content: Inline[] }
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; items: { box: string; content: Inline[] }[] }
  | { kind: "code"; lang: string; code: string; id: number }
  /*
   * A picture, not a listing.
   *
   * Kept apart from `code` because the two want opposite things: a code block
   * is sent to the host to be coloured and printed as text, and this is
   * handed to a renderer that draws it. Telling them apart here rather than
   * at the point of drawing means the highlighting round trip is never asked
   * about a language no grammar has.
   */
  | { kind: "diagram"; code: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | {
      kind: "suggestion";
      before: string[];
      after: string[];
      startLine: number;
      language: string;
      beforeId: number;
      afterId: number;
    };

/** One line of code as the host colours it. */
export interface Token {
  text: string;
  color?: string;
}

/**
 * Names for the blocks the host is asked to colour.
 *
 * Unique across the page rather than per box: the answer comes back on the
 * one message channel every panel shares, and two editors that both called
 * their first block 1 would paint each other's code.
 */
let counter = 0;

/**
 * Inline marks, found in one pass.
 *
 * Deliberately flat: a bold sentence with code inside it renders as bold and
 * then as code, not as one nested in the other. The old renderer got the
 * nesting by running substitutions over escaped HTML, which is the trick this
 * is here to avoid — the text is a person's, and it is rendered as text.
 */
const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s]+)/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let at = 0;
  INLINE.lastIndex = 0;
  let found: RegExpExecArray | null;

  while ((found = INLINE.exec(text)) !== null) {
    if (found.index > at) {
      parts.push({ kind: "text", text: text.slice(at, found.index) });
    }
    if (found[1] !== undefined) parts.push({ kind: "code", text: found[1] });
    else if (found[2] !== undefined) parts.push({ kind: "strong", text: found[2] });
    else if (found[3] !== undefined) parts.push({ kind: "em", text: found[3] });
    else if (found[4] !== undefined) parts.push({ kind: "em", text: found[4] });
    else if (found[5] !== undefined) parts.push({ kind: "del", text: found[5] });
    else if (found[6] !== undefined) {
      // A link is its text and its target, never an anchor: a comment box is
      // not a place to put something a reader has not looked at one click
      // away.
      parts.push({ kind: "text", text: found[6] + " (" });
      parts.push({ kind: "code", text: found[7] });
      parts.push({ kind: "text", text: ")" });
    } else if (found[8] !== undefined) {
      parts.push({ kind: "code", text: found[8] });
    }
    at = found.index + found[0].length;
  }

  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

/**
 * Markdown, as far as a comment box needs it.
 *
 * A deliberately small subset, parsed into blocks the template draws as real
 * elements. Anything unrecognised stays the characters that were typed, which
 * is what the forge will store; a plain line is a better answer than a
 * confident wrong rendering of one — and a person's sentence never becomes
 * markup on its way to the screen, because it is never turned into markup at
 * all.
 */
export function parseMarkdown(source: string, context?: Suggestion | null): Block[] {
  const lines = source.split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced blocks first: nothing inside one is markdown.
    const fence = /^\s*(`{3,})(.*)$/.exec(line);
    /*
     * And only when it closes.
     *
     * A fence with no partner used to run to the end of the text, which is
     * what the specification says and the wrong answer here. Agents write
     * three backticks in the middle of a sentence — quoting the syntax,
     * printing a tool's output, thinking out loud — and one stray fence
     * turned the whole rest of the answer into a code block: bold gone,
     * paragraphs gone, several hundred words in one grey monospace slab.
     *
     * The stray backticks are shown as what they are instead. A block still
     * being printed goes on looking like prose until its closing fence
     * arrives, which is a beat of oddness against an answer swallowed whole.
     */
    const closes =
      fence !== null &&
      lines
        .slice(i + 1)
        .some((rest) => new RegExp("^\\s*" + fence[1]).test(rest));
    /*
     * A stray fence is a line like any other.
     *
     * It has to be consumed here rather than left to fall through: every branch
     * below refuses a line that opens a fence — a paragraph stops at one — so a
     * line nothing takes is a line the loop never gets past.
     */
    if (fence && !closes) {
      out.push({ kind: "paragraph", content: parseInline(line) });
      i++;
      continue;
    }

    if (fence && closes) {
      const lang = fence[2].trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp("^\\s*" + fence[1]).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;

      // A suggestion is a change, so it is drawn as one: what it replaces
      // above what it puts there, numbered, the way the forge draws it. A
      // block of green with no idea what it is replacing is half the story.
      if (lang === "suggestion") {
        out.push({
          kind: "suggestion",
          before: context?.before ?? [],
          after: body,
          startLine: context?.startLine ?? 0,
          language: context?.language ?? "",
          beforeId: ++counter,
          afterId: ++counter,
        });
        continue;
      }

      if (lang === "mermaid") {
        out.push({ kind: "diagram", code: body.join("\n") });
        continue;
      }

      out.push({ kind: "code", lang, code: body.join("\n"), id: ++counter });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({
        kind: "heading",
        level: Math.min(3, heading[1].length),
        content: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push({ kind: "quote", content: parseInline(quoted.join(" ")) });
      continue;
    }

    // A rule, which the forge draws and which otherwise reads as a heading.
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }

    // A table: a header row, a row of dashes, then the body. Recognised by
    // the dashes, because a line with pipes in it is usually just a line.
    if (
      line.indexOf("|") >= 0 && i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
    ) {
      const cells = (row: string): Inline[][] =>
        row
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((cell) => parseInline(cell.trim()));

      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].indexOf("|") >= 0 && lines[i].trim() !== "") {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push({ kind: "table", head, rows });
      continue;
    }

    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { box: string; content: Inline[] }[] = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
        const task = /^\[([ xX])\]\s*/.exec(item);
        if (task) {
          item = item.slice(task[0].length);
          items.push({
            box: task[1] === " " ? "☐ " : "☑ ",
            content: parseInline(item),
          });
        } else {
          items.push({ box: "", content: parseInline(item) });
        }
        i++;
      }
      out.push({ kind: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*`{3,}/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push({ kind: "paragraph", content: parseInline(para.join(" ")) });
  }

  return out;
}

/**
 * The markdown buttons, in the order the forge puts them.
 *
 * Drawn here rather than fetched, like every other glyph in the page. Rules
 * fall between the groups — the suggestion stands alone, then the marks, then
 * the lists — because ten of one thing would be a wall.
 */
