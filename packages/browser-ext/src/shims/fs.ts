import { join, normalize } from "./path.js";
import { isDirectory, isFile, list, read } from "../compute/vfs.js";

function missing(path: string): Error {
  const error = new Error(`ENOENT: no such file or directory, '${path}'`) as Error & { code: string };
  error.code = "ENOENT";
  return error;
}

class Entry {
  constructor(readonly name: string, private readonly directory: boolean) {}
  isDirectory() {
    return this.directory;
  }
  isFile() {
    return !this.directory;
  }
  isSymbolicLink() {
    return false;
  }
}

export function existsSync(path: string): boolean {
  return isFile(path) || isDirectory(path);
}

export function readFileSync(path: string): string {
  const text = read(path);
  if (text === undefined) throw missing(path);
  return text;
}

export function readdirSync(path: string, options?: { withFileTypes?: boolean }): (string | Entry)[] {
  if (!isDirectory(path)) throw missing(path);
  const names = list(path);
  if (!options?.withFileTypes) return names;
  return names.map((name) => new Entry(name, isDirectory(join(path, name))));
}

export function statSync(path: string) {
  if (!existsSync(path)) throw missing(path);
  const directory = isDirectory(path);
  return {
    isDirectory: () => directory,
    isFile: () => !directory,
    isSymbolicLink: () => false,
    size: directory ? 0 : (read(path)?.length ?? 0),
    mtime: new Date(0),
  };
}

export const lstatSync = statSync;

export function realpathSync(path: string): string {
  return normalize(path);
}
realpathSync.native = realpathSync;

function unavailable(name: string) {
  return () => {
    throw new Error(`odin: ${name} is not available in the browser`);
  };
}

export const mkdtempSync = unavailable("mkdtempSync");
export const rmSync = unavailable("rmSync");
export const symlinkSync = unavailable("symlinkSync");
export const writeFileSync = unavailable("writeFileSync");
export const mkdirSync = unavailable("mkdirSync");

export async function readFile(path: string): Promise<string> {
  return readFileSync(path);
}

export const promises = { readFile };

export default {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  readFile,
  promises,
};
