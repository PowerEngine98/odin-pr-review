export const USAGE = `odin - build a change graph from a pull request diff

Usage:
  odin view [options]                 render the graph and print a local url
  odin graph [options]                write the graph to stdout in any format
  odin comments [options]             list the review comments on the pull request
  odin review --event <e> [options]   send a review
  odin update [--dry-run]             pull the latest main and reinstall
  odin approve [options]              shorthand for --event approve
  odin request-changes [options]      shorthand for --event request-changes

View renders what the editor shows — references resolved, the pull request's
own comments marked against their lines — writes it beside the repository and
prints the url to open. The file name is derived from the branch pair, so the
same review reopens at the same address.

Review options:
      --event <e>       approve | comment | request-changes
      --body <text>     the review's summary (required except to approve)
      --comment <c>     path:line:message, or path:start-end:message
                        repeatable; --side defaults to the head of the change
      --comments <file> a json array of {path,line,startLine?,side?,body}
      --number <n>      pull request number             (default: for this branch)
      --dry-run         print what would be sent, send nothing
  -C, --cwd <dir>       repository directory                  (default: .)

Graph options:
  -b, --base <ref>      base branch the PR targets   (default: detect)
  -H, --head <ref>      branch under review                   (default: HEAD)
  -C, --cwd <dir>       repository directory                  (default: .)
  -p, --patch <file>    read a .patch file instead of a repo
  -o, --out <file>      write output here                     (default: stdout)
  -f, --format <fmt>    json | html | svg | mermaid | dot | summary
      --light           render html/svg on a light background
  -U, --context <n>     diff context lines                    (default: 3)
  -r, --resolve         resolve call-site references into edges
      --imports         include import statements and their arrows (implies -r)
      --with-context    probe unchanged lines too (implies -r)
      --tests           include test files (hidden by default)
      --pr              look up the pull request title with the gh CLI
      --summary         shorthand for --format summary
      --stamp           record generation time (breaks reproducible output)
      --strict          exit non-zero when validation reports an issue
      --serve [port]    with view, serve over http instead of printing a file url
  -h, --help            show this message

Everything after -- is treated as git pathspecs.`;

export const OUTPUT_FORMATS = [
  "json", "html", "svg", "mermaid", "dot", "summary",
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface GraphOptions {
  kind: "graph";
  cwd: string;
  baseRef?: string;
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
  tests: boolean;
  pullRequest: boolean;
  light: boolean;
  /**
   * Write the page somewhere durable and print its url instead of streaming it.
   *
   * The difference between `view` and `graph -f html` is who the output is for:
   * a url is for a person or an agent about to look at it, a stream is for
   * something further down a pipe.
   */
  view: boolean;
  /** Serve the page over http on this port; 0 asks the OS for a free one. */
  serve?: number;
}

/** A line comment on its way to the forge. */
export interface CommentArg {
  path: string;
  line: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

export interface CommentsOptions {
  kind: "comments";
  cwd: string;
  number?: number;
  json: boolean;
}

export interface ReviewOptions {
  kind: "review";
  cwd: string;
  number?: number;
  event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  body: string;
  comments: CommentArg[];
  /** A json file holding more of them. Read by the caller, not here. */
  commentsFile?: string;
  dryRun: boolean;
}

/**
 * Bringing this copy of Odin level with what is on main.
 *
 * Its own command rather than a flag on another, because it is the one thing
 * `odin` does to itself rather than to a repository being read.
 */
export interface UpdateOptions {
  kind: "update";
  /** Say what would happen and change nothing. */
  dryRun: boolean;
  /** The branch to follow, for a copy that tracks something other than main. */
  branch?: string;
}

export type ParseResult =
  | GraphOptions
  | CommentsOptions
  | ReviewOptions
  | UpdateOptions
  | { kind: "help" }
  | { kind: "error"; message: string };

const COMMANDS = [
  "graph", "view", "comments", "review", "approve", "request-changes", "update",
] as const;

export function parseArgs(argv: string[]): ParseResult {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "graph";
  if (!(COMMANDS as readonly string[]).includes(command)) {
    return { kind: "error", message: `unknown command '${command}'` };
  }
  const rest = argv[0] && !argv[0].startsWith("-") ? argv.slice(1) : argv;

  if (command === "update") return parseUpdate(rest);
  if (command === "comments") return parseComments(rest);
  if (command === "review" || command === "approve" || command === "request-changes") {
    return parseReview(command, rest);
  }
  return parseGraph(rest, command === "view");
}

/** Updating Odin itself, which takes almost nothing. */
function parseUpdate(argv: string[]): ParseResult {
  const opts: UpdateOptions = { kind: "update", dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "--dry-run") { opts.dryRun = true; continue; }
    if (arg === "--branch") {
      const value = argv[++i];
      if (value === undefined) return { kind: "error", message: "--branch requires a value" };
      opts.branch = value;
      continue;
    }
    return { kind: "error", message: `unknown option '${arg}'` };
  }

  return opts;
}

/** Reading the review comments already on the pull request. */
function parseComments(argv: string[]): ParseResult {
  const opts: CommentsOptions = { kind: "comments", cwd: process.cwd(), json: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "--json") { opts.json = true; continue; }

    const value = argv[++i];
    if (value === undefined) {
      return { kind: "error", message: `${arg} requires a value` };
    }
    if (arg === "-C" || arg === "--cwd") { opts.cwd = value; continue; }
    if (arg === "--number") {
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n <= 0) {
        return { kind: "error", message: `--number expects a pull request number, got '${value}'` };
      }
      opts.number = n;
      continue;
    }
    return { kind: "error", message: `unknown option '${arg}'` };
  }

  return opts;
}

/** Sending one. */
function parseReview(command: string, argv: string[]): ParseResult {
  const opts: ReviewOptions = {
    kind: "review",
    cwd: process.cwd(),
    event: command === "approve"
      ? "APPROVE"
      : command === "request-changes"
        ? "REQUEST_CHANGES"
        : "COMMENT",
    body: "",
    comments: [],
    dryRun: false,
  };
  let eventGiven = command !== "review";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "--dry-run") { opts.dryRun = true; continue; }

    const value = argv[++i];
    if (value === undefined) {
      return { kind: "error", message: `${arg} requires a value` };
    }

    switch (arg) {
      case "-C": case "--cwd": opts.cwd = value; break;
      case "--body": opts.body = value; break;
      case "--comments": opts.commentsFile = value; break;
      case "--number": {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n <= 0) {
          return { kind: "error", message: `--number expects a pull request number, got '${value}'` };
        }
        opts.number = n;
        break;
      }
      case "--event": {
        const event = parseEvent(value);
        if (!event) {
          return {
            kind: "error",
            message: `unknown event '${value}', expected approve, comment or request-changes`,
          };
        }
        opts.event = event;
        eventGiven = true;
        break;
      }
      case "--comment": {
        const comment = parseComment(value);
        if (typeof comment === "string") return { kind: "error", message: comment };
        opts.comments.push(comment);
        break;
      }
      default:
        return { kind: "error", message: `unknown option '${arg}'` };
    }
  }

  if (!eventGiven) {
    return { kind: "error", message: "review needs --event approve, comment or request-changes" };
  }
  // The forge refuses these outright, and finding that out after the round trip
  // costs the caller a confusing error for a knowable mistake.
  if (opts.event !== "APPROVE" && !opts.body) {
    return {
      kind: "error",
      message: `--body is required to ${opts.event === "COMMENT" ? "comment" : "request changes"}`,
    };
  }

  return opts;
}

function parseEvent(value: string): ReviewOptions["event"] | undefined {
  const normal = value.toLowerCase().replace(/_/g, "-");
  if (normal === "approve") return "APPROVE";
  if (normal === "comment") return "COMMENT";
  if (normal === "request-changes") return "REQUEST_CHANGES";
  return undefined;
}

/**
 * `path:line:message`, or `path:start-end:message` for a span.
 *
 * The message is everything after the second colon, so it may contain colons
 * of its own — which prose does, constantly. A path may not, which is the
 * assumption that makes the shorthand safe; anything stranger goes in the json
 * file, where nothing has to be guessed.
 */
export function parseComment(value: string): CommentArg | string {
  const match = /^(.+?):(\d+)(?:-(\d+))?:([\s\S]*)$/.exec(value);
  if (!match) {
    return `--comment expects path:line:message, got '${value}'`;
  }

  const [, path, first, second, body] = match;
  if (!body) return `--comment '${value}' has no message`;

  const start = Number.parseInt(first!, 10);
  const end = second ? Number.parseInt(second, 10) : start;
  if (end < start) {
    return `--comment '${value}' ends before it starts`;
  }

  return {
    path: path!,
    line: end,
    ...(end > start ? { startLine: start } : {}),
    body,
  };
}

function parseGraph(argv: string[], view: boolean): ParseResult {
  const opts: GraphOptions = {
    kind: "graph",
    cwd: process.cwd(),
    headRef: "HEAD",
    context: 3,
    pathspecs: [],
    format: "json",
    stamp: false,
    strict: false,
    resolve: false,
    imports: false,
    withContext: false,
    tests: false,
    pullRequest: false,
    light: false,
    view,
  };

  if (view) {
    // What `view` is for: the picture the editor shows. Resolving references
    // is the whole point of the tool, and a page that has to be asked for them
    // separately is a trap for anyone meeting it for the first time.
    opts.format = "html";
    opts.resolve = true;
    opts.pullRequest = true;
  }

  let i = 0;
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
      case "--imports": opts.imports = true; continue;
      case "--no-imports": opts.imports = false; continue;
      case "--with-context": opts.withContext = true; continue;
      case "--tests": opts.tests = true; continue;
      case "--pr": opts.pullRequest = true; continue;
      case "--no-pr": opts.pullRequest = false; continue;
      case "--light": opts.light = true; continue;
      case "--serve": {
        // The port is optional, so it is only consumed when it looks like one.
        const next = argv[i + 1];
        if (next !== undefined && /^\d+$/.test(next)) {
          opts.serve = Number.parseInt(next, 10);
          i++;
        } else {
          opts.serve = 0;
        }
        continue;
      }
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

  // Both of these ask for something only resolution can produce: an import
  // arrow is an edge, and probing context lines is a resolver's work. Left as
  // rendering hints they were requests the command accepted and then ignored,
  // and the answer to `--imports` was a graph with no arrows in it at all —
  // indistinguishable from a change whose files genuinely reference nothing.
  // A patch file has no repository to resolve against, so there they stay
  // hints rather than becoming an error about a flag nobody typed.
  if ((opts.imports || opts.withContext) && !opts.patchFile) opts.resolve = true;

  return opts;
}
