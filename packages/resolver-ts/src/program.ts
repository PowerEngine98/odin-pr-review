import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".yarn",
]);

/**
 * How deep to look for a project's own configuration.
 *
 * `packages/web/app/tsconfig.json` is three from the root, and a monorepo that
 * buries one deeper than this has arranged itself in a way no convention would
 * predict. The walk skips dependencies and build output, so the cost is a few
 * directory reads; the bound is there so a repository with a vast source tree
 * does not pay for a full traversal to answer a question about its top few
 * levels.
 */
const DEPTH = 4;

/**
 * One TypeScript project: the files it owns, and a checker for them.
 *
 * The program is built the first time something in it is asked about. A
 * monorepo has several of these and a review usually touches one or two, so
 * building them all up front would be minutes of compiler work thrown away.
 */
export interface Project {
  /** The directory the configuration lives in, for choosing between projects. */
  readonly dir: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
}

interface Candidate {
  configPath: string;
  dir: string;
  options: ts.CompilerOptions;
  fileNames: string[];
  owns: Set<string>;
  built?: Project;
}

/**
 * Every project inside a checkout, and which one a given file belongs to.
 *
 * A repository is not always a project. In a monorepo the configuration that
 * matters — the `paths` aliases especially — lives in `frontend/common`, not at
 * the root, and a program built from the root without it resolves `@components/…`
 * to nothing at all. What that looks like in a review is a file with no arrows
 * leaving it: not "this file references nothing" but "nobody could tell", and
 * the two are indistinguishable on the page.
 *
 * So the projects are found rather than assumed, and each file is answered by
 * the one that actually compiles it.
 */
export class Projects {
  private readonly candidates: Candidate[];
  private fallback: Project | undefined;

  constructor(private readonly root: string) {
    this.candidates = discover(root);
  }

  /** How many projects were found, for tests and for saying what happened. */
  get size(): number {
    return this.candidates.length;
  }

  /**
   * Whether answering for this file would mean building a program.
   *
   * Asked so the caller can get out of the way first. Building one is a single
   * synchronous call into the compiler that parses the file, everything it
   * imports and every type declaration behind those — a second or more on a
   * project of any size, and not divisible: there is no yielding inside it.
   * What the caller can do is yield immediately before, so that everything
   * already queued — the note saying what is happening, the spinner that goes
   * with it — is delivered rather than sitting behind the block.
   */
  unbuilt(file: string): boolean {
    const chosen = this.pick(file);
    return chosen ? chosen.built === undefined : this.fallback === undefined;
  }

  /**
   * The project that compiles a file, built if this is the first ask.
   *
   * Ownership first, nesting second. A file is claimed by every configuration
   * whose `include` reaches it — `frontend/web` pulls in `../common/src` as well
   * as its own — and the nearest of those is the one whose settings its author
   * had in mind.
   */
  for(file: string): Project | undefined {
    const chosen = this.pick(file);
    if (chosen) return build(chosen);

    // Nothing claims it: a file outside every project, or a checkout with no
    // configuration at all. One program over the whole tree, as before.
    if (!this.fallback) {
      const program = ts.createProgram(listSourceFiles(this.root), {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
        noEmit: true,
        skipLibCheck: true,
      });
      this.fallback = { dir: this.root, program, checker: program.getTypeChecker() };
    }
    return this.fallback;
  }

  /** Which configuration claims a file, before anything is built for it. */
  private pick(file: string): Candidate | undefined {
    const owners = this.candidates.filter((c) => c.owns.has(file));
    const nearest = owners.length > 0
      ? owners
      : this.candidates.filter((c) => file.startsWith(`${c.dir}/`));
    return [...nearest].sort((a, b) => b.dir.length - a.dir.length)[0];
  }
}

function build(candidate: Candidate): Project {
  if (candidate.built) return candidate.built;
  const program = ts.createProgram(candidate.fileNames, {
    ...candidate.options,
    noEmit: true,
    // Missing dependencies in an extracted base checkout must not stop local
    // symbols from resolving.
    noResolve: false,
    skipLibCheck: true,
  });
  candidate.built = { dir: candidate.dir, program, checker: program.getTypeChecker() };
  return candidate.built;
}

/**
 * Every configuration in a checkout that has files of its own.
 *
 * Parsed but not compiled: reading a `tsconfig.json` and expanding its globs is
 * milliseconds, and it is what decides which program a probe should go to. The
 * compiler work waits until something is actually asked.
 */
function discover(root: string): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<string>();

  const take = (configPath: string) => {
    if (seen.has(configPath)) return;
    seen.add(configPath);

    const read = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
    if (read.error) return;
    const dir = dirname(configPath);
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dir,
      undefined,
      configPath,
    );

    /*
     * A solution file is a list of projects, not a project.
     *
     * `{ "files": [], "references": [...] }` is the shape the editor's own
     * templates produce for anything with more than one build, and it compiles
     * nothing itself. Taken at face value it is a project that owns no files,
     * which would send every file under it to the fallback program — the one
     * with no `paths` — which is the fault this is here to fix. Followed
     * instead, to the configurations that do hold the settings.
     */
    if (parsed.fileNames.length === 0) {
      for (const reference of parsed.projectReferences ?? []) {
        const target = reference.path.endsWith(".json")
          ? reference.path
          : join(reference.path, "tsconfig.json");
        if (existsSync(target)) take(target);
      }
      return;
    }

    found.push({
      configPath,
      dir,
      options: parsed.options,
      fileNames: parsed.fileNames,
      owns: new Set(parsed.fileNames),
    });
  };

  const walk = (dir: string, depth: number) => {
    const config = join(dir, "tsconfig.json");
    if (existsSync(config)) take(config);
    if (depth >= DEPTH) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };

  if (existsSync(root)) walk(root, 0);
  return found;
}

function listSourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(full);
      }
    }
  };

  if (existsSync(root)) walk(root);
  return found.sort();
}
