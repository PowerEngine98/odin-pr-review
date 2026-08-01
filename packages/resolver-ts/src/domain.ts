import { relative, isAbsolute, sep } from "node:path";

export interface DomainFilterOptions {
  /** Directory that defines "inside the project". */
  root: string;
  /**
   * Path segments that mark a file as somebody else's code. A reference into
   * any of these is dropped, because a review graph should show how the change
   * moves through the codebase under review, not through its dependencies.
   */
  excludeSegments?: string[];
}

const DEFAULT_EXCLUDES = [
  "node_modules",
  "bower_components",
  "vendor",
  "third_party",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".yarn",
  ".pnpm",
];

/**
 * Decides whether a resolved definition belongs to the project.
 *
 * Two rejections matter most. Declaration files are excluded because a
 * definition landing in a `.d.ts` means the real implementation is in a
 * dependency; keeping it would draw an arrow to a type stub. Paths outside the
 * root are excluded because TypeScript happily resolves into the global type
 * library and into linked packages elsewhere on disk.
 */
export class DomainFilter {
  private readonly root: string;
  private readonly excluded: Set<string>;

  constructor(options: DomainFilterOptions) {
    this.root = options.root;
    this.excluded = new Set(options.excludeSegments ?? DEFAULT_EXCLUDES);
  }

  /** Returns the repository-relative path, or undefined if out of scope. */
  toDomainPath(absolutePath: string): string | undefined {
    if (!isAbsolute(absolutePath)) return undefined;
    if (absolutePath.endsWith(".d.ts") || absolutePath.endsWith(".d.mts")) {
      return undefined;
    }

    const rel = relative(this.root, absolutePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;

    const segments = rel.split(sep);
    if (segments.some((s) => this.excluded.has(s))) return undefined;

    return segments.join("/");
  }
}
