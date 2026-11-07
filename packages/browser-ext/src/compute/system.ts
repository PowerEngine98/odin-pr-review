import ts from "typescript";

import { join, normalize } from "../shims/path.js";
import { isDirectory, isFile, list, read } from "./vfs.js";

function walk(dir: string, depth: number | undefined, found: string[]) {
  for (const name of list(dir)) {
    const path = join(dir, name);
    if (isDirectory(path)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      if (depth === undefined || depth > 0) walk(path, depth === undefined ? undefined : depth - 1, found);
    } else {
      found.push(path);
    }
  }
}

export function installSystem() {
  const system: ts.System = {
    args: [],
    newLine: "\n",
    useCaseSensitiveFileNames: true,
    write: () => {},
    writeOutputIsTTY: () => false,
    readFile: (path) => read(path),
    writeFile: () => {},
    resolvePath: (path) => normalize(path),
    fileExists: (path) => isFile(path),
    directoryExists: (path) => isDirectory(path),
    createDirectory: () => {},
    getExecutingFilePath: () => "/__typescript__/lib/typescript.js",
    getCurrentDirectory: () => "/",
    getDirectories: (path) => list(path).filter((name) => isDirectory(join(path, name))),
    readDirectory: (path, extensions, _excludes, _includes, depth) => {
      const found: string[] = [];
      if (isDirectory(path)) walk(normalize(path), depth, found);
      if (!extensions || extensions.length === 0) return found;
      return found.filter((file) => extensions.some((ext) => file.endsWith(ext)));
    },
    exit: () => {},
    realpath: (path) => normalize(path),
  };
  Object.assign(system, { getEnvironmentVariable: () => "" });
  (ts as unknown as { setSys(system: ts.System): void }).setSys(system);
}
