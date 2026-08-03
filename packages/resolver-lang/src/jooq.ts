import type { DiffLine, FileNode } from "@odin/core";

import type { SymbolIndex } from "./index-build.js";
import type { Declaration } from "./types.js";

/**
 * Code that talks to the database through generated classes.
 *
 * jOOQ generates a Java or Kotlin name for every object in the schema, and the
 * generation is mechanical: a table becomes a constant in upper snake and a
 * class in pascal, its rows become `…Record`, an enum type becomes a class of
 * the same name, a function becomes a routine. So the name in the code is the
 * name in the database with the case changed, which makes the link between them
 * something that can be read rather than guessed.
 *
 * That link is worth drawing because it is the one a reviewer cannot see: a
 * migration renames a column and the projection that reads it is in another
 * language, in another directory, under a name that does not match. Following
 * it by eye means knowing the generator's rules by heart.
 */
export interface JooqReference {
  /** The file the reference was written in. */
  node: FileNode;
  line: number;
  side: "base" | "head";
  /** The schema object it names. */
  object: Declaration;
  /** What the code did with it. */
  kind: "type" | "call";
  /** The line, trimmed, for the hover label. */
  label: string;
}

/** Languages jOOQ generates for. */
const GENERATED_FOR = new Set(["kotlin", "java", "scala", "groovy"]);

/**
 * Whether a file is talking to jOOQ at all.
 *
 * Asked of the file rather than assumed of the project: a `NotificationRecord`
 * that has nothing to do with the database is an ordinary class name, and
 * linking it to a table because the repository happens to use jOOQ elsewhere
 * would be a confident lie.
 */
const IMPORTS_JOOQ = /(^|\n)\s*import\s+[\w.]*jooq[\w.]*/i;

/** `LaborNotificationType` and `LABOR_NOTIFICATION` both mean the same table. */
function snake(name: string): string {
  // Already shouted: the generator's own spelling for a table constant.
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return name.toLowerCase();
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Every schema object the changed lines of generated-language files name.
 *
 * Only changed lines, like every other resolver here: a card is a picture of
 * the change, and an arrow from a line nobody touched says nothing about it.
 */
export function jooqReferences(
  nodes: readonly FileNode[],
  index: SymbolIndex,
  read: (path: string) => string | undefined,
): JooqReference[] {
  const found: JooqReference[] = [];

  for (const node of nodes) {
    if (!GENERATED_FOR.has(node.language)) continue;
    const text = read(node.path);
    if (!text || !IMPORTS_JOOQ.test(text)) continue;

    for (const hunk of node.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "ctx") continue;
        const where = position(line);
        if (!where) continue;

        for (const object of objectsNamed(line.text, index)) {
          found.push({
            node,
            line: where.line,
            side: where.side,
            object: object.object,
            kind: object.kind,
            label: line.text.trim().slice(0, 120),
          });
        }
      }
    }
  }

  return found;
}

function position(line: DiffLine): { line: number; side: "base" | "head" } | undefined {
  if (line.kind === "add" && line.newLine !== undefined) {
    return { line: line.newLine, side: "head" };
  }
  if (line.kind === "del" && line.oldLine !== undefined) {
    return { line: line.oldLine, side: "base" };
  }
  return undefined;
}

/**
 * The schema objects one line names, by the generator's own rules.
 *
 * A record is the table it holds a row of, which is why the suffix comes off
 * before the lookup. Everything else keeps its name and changes only case.
 */
function objectsNamed(
  text: string,
  index: SymbolIndex,
): { object: Declaration; kind: "type" | "call" }[] {
  const out: { object: Declaration; kind: "type" | "call" }[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9_]{2,}\b/g)) {
    const word = match[0];
    // Generated names are either shouted or capitalised; a lower-case
    // identifier is a variable, and matching those would link half the file.
    if (!/^[A-Z]/.test(word)) continue;

    const candidates = word.endsWith("Record")
      ? [{ name: snake(word.slice(0, -"Record".length)), only: "table" }, { name: snake(word) }]
      : [{ name: snake(word) }];

    for (const { name, only } of candidates) {
      if (!name || seen.has(name)) continue;
      const declarations = index.byName.get(name);
      if (!declarations || declarations.length !== 1) continue;

      const object = declarations[0]!;
      // A record only ever stands for a table, so a name that resolves to a
      // function is a coincidence rather than a mapping.
      if (only && object.kind !== only) continue;
      // A schema is the card, not a thing inside it — and its name is usually
      // the product's name, which appears all over the code for reasons that
      // have nothing to do with the database.
      if (object.kind === "schema") continue;

      seen.add(name);
      out.push({
        object,
        // Calling a routine is a call; naming a table or a type is not.
        kind: object.kind === "function" || object.kind === "procedure" ? "call" : "type",
      });
    }
  }

  return out;
}
