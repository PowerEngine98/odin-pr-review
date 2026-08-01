import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".yarn",
]);

/**
 * Builds a type-checked program for a checkout.
 *
 * Prefers the project's own `tsconfig.json` so that path aliases, JSX settings
 * and lib choices match what the author actually compiles with; a resolver that
 * disagrees with the build produces confidently wrong arrows. Falls back to
 * scanning for source files when there is no config, which is the common case
 * for a base checkout extracted from an old commit.
 */
export function createProgram(root: string): ts.Program {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists.bind(ts.sys));

  if (configPath && configPath.startsWith(root)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        root,
        undefined,
        configPath,
      );
      const fileNames = parsed.fileNames.length
        ? parsed.fileNames
        : listSourceFiles(root);
      return ts.createProgram(fileNames, {
        ...parsed.options,
        noEmit: true,
        // Missing dependencies in an extracted base checkout must not stop
        // local symbols from resolving.
        noResolve: false,
        skipLibCheck: true,
      });
    }
  }

  return ts.createProgram(listSourceFiles(root), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    skipLibCheck: true,
  });
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
