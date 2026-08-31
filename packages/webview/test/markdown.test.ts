import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/app/panels/markdown.js";

/**
 * A fence with no partner.
 *
 * The specification says an unclosed fence runs to the end of the document, and
 * that is the wrong answer for a log. Agents write three backticks in the
 * middle of a sentence — quoting the syntax, pasting a tool's output, thinking
 * out loud — and one stray fence turned everything after it into a code block:
 * bold gone, paragraphs gone, several hundred words in one grey monospace slab
 * with the backticks still showing at the top of it.
 */
describe("a code fence that never closes", () => {
  const kinds = (source: string) => parseMarkdown(source).map((block) => block.kind);

  it("does not swallow the rest of the answer", () => {
    const said = [
      "Here is what I mean:",
      "```ts",
      "const a = 1",
      "",
      "**And this stays bold**, and this stays a paragraph.",
    ].join("\n");

    expect(kinds(said)).not.toContain("code");
    expect(kinds(said).filter((kind) => kind === "paragraph").length).toBeGreaterThan(1);
  });

  it("shows the stray backticks as what they are", () => {
    const blocks = parseMarkdown("before\n```ts\nafter");
    const text = JSON.stringify(blocks);
    expect(text).toContain("```ts");
  });

  it("still reads a fence that does close", () => {
    const said = ["```ts", "const a = 1", "```", "and prose after it"].join("\n");
    expect(kinds(said)).toEqual(["code", "paragraph"]);
  });

  it("still reads a suggestion, which is a fence like any other", () => {
    const said = ["```suggestion", "const a = 2", "```"].join("\n");
    expect(kinds(said)).toEqual(["suggestion"]);
  });

  it("reads the second of two fences as the close of the first", () => {
    const said = ["```", "one", "```", "```", "two", "```"].join("\n");
    expect(kinds(said)).toEqual(["code", "code"]);
  });

  it("leaves an odd third fence as text rather than eating the tail", () => {
    // Which is the shape that actually turns up: a closed block, then a stray
    // fence somewhere in the prose underneath it.
    const said = ["```", "one", "```", "then prose", "```", "more prose"].join("\n");
    expect(kinds(said).filter((kind) => kind === "code")).toHaveLength(1);
    expect(kinds(said).filter((kind) => kind === "paragraph").length).toBeGreaterThan(1);
  });
});

/**
 * A picture named in a remark.
 *
 * The only one anybody writes here is a screenshot pasted into a conversation,
 * which becomes a file on this machine and a path in the remark — the path is
 * what an agent can open. Printed as markdown it is a line of temp directory
 * nobody can read and nothing at all to look at, which is the opposite of why a
 * picture was pasted.
 */
describe("a picture in a remark", () => {
  const inlines = (source: string) => {
    const [block] = parseMarkdown(source);
    return block && "content" in block ? block.content : [];
  };

  it("is a picture rather than a link with a bang on it", () => {
    expect(inlines("![a screenshot](/tmp/x.png)")).toEqual([
      { kind: "image", alt: "a screenshot", src: "/tmp/x.png" },
    ]);
  });

  it("keeps the words around it", () => {
    const parts = inlines("look: ![](/tmp/x.png) what do you think?");
    expect(parts[0]).toEqual({ kind: "text", text: "look: " });
    expect(parts[1]!.kind).toBe("image");
    expect(parts[2]).toEqual({ kind: "text", text: " what do you think?" });
  });

  it("does not take an ordinary link for one", () => {
    // A link is still its text and its target, never an anchor.
    const parts = inlines("see [the docs](https://example.test/x)");
    expect(parts.some((part) => part.kind === "image")).toBe(false);
  });

  it("takes a path with spaces in it, which a screenshot often has", () => {
    expect(inlines("![](/tmp/a folder/x.png)")).toEqual([
      { kind: "image", alt: "", src: "/tmp/a folder/x.png" },
    ]);
  });
});
