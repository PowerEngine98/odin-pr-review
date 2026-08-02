import { describe, expect, it } from "vitest";

import { languageLabel, loadHighlighter } from "../src/index.js";

describe("loading grammars", () => {
  it("loads only what the change contains", async () => {
    const h = await loadHighlighter(["kotlin", "plaintext"]);
    expect(h.supports("kotlin")).toBe(true);
    expect(h.supports("typescript")).toBe(false);
    expect(h.missing).toEqual([]);
  });

  it("names what it cannot colour instead of failing", async () => {
    // A change is still worth looking at when one file in it is a language
    // nothing here knows; the page says so rather than showing a grey card
    // and leaving the reviewer to guess why.
    const h = await loadHighlighter(["typescript", "dart", "elixir"]);
    expect(h.supports("typescript")).toBe(true);
    expect(h.missing).toEqual(["dart", "elixir"]);
  });

  it("does not count plain text as a gap", async () => {
    const h = await loadHighlighter(["plaintext"]);
    expect(h.missing).toEqual([]);
  });

  it("returns the code untouched when there is no grammar", async () => {
    const h = await loadHighlighter(["dart"]);
    const lines = h.tokenize("dart", "void main() {}\nfinal x = 1;");
    expect(lines.map((l) => l.map((t) => t.text).join(""))).toEqual([
      "void main() {}",
      "final x = 1;",
    ]);
  });
});

describe("colouring", () => {
  it("gives a keyword and a string different colours", async () => {
    const h = await loadHighlighter(["kotlin"]);
    const [line] = h.tokenize("kotlin", 'fun main() { println("hi") }');
    const keyword = line!.find((t) => t.text.startsWith("fun"));
    const text = line!.find((t) => t.text.includes('"hi"'));
    expect(keyword?.color).toBeTruthy();
    expect(text?.color).toBeTruthy();
    expect(keyword?.color).not.toBe(text?.color);
  });

  it("carries a block comment across the lines it spans", async () => {
    // The whole reason tokenize takes a block: the middle line of a comment is
    // indistinguishable from code when it is handed over on its own.
    const h = await loadHighlighter(["typescript"]);
    const lines = h.tokenize("typescript", "/*\n const x = 1;\n*/");
    const middle = lines[1]!;
    const alone = h.tokenize("typescript", " const x = 1;")[0]!;
    expect(middle.every((t) => t.color === middle[0]!.color)).toBe(true);
    expect(middle[0]!.color).not.toBe(
      alone.find((t) => t.text.includes("const"))?.color,
    );
  });

  it("keeps every character of the line", async () => {
    // Tokens are only spans around the file's own text. If a character went
    // missing here, the width the layout engine measured would be wrong and
    // the browser's search would stop finding what is on screen.
    const h = await loadHighlighter(["typescript"]);
    const source = "  const greeting = `hello ${name}`;  ";
    const [line] = h.tokenize("typescript", source);
    expect(line!.map((t) => t.text).join("")).toBe(source);
  });

  it("colours the same code the same way twice", async () => {
    const h = await loadHighlighter(["typescript"]);
    const once = h.tokenize("typescript", "const a = 1;");
    const twice = h.tokenize("typescript", "const a = 1;");
    expect(once).toEqual(twice);
  });
});

describe("naming a language", () => {
  it("uses what a reviewer would call it", () => {
    expect(languageLabel("typescriptreact")).toBe("tsx");
    expect(languageLabel("shellscript")).toBe("shell");
    expect(languageLabel("kotlin")).toBe("kotlin");
  });
});

describe("a language the change does not contain", () => {
  it("loads it when something asks for it", async () => {
    // A comment can name any language at all — a reviewer quoting shell in a
    // Kotlin review is ordinary — and refusing to colour it because no file in
    // the diff is written in it would be a strange rule to explain.
    const h = await loadHighlighter(["typescript"]);
    expect(h.supports("kotlin")).toBe(false);

    expect(await h.ensure("kotlin")).toBe(true);
    expect(h.supports("kotlin")).toBe(true);

    const [line] = h.tokenize("kotlin", "fun test() = 1");
    expect(line!.some((t) => t.color)).toBe(true);
  });

  it("says no to one it has no grammar for", async () => {
    const h = await loadHighlighter(["typescript"]);
    expect(await h.ensure("brainfuck")).toBe(false);
  });

  it("starts from nothing when the change had no languages at all", async () => {
    const h = await loadHighlighter([]);
    expect(await h.ensure("python")).toBe(true);
    const [line] = h.tokenize("python", "def go(): pass");
    expect(line!.some((t) => t.color)).toBe(true);
  });
});
