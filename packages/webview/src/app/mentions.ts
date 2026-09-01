/**
 * Naming an agent in a remark.
 *
 * `@claude, does this hold when the list is empty?` is how a reader hands a
 * question to one tool rather than to whichever is free, and the host already
 * reads it that way. What the page did not do was show it: the name sat in the
 * paragraph as ordinary text, so a remark addressed to somebody looked exactly
 * like a remark addressed to nobody, and the only way to find out whether the
 * name had been recognised was to send it and see who answered.
 *
 * Two questions, both about text and neither about drawing, so they live here
 * rather than in the components that draw: which parts of a line name an agent,
 * and what the reader is halfway through typing.
 */

export interface Named {
  id: string;
  name: string;
}

/** A run of text, and the agent it names if it names one. */
export interface Piece {
  text: string;
  who?: Named;
}

/**
 * The name as it can be written into a pattern.
 *
 * Agents are discovered from what is installed, so their names are whatever
 * somebody called a binary — and a name with a dot in it would otherwise match
 * anything at all in that position.
 */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where a mention may begin and end.
 *
 * A word boundary is not enough in either direction. `\b` sits happily between
 * the `x` and the `-` of `@codex-bot`, so a tool with a longer name would have
 * every mention of it read as a mention of the shorter one; and `ada@claude.dev`
 * is an email address rather than a request, which is what the character before
 * the `@` is being asked about.
 *
 * The same rule the host routes by, which is the point: what is highlighted
 * here is exactly what will be answered there, including the case-insensitivity
 * — `@Claude` and `@claude` are one name, and a reader who typed the wrong case
 * should see that it still counts.
 */
function pattern(name: string): RegExp {
  return new RegExp(`(^|[^\\w@])(@${escape(name)})(?![\\w-])`, "gi");
}

/**
 * A line broken into the parts that name somebody and the parts that do not.
 *
 * Longest name first, so `@codex-bot` is not read as `@codex` with `-bot`
 * trailing after it when both are installed.
 */
export function splitMentions(text: string, agents: readonly Named[]): Piece[] {
  if (!text || agents.length === 0) return text ? [{ text }] : [];

  const found: { at: number; end: number; who: Named }[] = [];
  const byLength = [...agents].sort((one, two) => two.name.length - one.name.length);

  for (const who of byLength) {
    const looking = pattern(who.name);
    let match: RegExpExecArray | null;
    while ((match = looking.exec(text)) !== null) {
      const at = match.index + (match[1]?.length ?? 0);
      const end = at + (match[2]?.length ?? 0);
      // A name inside one already found belongs to that one: the longer name
      // was written by the reader and the shorter is a coincidence of spelling.
      if (found.some((one) => at < one.end && end > one.at)) continue;
      found.push({ at, end, who });
    }
  }

  if (found.length === 0) return [{ text }];
  found.sort((one, two) => one.at - two.at);

  const pieces: Piece[] = [];
  let from = 0;
  for (const one of found) {
    if (one.at > from) pieces.push({ text: text.slice(from, one.at) });
    pieces.push({ text: text.slice(one.at, one.end), who: one.who });
    from = one.end;
  }
  if (from < text.length) pieces.push({ text: text.slice(from) });
  return pieces;
}

/**
 * Everybody a remark names, once each, in the order they are first named.
 *
 * The question a writer has while typing is "did that land on somebody", and a
 * textarea cannot answer it: it holds one colour of text and will not paint
 * part of it, so the name the reader has just finished typing looks exactly
 * like the word before it. What the composer can do is say underneath who the
 * remark reaches, and this is that list — the same reading of the same text
 * the preview and the host use, so the three cannot disagree.
 *
 * Once each because naming somebody twice is emphasis, not a second reader.
 */
export function mentioned(text: string, agents: readonly Named[]): Named[] {
  const seen = new Set<string>();
  const out: Named[] = [];
  for (const piece of splitMentions(text, agents)) {
    if (!piece.who || seen.has(piece.who.id)) continue;
    seen.add(piece.who.id);
    out.push(piece.who);
  }
  return out;
}

/** The name being typed at the caret, if one is. */
export interface Typing {
  /** What has been typed after the `@`, which may be nothing. */
  query: string;
  /** Where the `@` is, and where the caret is, so a choice can replace it. */
  from: number;
  to: number;
}

/**
 * What the reader is halfway through naming.
 *
 * Only ever at the caret and only ever in the word it sits in: a message with
 * five mentions in it is not five open menus, and a reader who has moved on has
 * finished with all of them. Nothing when the `@` is part of something else —
 * an email address, a decorator — for the same reason a mention is not read
 * there either.
 */
export function typingMention(text: string, caret: number): Typing | undefined {
  const upTo = text.slice(0, caret);
  const at = upTo.lastIndexOf("@");
  if (at < 0) return undefined;

  const before = at === 0 ? "" : upTo[at - 1]!;
  if (before && /[\w@]/.test(before)) return undefined;

  const query = upTo.slice(at + 1);
  // A name is one word. Once there is a space the reader is writing the remark
  // rather than the name, and a menu still open over it is in the way.
  if (/[\s@]/.test(query)) return undefined;

  return { query, from: at, to: caret };
}

/**
 * The agents worth offering for what has been typed so far.
 *
 * Starting with it rather than containing it: a menu that answers `@co` with
 * everything that has an `o` in it is a menu the reader has to read, and the
 * point of it is that they do not have to.
 */
export function matching(query: string, agents: readonly Named[]): Named[] {
  const looking = query.toLowerCase();
  return agents.filter((who) => who.name.toLowerCase().startsWith(looking));
}

/** The remark with the half-typed name replaced by a whole one. */
export function withMention(text: string, typing: Typing, who: Named): {
  text: string;
  caret: number;
} {
  const said = `@${who.name} `;
  return {
    text: text.slice(0, typing.from) + said + text.slice(typing.to),
    caret: typing.from + said.length,
  };
}
