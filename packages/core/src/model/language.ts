/**
 * Extension to language id. Ids match VS Code's where one exists, so the
 * extension can hand them straight to the editor for syntax highlighting.
 */
const BY_EXTENSION: Record<string, string> = {
  bash: "shellscript",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  clj: "clojure",
  cljc: "clojure",
  cljs: "clojure",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  dart: "dart",
  edn: "clojure",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  gradle: "groovy",
  groovy: "groovy",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "javascriptreact",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  pgsql: "postgres",
  php: "php",
  proto: "proto",
  psql: "postgres",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescriptreact",
  vue: "vue",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
};

/** Filenames that carry no extension but still have an obvious language. */
const BY_BASENAME: Record<string, string> = {
  ".gitignore": "ignore",
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

/**
 * Postgres, written in a file that only says `.sql`.
 *
 * Nearly every Postgres project names its migrations `.sql`, so the extension
 * cannot tell the dialects apart — and the difference matters, because a
 * trigger naming its function and a column reading a sequence are references a
 * reviewer follows, and neither is portable SQL.
 *
 * So the text is asked instead. These are forms that no other dialect has, and
 * one of them is enough: nobody writes `$$ … $$ LANGUAGE plpgsql` by accident.
 */
const POSTGRES_MARKERS =
  /\blanguage\s+(?:'|")?plpgsql|\bexecute\s+(?:function|procedure)\b|\bnextval\s*\(|\breturns\s+setof\b|\bcreate\s+extension\b|\bpartition\s+of\b|::\s*[A-Za-z_]/i;

/**
 * The language of a file, refined by what is written in it.
 *
 * Only where the path is genuinely ambiguous: a `.sql` file is SQL until it
 * uses something only Postgres has.
 */
export function detectDialect(path: string, text: string): string {
  const language = detectLanguage(path);
  if (language !== "sql") return language;
  return POSTGRES_MARKERS.test(text) ? "postgres" : "sql";
}

export function detectLanguage(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const known = BY_BASENAME[base];
  if (known) return known;

  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  return BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? "plaintext";
}
