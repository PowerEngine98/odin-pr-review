/**
 * Extension to language id. Ids match VS Code's where one exists, so the
 * extension can hand them straight to the editor for syntax highlighting.
 */
const BY_EXTENSION: Record<string, string> = {
  bash: "shellscript",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  dart: "dart",
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
  php: "php",
  proto: "proto",
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

export function detectLanguage(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const known = BY_BASENAME[base];
  if (known) return known;

  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  return BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? "plaintext";
}
