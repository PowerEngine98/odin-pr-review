import { describe, expect, it } from "vitest";

import { sentences, voiced, writtenSpan } from "../src/app/hud/voiced.js";

describe("code read aloud", () => {
  it("says a dot between words and drops the brackets", () => {
    expect(voiced("Order.total(total) pattern. A method").text).toBe(
      "Order dot total total  pattern. A method",
    );
  });

  it("says a file's extension", () => {
    expect(voiced("Main.kt").text).toBe("Main dot kt");
  });

  it("says a decimal point in a number", () => {
    expect(voiced("took 123.4 seconds").text).toBe("took 123 point 4 seconds");
    expect(voiced("file1.kt").text).toBe("file1 dot kt");
  });

  it("leaves a file's extension unsaid when asked to", () => {
    expect(voiced("Open Service.kt now", false).text).toBe("Open Service now");
    expect(voiced("Order.total(x)", false).text).toBe("Order dot total x ");
    expect(voiced("Service.kts", false).text).toBe("Service");
    expect(voiced("Service.ktx", false).text).toBe("Service dot ktx");
  });

  it("leaves a dot that ends a sentence alone", () => {
    expect(voiced("Compiling. Tests next.").text).toBe("Compiling. Tests next.");
  });

  it("finds the written word behind a spoken one", () => {
    const voice = voiced("Order.total(x)");
    expect(writtenSpan(voice, voice.text.indexOf("total"))).toEqual({ start: 6, end: 11 });
    expect(writtenSpan(voice, voice.text.indexOf("dot"))).toEqual({ start: 5, end: 6 });
  });
});

describe("sentences", () => {
  it("does not split a file name", () => {
    expect(sentences("Moved Main.kt. Done.").map((one) => one.text.trim())).toEqual([
      "Moved Main.kt.",
      "Done.",
    ]);
  });
});

describe("arrows", () => {
  it("reads both arrows as a change of one thing into another", async () => {
    const { voiced } = await import("../src/app/hud/voiced.js");
    expect(voiced("draft → sent").text.replace(/\s+/g, " ")).toBe("draft transforms into sent");
    expect(voiced("draft -> sent").text.replace(/\s+/g, " ")).toBe("draft transforms into sent");
  });

  it("boxes the whole arrow while either word is said", async () => {
    const { voiced, writtenSpan } = await import("../src/app/hud/voiced.js");
    const voice = voiced("a -> b");
    const said = voice.text.indexOf("transforms");
    expect(writtenSpan(voice, said)).toEqual({ start: 2, end: 4 });
    expect(writtenSpan(voice, voice.text.indexOf("into"))).toEqual({ start: 2, end: 4 });
  });
});

describe("folders in a path, when the reader would rather not hear them", () => {
  const quiet = (text: string, extensions = true) => voiced(text, extensions, false).text.replace(/\s+/g, " ").trim();

  it("reads only the file of a path", () => {
    expect(quiet("open /path/to/my/actual/file.txt now")).toBe("open file dot txt now");
    expect(quiet("see src/app/hud/voices.ts")).toBe("see voices dot ts");
    expect(quiet("in ./scripts/release.mjs and ~/notes/todo.md")).toBe("in release dot mjs and todo dot md");
  });

  it("reads just the name when extensions are off too", () => {
    expect(quiet("/path/to/my/actual/file.txt", false)).toBe("file");
  });

  it("leaves alone what only looks like a path", () => {
    expect(quiet("read and/or write")).toBe("read and/or write");
    expect(quiet("client/server split")).toBe("client/server split");
    expect(quiet("see https://github.com/o/r for more")).toBe("see https://github dot com/o/r for more");
  });

  it("reads every folder by default", () => {
    expect(voiced("/path/to/file.txt").text).toContain("path/to/file dot txt");
  });

  it("boxes the written file name while it is spoken", () => {
    const written = "open /path/to/file.txt";
    const voice = voiced(written, true, false);
    const at = voice.text.indexOf("file");
    const span = writtenSpan(voice, at)!;
    expect(written.slice(span.start, span.end)).toBe("file");
  });
});

describe("long numbers", () => {
  const said = (text: string) => voiced(text).text.replace(/\s+/g, " ").trim();

  it("are read one digit at a time", () => {
    expect(said("ab-12345678901234567")).toBe(
      "ab- one two three four five six seven eight nine zero one two three four five six seven",
    );
    expect(said("id 9007199254740991 here")).toBe("id nine zero zero seven one nine nine two five four seven four zero nine nine one here");
  });

  it("leave short numbers and decimals as numbers", () => {
    expect(said("took 12345 ms")).toBe("took 12345 ms");
    expect(said("ratio 1234567.25 done")).toBe("ratio 1234567 point 25 done");
    expect(said("version 3.1415926 here")).toBe("version 3 point 1415926 here");
  });

  it("box each digit as it is spoken", () => {
    const written = "ab-12345678";
    const voice = voiced(written);
    const at = voice.text.indexOf("three");
    const span = writtenSpan(voice, at)!;
    expect(written.slice(span.start, span.end)).toBe("3");
  });
});

describe("a folder path that ends with a slash", () => {
  const quiet = (text: string) => voiced(text, true, false).text.replace(/\s+/g, " ").trim();

  it("is read as its last folder, by the same rule as a file", () => {
    expect(quiet("in backend/src/test/kotlin/com/labura/accounts/username/ now")).toBe("in username now");
    expect(quiet("under /var/log/ there")).toBe("under log there");
  });

  it("is read whole when folders are narrated", () => {
    expect(voiced("backend/src/username/").text).toBe("backend/src/username/");
  });

  it("leaves a lone word with a slash alone", () => {
    expect(quiet("either/ or")).toBe("either/ or");
  });
});
