import type { Candidate, Declaration, Dialect, FileFacts } from "./types.js";

/**
 * What a reference means in SQL.
 *
 * A schema is not a program: there are no modules, no imports and no call
 * graph in the usual sense. What there is, and what a reviewer follows, is a
 * name — the migration that adds a foreign key points at the migration that
 * created the table it points to, and the view that selects from it points
 * there too. So the index is by name, which in a database is very nearly unique
 * by construction: two tables cannot share one inside a schema.
 *
 * The unit of a change is a file, usually a migration, and its declarations are
 * the objects it creates. Everything else it names is a reference.
 */

/** `"quoted"`, `schema.name`, or a bare identifier — reduced to the leaf. */
function leaf(raw: string): string {
  const parts = raw.split(".");
  const last = parts[parts.length - 1] ?? raw;
  return last.replace(/^"(.*)"$/, "$1");
}

/** The schema an identifier was written with, when it was written with one. */
function schemaOf(raw: string): string | undefined {
  const parts = raw.split(".");
  return parts.length > 1 ? parts[0]!.replace(/^"(.*)"$/, "$1") : undefined;
}

const NAME = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))*`;

/**
 * What a file creates.
 *
 * Line-based, like every other dialect here. A statement written across five
 * lines still opens with the word that says what it is, and that is the line
 * carrying the name.
 */
const DECLARATIONS: { re: RegExp; kind: string }[] = [
  {
    re: new RegExp(
      String.raw`^\s*create\s+(?:global\s+|local\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${NAME})`,
      "i",
    ),
    kind: "table",
  },
  {
    re: new RegExp(
      String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+|recursive\s+)?view\s+(?:if\s+not\s+exists\s+)?(${NAME})`,
      "i",
    ),
    kind: "view",
  },
  {
    re: new RegExp(
      String.raw`^\s*create\s+(?:or\s+replace\s+)?function\s+(${NAME})`,
      "i",
    ),
    kind: "function",
  },
  {
    re: new RegExp(
      String.raw`^\s*create\s+(?:or\s+replace\s+)?procedure\s+(${NAME})`,
      "i",
    ),
    kind: "procedure",
  },
  {
    re: new RegExp(
      String.raw`^\s*create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(${NAME})`,
      "i",
    ),
    kind: "index",
  },
  {
    re: new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?trigger\s+(${NAME})`, "i"),
    kind: "trigger",
  },
  {
    re: new RegExp(
      String.raw`^\s*create\s+sequence\s+(?:if\s+not\s+exists\s+)?(${NAME})`,
      "i",
    ),
    kind: "sequence",
  },
  { re: new RegExp(String.raw`^\s*create\s+type\s+(${NAME})`, "i"), kind: "type" },
  { re: new RegExp(String.raw`^\s*create\s+domain\s+(${NAME})`, "i"), kind: "domain" },
  {
    re: new RegExp(
      String.raw`^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?(${NAME})`,
      "i",
    ),
    kind: "schema",
  },
];

/** Where a statement names something that lives somewhere else. */
const REFERENCES: { re: RegExp; kind: Candidate["kind"] }[] = [
  // The shapes that name a table: what is being read, written, altered, or
  // pointed at by a key.
  { re: new RegExp(String.raw`\b(?:from|join)\s+(?:only\s+)?(${NAME})`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\binsert\s+into\s+(${NAME})`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\bupdate\s+(?:only\s+)?(${NAME})`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\breferences\s+(${NAME})`, "gi"), kind: "type" },
  {
    re: new RegExp(
      String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${NAME})`,
      "gi",
    ),
    kind: "type",
  },
  { re: new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(${NAME})`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\btruncate\s+(?:table\s+)?(${NAME})`, "gi"), kind: "type" },
  // `CREATE INDEX … ON t`, `CREATE TRIGGER … ON t`, `GRANT … ON t`.
  { re: new RegExp(String.raw`\bon\s+(?:table\s+)?(${NAME})\s*(?:\(|using\b|for\b|to\b|$)`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\bcall\s+(${NAME})\s*\(`, "gi"), kind: "call" },
];

/** Words that appear where a name would and are not one. */
const KEYWORDS = new Set([
  "select", "where", "values", "set", "and", "or", "not", "null", "true",
  "false", "case", "when", "then", "else", "end", "as", "on", "using", "with",
  "order", "group", "by", "having", "limit", "offset", "union", "all", "any",
  "exists", "in", "is", "like", "between", "distinct", "into", "returning",
  "table", "only", "if", "cascade", "restrict", "constraint", "primary", "key",
  "foreign", "unique", "check", "default", "references", "index", "concurrently",
  "count", "sum", "avg", "min", "max", "coalesce", "nullif", "greatest",
  "least", "now", "current_timestamp", "current_date", "cast", "extract",
  "lower", "upper", "trim", "length", "substring", "replace", "round",
  "to_char", "to_date", "to_timestamp", "array", "unnest", "generate_series",
]);

function read(
  path: string,
  text: string,
  extra: { re: RegExp; kind: string }[],
): { facts: FileFacts; declarations: Declaration[] } {
  const lines = text.split("\n");

  // The schema everything in this file belongs to, which is what stands in for
  // a module: `public` unless the file says otherwise.
  let scope = "public";
  const search = /^\s*set\s+search_path\s+(?:to|=)\s+([^;]+)/i.exec(text);
  const created = new RegExp(String.raw`^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?(${NAME})`, "im")
    .exec(text);
  if (search) scope = leaf(search[1]!.split(",")[0]!.trim());
  else if (created) scope = leaf(created[1]!);

  const facts: FileFacts = { path, scope, named: {}, aliases: {}, modules: [] };
  const declarations: Declaration[] = [];

  lines.forEach((line, i) => {
    for (const { re, kind } of [...DECLARATIONS, ...extra]) {
      const match = re.exec(line);
      if (!match) continue;
      const raw = match[1]!;
      const name = leaf(raw);
      declarations.push({
        name,
        kind,
        path,
        line: i + 1,
        column: Math.max(0, line.indexOf(raw)),
        // An object written `billing.invoices` belongs to `billing` whatever
        // the file's own schema is.
        scope: schemaOf(raw) ?? scope,
      });
      break;
    }
  });

  return { facts, declarations };
}

function candidates(
  line: string,
  patterns: { re: RegExp; kind: Candidate["kind"] }[],
): Candidate[] {
  // Comments name things too, and none of them are references.
  const code = line.replace(/--.*$/, "");
  if (!code.trim()) return [];

  const label = line.trim().slice(0, 120);
  const found: Candidate[] = [];
  const seen = new Set<number>();

  for (const { re, kind } of patterns) {
    // The patterns are shared and global, so each use starts from the top.
    re.lastIndex = 0;
    for (const match of code.matchAll(re)) {
      const raw = match[1]!;
      const name = leaf(raw);
      if (KEYWORDS.has(name.toLowerCase())) continue;
      const column = match.index + match[0].lastIndexOf(raw);
      if (seen.has(column)) continue;
      seen.add(column);

      const candidate: Candidate = { name, column, kind, label };
      // A qualified name says which schema, which is the surest thing a
      // reference in SQL can say about where it points.
      const schema = schemaOf(raw);
      if (schema) candidate.receiver = schema;
      found.push(candidate);
    }
  }

  found.sort((a, b) => a.column - b.column);
  return found;
}

/** The object a line sits inside: the last thing created above it. */
function enclosing(lines: string[], line: number): string | undefined {
  for (let i = Math.min(line - 1, lines.length - 1); i >= 0; i--) {
    for (const { re } of DECLARATIONS) {
      const match = re.exec(lines[i]!);
      if (match) return leaf(match[1]!);
    }
  }
  return undefined;
}

export const SQL: Dialect = {
  id: "sql",
  languages: ["sql"],
  extensions: [".sql"],
  read: (path, text) => read(path, text, []),
  // A name is not a path here: nothing in SQL says which file a table lives in,
  // which is exactly why the index is by name.
  pathsFor: () => [],
  candidates: (line) => candidates(line, REFERENCES),
  enclosing,
};

/**
 * The same, plus the parts of Postgres that are only Postgres.
 *
 * Triggers that name their function, partitions that name their parent,
 * sequences read through `nextval`, casts to a type somebody declared, and
 * materialised views refreshed by name. Each of these is a reference a reviewer
 * would follow and none of them is portable SQL, so they are kept apart rather
 * than folded into the general case.
 */
const POSTGRES_REFERENCES: { re: RegExp; kind: Candidate["kind"] }[] = [
  ...REFERENCES,
  {
    re: new RegExp(String.raw`\bexecute\s+(?:function|procedure)\s+(${NAME})\s*\(`, "gi"),
    kind: "call",
  },
  { re: new RegExp(String.raw`\bperform\s+(${NAME})\s*\(`, "gi"), kind: "call" },
  { re: new RegExp(String.raw`\bnextval\s*\(\s*'([^']+)'`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\bsetval\s*\(\s*'([^']+)'`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\bpartition\s+of\s+(${NAME})`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\binherits\s*\(\s*(${NAME})`, "gi"), kind: "type" },
  {
    re: new RegExp(String.raw`\brefresh\s+materialized\s+view\s+(?:concurrently\s+)?(${NAME})`, "gi"),
    kind: "type",
  },
  { re: new RegExp(String.raw`\bcomment\s+on\s+\w+\s+(${NAME})`, "gi"), kind: "type" },
  { re: new RegExp(String.raw`\breturns\s+setof\s+(${NAME})`, "gi"), kind: "type" },
  // `amount::money`, `id::user_id` — a cast to something the schema declared.
  { re: new RegExp(String.raw`::\s*(${NAME})`, "gi"), kind: "type" },
];

const POSTGRES_DECLARATIONS: { re: RegExp; kind: string }[] = [
  {
    re: new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?aggregate\s+(${NAME})`, "i"),
    kind: "aggregate",
  },
  {
    re: new RegExp(String.raw`^\s*create\s+(?:default\s+)?conversion\s+(${NAME})`, "i"),
    kind: "conversion",
  },
  {
    re: new RegExp(String.raw`^\s*create\s+policy\s+(${NAME})`, "i"),
    kind: "policy",
  },
  {
    re: new RegExp(String.raw`^\s*create\s+extension\s+(?:if\s+not\s+exists\s+)?(${NAME})`, "i"),
    kind: "extension",
  },
];

export const POSTGRES: Dialect = {
  id: "postgres",
  languages: ["postgres"],
  extensions: [".sql", ".pgsql", ".psql"],
  read: (path, text) => read(path, text, POSTGRES_DECLARATIONS),
  pathsFor: () => [],
  candidates: (line) => candidates(line, POSTGRES_REFERENCES),
  enclosing,
};
