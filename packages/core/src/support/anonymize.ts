export interface Secrets {
  home?: string;
  repos?: readonly string[];
  names?: readonly string[];
  titles?: readonly string[];
  branches?: readonly string[];
  logins?: readonly string[];
}

const KINDS: [keyof Omit<Secrets, "home">, string, boolean][] = [
  ["repos", "repo", false],
  ["titles", "title", false],
  ["names", "repository", false],
  ["branches", "branch", false],
  ["logins", "user", true],
];

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extensionOf(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 && dot < last.length - 1 && last.length - dot <= 9 ? last.slice(dot) : "";
}

export function anonymize(text: string, secrets: Secrets = {}): string {
  let out = text;

  out = out
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, "<token>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<token>")
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 <token>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");

  for (const [kind, label, word] of KINDS) {
    const terms = [...new Set((secrets[kind] ?? []).map((one) => one.trim()).filter((one) => one.length >= 3))]
      .sort((a, b) => b.length - a.length);
    const numbers = new Map<string, number>();
    for (const term of terms) {
      const pattern = word
        ? new RegExp(`(?<![\\w-])${escaped(term)}(?![\\w-])`, "gi")
        : new RegExp(escaped(term), "g");
      out = out.replace(pattern, () => {
        const key = term.toLowerCase();
        if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
        return `<${label}-${numbers.get(key)}>`;
      });
    }
  }

  out = out.replace(/\b(https?):\/\/([A-Za-z0-9.-]+)(?::\d+)?(\/[^\s)"'>\]]*)?/g, (_all, scheme: string, host: string, path?: string) =>
    path && path !== "/" ? `${scheme}://${host}/<…>` : `${scheme}://${host}`,
  );

  if (secrets.home && secrets.home.length > 1) out = out.split(secrets.home).join("~");

  out = out.replace(
    /(?:~|\/(?:Users|home|private|var|tmp|opt|Volumes|mnt|srv|workspace|root)|(?<![\w])[A-Za-z]:(?=\\|\/(?!\/)))(?:[\\/][^\s:,;)"'`\]]+)+/g,
    (path) => `<path>${extensionOf(path)}`,
  );

  out = out.replace(
    /(?<![\w<>/-])[A-Za-z_@][\w.@-]*(?:\/[\w.@-]+)+/g,
    (path) => {
      const extension = extensionOf(path);
      return extension ? `<file>${extension}` : "<name>";
    },
  );

  out = out.replace(
    /(?<![\w<>.-])[A-Za-z_][\w-]*(?:\.[\w-]+)*\.(kts?|tsx?|jsx?|mjs|cjs|java|py|go|rs|rb|sql|json|ya?ml|md|swift|cpp|cs|php|scala|sh|css|scss|html|svelte|vue|toml|gradle|xml|properties|lock|txt|log)\b/g,
    (_name, extension: string) => `<file>.${extension}`,
  );

  out = out.replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, "<sha>");

  return out;
}
