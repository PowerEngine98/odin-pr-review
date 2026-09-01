import { describe, expect, it } from "vitest";

import {
  matching,
  mentioned,
  splitMentions,
  typingMention,
  withMention,
} from "../src/app/mentions.js";

/**
 * Naming an agent in a remark.
 *
 * `@claude, does this hold when the list is empty?` is how a reader hands a
 * question to one tool rather than to whichever is free, and the host already
 * routes it that way. What the page did not do was show it: the name sat in the
 * paragraph as ordinary text, so a remark addressed to somebody looked exactly
 * like one addressed to nobody, and the only way to find out whether the name
 * had been recognised was to send it and see who answered.
 */
const AGENTS = [
  { id: "claude", name: "Claude" },
  { id: "opencode", name: "opencode" },
  { id: "codex", name: "Codex" },
];

const named = (text: string) =>
  splitMentions(text, AGENTS)
    .filter((piece) => piece.who)
    .map((piece) => `${piece.who!.id}:${piece.text}`);

describe("finding an agent's name in a remark", () => {
  it("finds one", () => {
    expect(named("@claude can you check this?")).toEqual(["claude:@claude"]);
  });

  it("does not care how it was capitalised", () => {
    // The same rule the host routes by. A reader who typed the wrong case
    // should see that it still counts, rather than sending it to find out.
    expect(named("@Claude and @OPENCODE")).toEqual([
      "claude:@Claude",
      "opencode:@OPENCODE",
    ]);
  });

  it("leaves an email address alone", () => {
    // `ada@claude.example` is an address, not a request — which is why the
    // character before the `@` is asked about at all.
    expect(named("write to ada@claude.example about it")).toEqual([]);
  });

  it("does not take a longer name for a shorter one", () => {
    // `\\b` sits happily between the `x` and the `-` of `@codex-bot`, so a word
    // boundary alone would read every mention of one tool as a mention of
    // another.
    expect(named("@codex-bot did it")).toEqual([]);
  });

  it("keeps the text either side of the name", () => {
    const pieces = splitMentions("ask @claude about it", AGENTS);
    expect(pieces.map((one) => one.text)).toEqual(["ask ", "@claude", " about it"]);
    expect(pieces[1]!.who?.id).toBe("claude");
  });

  it("says nothing about a page with no agents on it", () => {
    expect(splitMentions("@claude hello", [])).toEqual([{ text: "@claude hello" }]);
  });
});

describe("naming an agent while typing", () => {
  it("knows what is being typed at the caret", () => {
    const text = "please @cla";
    expect(typingMention(text, text.length)).toEqual({ query: "cla", from: 7, to: 11 });
  });

  it("offers everything on a bare @", () => {
    const text = "@";
    const typing = typingMention(text, 1)!;
    expect(typing.query).toBe("");
    expect(matching(typing.query, AGENTS)).toHaveLength(3);
  });

  it("stops offering once the name is a sentence", () => {
    // A name is one word; past the space the reader is writing the remark, and
    // a menu still open over it is in the way.
    const text = "@claude does this";
    expect(typingMention(text, text.length)).toBeUndefined();
  });

  it("says nothing about an @ that is part of something else", () => {
    const text = "ada@clau";
    expect(typingMention(text, text.length)).toBeUndefined();
  });

  it("only looks at the caret, not at the whole remark", () => {
    // Five mentions in a message are not five open menus.
    const text = "@claude and @codex are both here";
    expect(typingMention(text, text.length)).toBeUndefined();
  });

  it("offers the names that begin with what was typed", () => {
    // Beginning with rather than containing: a menu that answers `@co` with
    // everything that has an `o` in it is a menu the reader has to read.
    expect(matching("co", AGENTS).map((one) => one.id)).toEqual(["codex"]);
    expect(matching("op", AGENTS).map((one) => one.id)).toEqual(["opencode"]);
    expect(matching("c", AGENTS).map((one) => one.id)).toEqual(["claude", "codex"]);
  });

  it("puts the whole name in, and the caret after it", () => {
    const text = "please @cla";
    const typing = typingMention(text, text.length)!;
    const done = withMention(text, typing, AGENTS[0]!);
    expect(done.text).toBe("please @Claude ");
    expect(done.caret).toBe(done.text.length);
  });

  it("keeps whatever was written after the caret", () => {
    const text = "@cl about the empty list";
    const typing = typingMention(text, 3)!;
    expect(withMention(text, typing, AGENTS[0]!).text).toBe("@Claude  about the empty list");
  });
});

/**
 * Who a remark reaches, which is what the composer says underneath the field.
 *
 * A `<textarea>` is one colour of text all the way through, so the name a
 * writer has just finished typing looks exactly like the word before it and the
 * only way to find out whether it landed was to send it. This is the list drawn
 * under the box instead, and it is the same reading of the same text the
 * preview and the host use — three answers to "who is that" that disagree would
 * be worse than none.
 */
describe("who a remark reaches", () => {
  const reaching = (text: string) => mentioned(text, AGENTS).map((one) => one.id);

  it("names nobody when nobody is named", () => {
    expect(reaching("does this hold when the list is empty?")).toEqual([]);
  });

  it("names each agent the remark names", () => {
    expect(reaching("@claude and @codex, both of you")).toEqual(["claude", "codex"]);
  });

  it("names somebody once however often they are named", () => {
    // Naming somebody twice is emphasis, not a second reader, and a line that
    // said "Claude, Claude" would read as a bug in the page.
    expect(reaching("@claude — and @Claude again")).toEqual(["claude"]);
  });

  it("keeps the order they were first named in", () => {
    // The order on the line is the order in the remark, so the reader can look
    // from one to the other.
    expect(reaching("@codex first, then @claude")).toEqual(["codex", "claude"]);
  });

  it("does not name somebody out of an email address", () => {
    // The same rule as the highlighting: what is listed here is exactly what
    // will be answered there.
    expect(reaching("write to ada@claude.example")).toEqual([]);
  });

  it("hands back the agent, so the line can be drawn in its colour", () => {
    // The id is what `markOf` is asked for, and the name is what is shown, so
    // the pieces have to come back whole rather than as text.
    expect(mentioned("ask @Claude", AGENTS)).toEqual([{ id: "claude", name: "Claude" }]);
  });
});
