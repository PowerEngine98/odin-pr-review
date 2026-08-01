import { describe, expect, it } from "vitest";

import { stripJsonc } from "../src/jsonc.js";

/** What the editor's own theme files actually contain. */
describe("reading a theme file", () => {
  it("drops line comments", () => {
    expect(JSON.parse(stripJsonc('{\n  // the base\n  "type": "dark"\n}'))).toEqual({
      type: "dark",
    });
  });

  it("drops block comments", () => {
    expect(JSON.parse(stripJsonc('{ /* note */ "type": "dark" }'))).toEqual({
      type: "dark",
    });
  });

  it("keeps slashes that are inside strings", () => {
    // Scope selectors are full of them, and a stripper that does not track
    // string state eats half of every theme it reads.
    const source = '{ "scope": "comment.line.double-slash // not a comment" }';
    expect(JSON.parse(stripJsonc(source))).toEqual({
      scope: "comment.line.double-slash // not a comment",
    });
  });

  it("keeps an escaped quote inside a string", () => {
    const source = '{ "name": "say \\" then // more" }';
    expect(JSON.parse(stripJsonc(source))).toEqual({ name: 'say " then // more' });
  });

  it("drops a trailing comma before a brace or bracket", () => {
    expect(JSON.parse(stripJsonc('{ "a": [1, 2,], "b": 3, }'))).toEqual({
      a: [1, 2],
      b: 3,
    });
  });

  it("leaves ordinary json alone", () => {
    const source = '{"tokenColors":[{"scope":["keyword"],"settings":{"foreground":"#569CD6"}}]}';
    expect(stripJsonc(source)).toBe(source);
  });
});
