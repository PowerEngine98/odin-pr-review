import { describe, expect, it } from "vitest";
import type { FileNode } from "@odin/core";

import { indexFile, type SymbolIndex } from "../src/index-build.js";
import { jooqReferences } from "../src/jooq.js";
import { POSTGRES } from "../src/sql.js";

function schema(): SymbolIndex {
  const index: SymbolIndex = {
    byName: new Map(),
    files: new Map(),
    byScope: new Map(),
  };
  indexFile(
    index,
    POSTGRES,
    "db/001.sql",
    [
      "CREATE TABLE notification (id uuid);",
      "CREATE TABLE labor (id uuid);",
      "CREATE TYPE labor_notification_type AS ENUM ('labor_match');",
      "CREATE FUNCTION sync_notification_tg() RETURNS trigger AS $$ BEGIN END $$ LANGUAGE plpgsql;",
      "CREATE SCHEMA labura;",
    ].join("\n"),
  );
  return index;
}

/** A Kotlin file with the given changed lines. */
function file(lines: string[], language = "kotlin"): FileNode {
  return {
    id: "n:code",
    path: "src/Projection.kt",
    status: "modified",
    language,
    binary: false,
    stats: { additions: lines.length, deletions: 0 },
    hunks: [
      {
        header: "",
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map((text, i) => ({
          kind: "add" as const,
          text,
          newLine: i + 1,
        })),
      },
    ],
    symbols: [],
  };
}

const withImport = (text: string) =>
  `import com.labura.jooq.generated.Tables\n${text}`;

const found = (lines: string[], text?: string) =>
  jooqReferences([file(lines)], schema(), () => withImport(text ?? lines.join("\n")))
    .map((r) => `${r.object.kind} ${r.object.name}`);

describe("code that reaches the database through generated classes", () => {
  it("maps a table constant to its table", () => {
    expect(found(["        NOTIFICATION.asterisk(),"])).toEqual(["table notification"]);
  });

  it("maps a record to the table it holds a row of", () => {
    expect(found(["    val notification: NotificationRecord,"])).toEqual([
      "table notification",
    ]);
    expect(found(["    val labor: LaborRecord,"])).toEqual(["table labor"]);
  });

  it("maps a generated enum to the type it came from", () => {
    expect(found(["    val type: LaborNotificationType,"])).toEqual([
      "type labor_notification_type",
    ]);
  });

  it("maps a routine to the function it runs, and calls it a call", () => {
    const references = jooqReferences(
      [file(["  ctx.select(SyncNotificationTg())"])],
      schema(),
      () => withImport("import org.jooq.impl.DSL"),
    );
    expect(references.map((r) => `${r.kind} ${r.object.name}`)).toEqual([
      "call sync_notification_tg",
    ]);
  });

  it("leaves the schema's own name alone", () => {
    // Which is usually the product's name, and appears all over the code for
    // reasons that have nothing to do with the database.
    expect(found(["  class LaburaNotification(val id: UUID)"])).toEqual([]);
  });

  it("says nothing about a file that does not use jOOQ", () => {
    const references = jooqReferences(
      [file(["  val notification: NotificationRecord,"])],
      schema(),
      () => "class NotificationRecord",
    );
    expect(references).toEqual([]);
  });

  it("says nothing about a language jOOQ does not generate for", () => {
    const references = jooqReferences(
      [file(["const n: NotificationRecord = x"], "typescript")],
      schema(),
      () => withImport("x"),
    );
    expect(references).toEqual([]);
  });

  it("only reads the lines the change touched", () => {
    const node = file(["  val notification: NotificationRecord,"]);
    node.hunks[0]!.lines.push({
      kind: "ctx",
      text: "  val labor: LaborRecord,",
      oldLine: 2,
      newLine: 2,
    });
    const references = jooqReferences([node], schema(), () => withImport("x"));
    expect(references.map((r) => r.object.name)).toEqual(["notification"]);
  });

  it("keeps a removed line on the base side", () => {
    const node = file([]);
    node.hunks[0]!.lines = [
      { kind: "del", text: "  val labor: LaborRecord,", oldLine: 7 },
    ];
    const references = jooqReferences([node], schema(), () => withImport("x"));
    expect(references[0]).toMatchObject({ side: "base", line: 7 });
  });
});
