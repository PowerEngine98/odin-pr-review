import { detectDialect } from "../src/model/language.js";
import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse.js";
import { unquotePath } from "../src/diff/unquote.js";

describe("parseUnifiedDiff", () => {
  it("reads a plain modification with correct line numbering", () => {
    const patch = [
      "diff --git a/src/App.ts b/src/App.ts",
      "index 1111111..2222222 100644",
      "--- a/src/App.ts",
      "+++ b/src/App.ts",
      "@@ -10,4 +10,5 @@ class App {",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " const d = 5;",
      "",
    ].join("\n");

    const [file] = parseUnifiedDiff(patch);
    expect(file).toBeDefined();
    expect(file!.status).toBe("modified");
    expect(file!.path).toBe("src/App.ts");
    expect(file!.additions).toBe(2);
    expect(file!.deletions).toBe(1);

    const hunk = file!.hunks[0]!;
    expect(hunk.header).toBe("class App {");
    expect(hunk.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["ctx", 10, 10],
      ["del", 11, undefined],
      ["add", undefined, 11],
      ["add", undefined, 12],
      ["ctx", 12, 13],
    ]);
  });

  it("classifies added files", () => {
    const patch = [
      "diff --git a/src/New.kt b/src/New.kt",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/src/New.kt",
      "@@ -0,0 +1,2 @@",
      "+package demo",
      "+class New",
      "",
    ].join("\n");

    const [file] = parseUnifiedDiff(patch);
    expect(file!.status).toBe("added");
    expect(file!.path).toBe("src/New.kt");
    expect(file!.oldPath).toBeUndefined();
    expect(file!.additions).toBe(2);
  });

  it("classifies deleted files and keeps the base path", () => {
    const patch = [
      "diff --git a/src/Gone.kt b/src/Gone.kt",
      "deleted file mode 100644",
      "index 4444444..0000000",
      "--- a/src/Gone.kt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-package demo",
      "-class Gone",
      "",
    ].join("\n");

    const [file] = parseUnifiedDiff(patch);
    expect(file!.status).toBe("deleted");
    expect(file!.path).toBe("src/Gone.kt");
    expect(file!.deletions).toBe(2);
  });

  it("classifies pure renames that carry no hunks", () => {
    const patch = [
      "diff --git a/src/Old.kt b/src/New.kt",
      "similarity index 100%",
      "rename from src/Old.kt",
      "rename to src/New.kt",
      "",
    ].join("\n");

    const [file] = parseUnifiedDiff(patch);
    expect(file!.status).toBe("renamed");
    expect(file!.path).toBe("src/New.kt");
    expect(file!.oldPath).toBe("src/Old.kt");
    expect(file!.similarity).toBe(100);
    expect(file!.hunks).toEqual([]);
  });

  it("flags binary files instead of inventing hunks", () => {
    const patch = [
      "diff --git a/logo.png b/logo.png",
      "index 5555555..6666666 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "",
    ].join("\n");

    const [file] = parseUnifiedDiff(patch);
    expect(file!.binary).toBe(true);
    expect(file!.hunks).toEqual([]);
  });

  it("attaches the no-newline marker to the preceding line", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    const hunk = parseUnifiedDiff(patch)[0]!.hunks[0]!;
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newLines).toBe(1);
    expect(hunk.lines.map((l) => l.noNewline)).toEqual([true, true]);
  });

  it("keeps multiple files separate", () => {
    const patch = [
      "diff --git a/one.ts b/one.ts",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/two.ts b/two.ts",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1 +1 @@",
      "-c",
      "+d",
      "",
    ].join("\n");

    expect(parseUnifiedDiff(patch).map((f) => f.path)).toEqual([
      "one.ts",
      "two.ts",
    ]);
  });

  it("refuses combined diffs rather than dropping a parent", () => {
    const patch = [
      "diff --cc merged.ts",
      "@@@ -1,1 -1,1 +1,1 @@@",
      "++merged",
      "",
    ].join("\n");
    // A `diff --cc` header does not open a file draft, so pair it with the
    // regular header git also emits under --patch to reach the guard.
    const withHeader = "diff --git a/merged.ts b/merged.ts\n" + patch;
    expect(() => parseUnifiedDiff(withHeader)).toThrow(/combined diffs/);
  });

  it("returns nothing for an empty patch", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("unquotePath", () => {
  it("passes unquoted paths through", () => {
    expect(unquotePath("src/App.ts")).toBe("src/App.ts");
  });

  it("decodes C escapes", () => {
    expect(unquotePath('"src/a\\tb.ts"')).toBe("src/a\tb.ts");
    expect(unquotePath('"src/say \\"hi\\".ts"')).toBe('src/say "hi".ts');
  });

  it("decodes multi-byte octal sequences as UTF-8", () => {
    // "é" is 0xC3 0xA9 in UTF-8, which git emits as \303\251.
    expect(unquotePath('"caf\\303\\251.ts"')).toBe("café.ts");
  });
});

describe("telling the SQL dialects apart", () => {
  it("calls a plain schema SQL", () => {
    expect(detectDialect("db/001.sql", "CREATE TABLE customers (id uuid);")).toBe("sql");
  });

  it("calls a schema that uses plpgsql Postgres", () => {
    expect(
      detectDialect("db/002.sql", "CREATE FUNCTION f() AS $$ BEGIN END $$ LANGUAGE plpgsql;"),
    ).toBe("postgres");
  });

  it("recognises the other forms only Postgres has", () => {
    for (const text of [
      "CREATE TRIGGER t BEFORE UPDATE ON x EXECUTE FUNCTION touch();",
      "number bigint DEFAULT nextval('seq')",
      "CREATE TABLE a PARTITION OF b;",
      "SELECT state::invoice_state",
    ]) {
      expect(detectDialect("db/x.sql", text)).toBe("postgres");
    }
  });

  it("leaves a path that already says what it is alone", () => {
    // The text is only asked where the extension is ambiguous.
    expect(detectDialect("a.ts", "LANGUAGE plpgsql")).toBe("typescript");
    expect(detectDialect("a.pgsql", "")).toBe("postgres");
  });
});
