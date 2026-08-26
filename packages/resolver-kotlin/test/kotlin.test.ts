import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildIndex, indexFile, type KotlinIndex } from "../src/index-build.js";
import { findCandidates } from "../src/resolver.js";
import { findCandidates, KotlinResolver } from "../src/resolver.js";
import type { LineProbe } from "@odin/core";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "odin-kt-"));
  dirs.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function emptyIndex(): KotlinIndex {
  return { byName: new Map(), files: new Map() };
}

describe("indexing declarations", () => {
  it("records the declarations a review cares about", () => {
    const index = emptyIndex();
    indexFile(index, "src/Service.kt", [
      "package com.demo",
      "",
      "@Repository",
      "class LaborService(private val dao: LaborDao) {",
      "    fun record(id: UUID) {}",
      "    private val cache = mutableMapOf<String, String>()",
      "}",
      "",
      "interface LaborDao",
      "object Registry",
      "enum class Kind { A, B }",
    ].join("\n"));

    expect([...index.byName.keys()].sort()).toEqual([
      "Kind", "LaborDao", "LaborService", "Registry", "cache", "record",
    ]);
    expect(index.byName.get("record")![0]).toMatchObject({
      kind: "function", line: 5, packageName: "com.demo", owner: "LaborService",
    });
  });

  it("reads the package and imports of a file", () => {
    const index = emptyIndex();
    indexFile(index, "src/A.kt", [
      "package com.demo.a",
      "import com.demo.b.Thing",
      "import com.demo.c.*",
    ].join("\n"));

    expect(index.files.get("src/A.kt")).toEqual({
      path: "src/A.kt",
      packageName: "com.demo.a",
      imports: ["com.demo.b.Thing", "com.demo.c.*"],
    });
  });

  it("ignores build output when walking a tree", () => {
    const root = workspace({
      "src/Real.kt": "package d\nclass Real",
      "build/Generated.kt": "package d\nclass Generated",
    });
    const index = buildIndex(root);
    expect(index.byName.has("Real")).toBe(true);
    expect(index.byName.has("Generated")).toBe(false);
  });
});

describe("finding references on a line", () => {
  it("picks out member and plain calls", () => {
    expect(findCandidates("        myService.function2()").map((c) => c.name))
      .toEqual(["function2"]);
    expect(findCandidates("    val x = compute(a, b)").map((c) => c.name))
      .toEqual(["compute"]);
  });

  it("treats a capitalised call as an instantiation", () => {
    expect(findCandidates("    val d = DeletedFile(this)")[0]).toMatchObject({
      name: "DeletedFile", kind: "instantiation",
    });
  });

  it("reads an import as one reference to a file", () => {
    expect(findCandidates("import com.demo.b.Thing")).toEqual([
      { name: "com.demo.b.Thing", column: 7, kind: "import", label: "import com.demo.b.Thing" },
    ]);
  });

  it("does not mistake control flow for a call", () => {
    expect(findCandidates("        if (rows.isEmpty()) {").map((c) => c.name))
      .toEqual(["isEmpty"]);
    expect(findCandidates("    while (true) {")).toEqual([]);
  });

  it("reports where on the line each reference sits", () => {
    const line = "    dao.save(x)";
    expect(findCandidates(line)[0]!.column).toBe(line.indexOf("save"));
  });
});

describe("KotlinResolver", () => {
  const PROJECT = {
    "src/Service.kt": [
      "package com.demo",
      "",
      "class MyService {",
      "    fun function1() {}",
      "",
      "    fun function2() {}",
      "}",
    ].join("\n"),
    "src/Consumer.kt": [
      "package com.demo",
      "",
      "class Consumer(private val myService: MyService) {",
      "    fun aFunction() {",
      "        myService.function2()",
      "    }",
      "}",
    ].join("\n"),
  };

  const probe = (path: string, line: number): LineProbe => ({
    path, side: "head", line, changeKind: "add",
  });

  it("resolves a call to the file that declares it", async () => {
    const root = workspace(PROJECT);
    const resolver = new KotlinResolver({ roots: { head: root } });
    const [result] = await resolver.resolve([probe("src/Consumer.kt", 5)]);

    expect(result!.targets).toHaveLength(1);
    expect(result!.targets[0]).toMatchObject({
      path: "src/Service.kt",
      line: 6,
      symbolName: "function2",
      symbolKind: "function",
      kind: "call",
      confidence: "heuristic",
      resolver: "kotlin",
      fromSymbolName: "aFunction",
    });
  });

  it("declines when two files declare the same name", async () => {
    // Neither an import nor the package can separate these, so an arrow would
    // be a coin flip. A missing edge is recoverable; a wrong one is not.
    const root = workspace({
      "src/A.kt": "package one\nclass Holder {\n    fun save() {}\n}",
      "src/B.kt": "package two\nclass Other {\n    fun save() {}\n}",
      "src/Caller.kt": "package three\nclass Caller {\n    fun go() {\n        thing.save()\n    }\n}",
    });
    const resolver = new KotlinResolver({ roots: { head: root } });
    expect(await resolver.resolve([probe("src/Caller.kt", 4)])).toEqual([]);
  });

  it("uses an import to choose between same-named declarations", async () => {
    const root = workspace({
      "src/A.kt": "package one\nclass Holder {\n    fun save() {}\n}",
      "src/B.kt": "package two\nclass Other {\n    fun save() {}\n}",
      "src/Caller.kt": [
        "package three",
        "import one.Holder",
        "class Caller {",
        "    fun go() {",
        "        thing.save()",
        "    }",
        "}",
      ].join("\n"),
    });
    const resolver = new KotlinResolver({ roots: { head: root } });
    const [result] = await resolver.resolve([probe("src/Caller.kt", 5)]);
    expect(result!.targets[0]!.path).toBe("src/A.kt");
  });

  it("never points a file at itself", async () => {
    const root = workspace({
      "src/Solo.kt": "package d\nclass Solo {\n    fun helper() {}\n    fun go() {\n        helper()\n    }\n}",
    });
    const resolver = new KotlinResolver({ roots: { head: root } });
    expect(await resolver.resolve([probe("src/Solo.kt", 5)])).toEqual([]);
  });

  it("ignores names the repository does not declare", async () => {
    // `println` is in the standard library, not the project, so it is not an
    // edge in a review of this repository.
    const root = workspace(PROJECT);
    const resolver = new KotlinResolver({ roots: { head: root } });
    const withPrintln = workspace({
      ...PROJECT,
      "src/Log.kt": "package com.demo\nclass Log {\n    fun go() {\n        println(\"hi\")\n    }\n}",
    });
    const other = new KotlinResolver({ roots: { head: withPrintln } });
    expect(await other.resolve([probe("src/Log.kt", 4)])).toEqual([]);
    resolver.dispose();
  });

  it("can be told to leave imports alone", async () => {
    const root = workspace({
      ...PROJECT,
      "src/Importer.kt": "package other\nimport com.demo.MyService\nclass Importer",
    });
    const withImports = new KotlinResolver({ roots: { head: root } });
    expect(await withImports.resolve([probe("src/Importer.kt", 2)])).toHaveLength(1);

    const without = new KotlinResolver({ roots: { head: root }, includeImports: false });
    expect(await without.resolve([probe("src/Importer.kt", 2)])).toEqual([]);
  });

  it("declares the language it covers", () => {
    expect(new KotlinResolver({ roots: { head: "/" } }).languages).toEqual(["kotlin"]);
  });
});

/**
 * A Kotlin class takes its collaborators in its constructor.
 *
 *     class NotificationsProjection(
 *       notificationStatisticsProjection: NotificationStatisticsProjection,
 *     ) : ModelProjection<NotificationsModel> by project(
 *
 * Every name there is a dependency and not one of them is followed by a
 * bracket. Under call-position-only they produced nothing, so two files sat
 * next to each other in the drawing with nothing between them — which is
 * exactly the arrow somebody opens the graph to see.
 */
describe("names written as types", () => {
  const names = (line: string) =>
    findCandidates(line)
      .filter((c) => c.kind === "type")
      .map((c) => c.name);

  it("finds a constructor parameter's type", () => {
    expect(names("    notificationStatisticsProjection: NotificationStatisticsProjection,"))
      .toEqual(["NotificationStatisticsProjection"]);
  });

  it("finds a supertype and its type argument", () => {
    expect(names(") : ModelProjection<NotificationsModel> by project("))
      .toEqual(["ModelProjection", "NotificationsModel"]);
  });

  it("points at the name rather than at the line", () => {
    // The arrow lands on the word. A column of nought would put it on the
    // indentation, which is where nothing is written.
    const line = "  val x: SomeThing = y";
    const found = findCandidates(line).find((c) => c.kind === "type");
    expect(line.slice(found!.column, found!.column + 9)).toBe("SomeThing");
  });

  it("leaves bare identifiers alone", () => {
    // The thing the old rule was protecting against, and still is: an arrow
    // per mention would multiply them by an order of magnitude.
    expect(names("        val laborers = laborerMatchingService")).toEqual([]);
    expect(names("    notificationsRelation,")).toEqual([]);
  });

  it("is not fooled by a member reference", () => {
    // `::` is a reference to a member, not a type annotation.
    expect(names("    val f = Something::create")).toEqual([]);
  });

  it("is not fooled by the elvis operator", () => {
    expect(names("    val n = maybe ?: Fallback")).toEqual([]);
  });

  it("stops at the end of the type rather than running to the end of the line", () => {
    // Everything after the `=` is a value, and a value is not a type.
    expect(names("    private val one: Thing = Other(Another)")).toEqual(["Thing"]);
  });

  it("still finds the calls it always found", () => {
    const found = findCandidates("    val x = service.doThing(SomeService(b))");
    expect(found.map((c) => c.kind)).toContain("call");
    expect(found.map((c) => c.kind)).toContain("instantiation");
    // And has not started calling either of them a type.
    expect(found.map((c) => c.kind)).not.toContain("type");
  });

  it("does not reach past a lambda into its body", () => {
    // `{` ends the type expression. Everything after it is code, and code is
    // read by the rules above rather than by this one.
    expect(names("    fun go(f: Handler) { Other(x) }")).toEqual(["Handler"]);
  });
});
