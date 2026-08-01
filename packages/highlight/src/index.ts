import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
  type ThemeRegistrationRaw,
} from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

/**
 * Syntax colouring for the code inside the cards.
 *
 * Not written here. Shiki carries VS Code's own TextMate grammars and themes,
 * so a Kotlin file in a card is coloured by the same rules that colour it in
 * the editor next to it — which is the point, since the two are meant to be the
 * same picture. Writing a highlighter by hand would mean maintaining a bad
 * imitation of that for every language anyone reviews.
 *
 * Colouring happens where the page is built, never in the browser: the document
 * stays one self-contained file with no runtime, and the same input keeps
 * producing the same bytes.
 */
export interface Token {
  text: string;
  /** Hex colour from the theme, absent where the theme says nothing. */
  color?: string;
  /** 1 italic, 2 bold, 4 underline — Shiki's bit flags, passed through. */
  fontStyle?: number;
}

export interface Highlighter {
  supports(language: string): boolean;
  /**
   * Colours a block of code, returning one array of tokens per line.
   *
   * Takes a block rather than a line because a line is not enough to know what
   * it is: the middle of a block comment and a line of code look identical on
   * their own. Callers should pass the largest run of genuinely adjacent lines
   * they have.
   */
  tokenize(language: string, code: string): Token[][];
  /** Languages that were asked for and have no grammar here. */
  readonly missing: readonly string[];
}

/**
 * VS Code's language ids, which is what the graph carries, to Shiki's.
 *
 * Only what is listed here can be coloured. The list is a deliberate one: every
 * grammar is bundled into the extension, and shipping two hundred of them to
 * colour the six languages a team actually writes is a poor trade. Adding one
 * is a line here and a line below.
 */
const SHIKI_ID: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  css: "css",
  dockerfile: "docker",
  go: "go",
  groovy: "groovy",
  html: "html",
  java: "java",
  javascript: "javascript",
  javascriptreact: "jsx",
  json: "json",
  jsonc: "jsonc",
  kotlin: "kotlin",
  lua: "lua",
  markdown: "markdown",
  php: "php",
  python: "python",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  scss: "scss",
  shellscript: "shellscript",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  typescript: "typescript",
  typescriptreact: "tsx",
  xml: "xml",
  yaml: "yaml",
};

/**
 * Loaded on demand and by name, so a bundler can see every grammar that might
 * be needed and include exactly those. A template literal here would defeat
 * that and leave the extension unable to find any of them at runtime.
 */
const GRAMMARS: Record<string, () => Promise<LanguageInput>> = {
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  docker: () => import("@shikijs/langs/docker"),
  go: () => import("@shikijs/langs/go"),
  groovy: () => import("@shikijs/langs/groovy"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  lua: () => import("@shikijs/langs/lua"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

/** What a reviewer would call the language, for saying it is not covered. */
export function languageLabel(language: string): string {
  return LABELS[language] ?? language;
}

const LABELS: Record<string, string> = {
  javascriptreact: "jsx",
  typescriptreact: "tsx",
  shellscript: "shell",
  plaintext: "plain text",
};

/**
 * Builds a highlighter for exactly the languages a change contains.
 *
 * Loading every grammar takes a second and a great deal of memory; loading the
 * three in front of the reviewer takes neither. Languages with no grammar are
 * not an error — the code still shows, uncoloured — but they are reported, so
 * the page can say which ones rather than leaving the reviewer wondering why
 * one card is grey.
 */
export async function loadHighlighter(
  languages: Iterable<string>,
  options: {
    dark?: boolean;
    /**
     * The reviewer's own theme, as a VS Code theme file.
     *
     * Given one, the code in a card is coloured by the same rules colouring it
     * in the editor beside it — which is the whole claim this package makes.
     * Without one it falls back to VS Code's default, a close relative of most
     * themes and far better than no colour.
     */
    theme?: Record<string, unknown>;
  } = {},
): Promise<Highlighter> {
  const wanted = new Set<string>();
  const missing: string[] = [];

  for (const language of new Set(languages)) {
    if (language === "plaintext") continue;
    const id = SHIKI_ID[language];
    if (id && GRAMMARS[id]) wanted.add(id);
    else if (!missing.includes(language)) missing.push(language);
  }
  missing.sort();

  const supplied = options.theme && Array.isArray(options.theme.tokenColors)
    ? (options.theme as unknown as ThemeRegistrationRaw)
    : undefined;

  const fallback = options.dark === false ? "light-plus" : "dark-plus";
  const themeName = supplied
    ? String((supplied as { name?: string }).name || "editor")
    : fallback;
  const theme = supplied
    ? { ...supplied, name: themeName }
    : options.dark === false
      ? await import("@shikijs/themes/light-plus")
      : await import("@shikijs/themes/dark-plus");

  let core: HighlighterCore | undefined;
  if (wanted.size > 0) {
    core = await createHighlighterCore({
      langs: await Promise.all([...wanted].sort().map((id) => GRAMMARS[id]!())),
      themes: [theme],
      // The JavaScript engine rather than the WebAssembly one: it is a tenth
      // of the size, needs no binary loaded at runtime, and an editor
      // extension is not the place to ship a WASM blob for colouring text.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }

  const loaded = wanted;

  return {
    missing,
    supports(language: string): boolean {
      const id = SHIKI_ID[language];
      return Boolean(core && id && loaded.has(id));
    },
    tokenize(language: string, code: string): Token[][] {
      const id = SHIKI_ID[language];
      if (!core || !id || !loaded.has(id)) return plain(code);

      try {
        const result = core.codeToTokens(code, { lang: id, theme: themeName });
        return result.tokens.map((line) =>
          line.map((token) => ({
            text: token.content,
            ...(token.color ? { color: token.color } : {}),
            ...(token.fontStyle ? { fontStyle: token.fontStyle } : {}),
          })),
        );
      } catch {
        // A grammar that trips over something is not a reason to lose the code.
        return plain(code);
      }
    },
  };
}

function plain(code: string): Token[][] {
  return code.split("\n").map((line) => [{ text: line }]);
}
