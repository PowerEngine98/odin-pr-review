export const USAGE = `odin - build a change graph from a pull request diff

Usage:
  odin graph [options]

Options:
  -b, --base <ref>      base branch the PR targets            (default: main)
  -H, --head <ref>      branch under review                   (default: HEAD)
  -C, --cwd <dir>       repository directory                  (default: .)
  -p, --patch <file>    read a .patch file instead of a repo
  -o, --out <file>      write output here                     (default: stdout)
  -f, --format <fmt>    json | html | svg | mermaid | dot | summary
      --light           render html/svg on a light background
  -U, --context <n>     diff context lines                    (default: 3)
  -r, --resolve         resolve call-site references into edges
      --no-imports      with --resolve, skip import statements
      --with-context    with --resolve, probe unchanged lines too
      --summary         shorthand for --format summary
      --stamp           record generation time (breaks reproducible output)
      --strict          exit non-zero when validation reports an issue
  -h, --help            show this message

Everything after -- is treated as git pathspecs.`;

export const OUTPUT_FORMATS = [
  "json", "html", "svg", "mermaid", "dot", "summary",
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface GraphOptions {
  kind: "graph";
  cwd: string;
  baseRef: string;
  headRef: string;
  patchFile?: string;
  out?: string;
  context: number;
  pathspecs: string[];
  format: OutputFormat;
  stamp: boolean;
  strict: boolean;
  resolve: boolean;
  imports: boolean;
  withContext: boolean;
  light: boolean;
}

export type ParseResult =
  | GraphOptions
  | { kind: "help" }
  | { kind: "error"; message: string };

export function parseArgs(argv: string[]): ParseResult {
  const opts: GraphOptions = {
    kind: "graph",
    cwd: process.cwd(),
    baseRef: "main",
    headRef: "HEAD",
    context: 3,
    pathspecs: [],
    format: "json",
    stamp: false,
    strict: false,
    resolve: false,
    imports: true,
    withContext: false,
    light: false,
  };

  let i = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    if (argv[0] !== "graph") {
      return { kind: "error", message: `unknown command '${argv[0]}'` };
    }
    i = 1;
  }

  const need = (flag: string): string | undefined => argv[++i];

  for (; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      opts.pathspecs.push(...argv.slice(i + 1));
      break;
    }

    switch (arg) {
      case "-h": case "--help": return { kind: "help" };
      case "--summary": opts.format = "summary"; continue;
      case "--stamp": opts.stamp = true; continue;
      case "--strict": opts.strict = true; continue;
      case "-r": case "--resolve": opts.resolve = true; continue;
      case "--no-imports": opts.imports = false; continue;
      case "--with-context": opts.withContext = true; continue;
      case "--light": opts.light = true; continue;
    }

    const value = need(arg);
    if (value === undefined) {
      return { kind: "error", message: `${arg} requires a value` };
    }

    switch (arg) {
      case "-b": case "--base": opts.baseRef = value; break;
      case "-H": case "--head": opts.headRef = value; break;
      case "-C": case "--cwd": opts.cwd = value; break;
      case "-p": case "--patch": opts.patchFile = value; break;
      case "-o": case "--out": opts.out = value; break;
      case "-f": case "--format": {
        if (!(OUTPUT_FORMATS as readonly string[]).includes(value)) {
          return {
            kind: "error",
            message: `unknown format '${value}', expected one of ${OUTPUT_FORMATS.join(", ")}`,
          };
        }
        opts.format = value as OutputFormat;
        break;
      }
      case "-U": case "--context": {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n < 0) {
          return { kind: "error", message: `--context expects a non-negative integer, got '${value}'` };
        }
        opts.context = n;
        break;
      }
      default:
        return { kind: "error", message: `unknown option '${arg}'` };
    }
  }

  return opts;
}
