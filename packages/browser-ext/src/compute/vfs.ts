import { dirname, normalize } from "../shims/path.js";

const files = new Map<string, string>();
const children = new Map<string, Set<string>>();

function addDirectory(path: string) {
  if (children.has(path)) return;
  children.set(path, new Set());
  if (path === "/") return;
  const parent = dirname(path);
  addDirectory(parent);
  children.get(parent)!.add(path.slice(path.lastIndexOf("/") + 1));
}

export function writeFile(path: string, text: string) {
  const file = normalize(path);
  const parent = dirname(file);
  addDirectory(parent);
  children.get(parent)!.add(file.slice(file.lastIndexOf("/") + 1));
  files.set(file, text);
}

export function forget(prefix: string) {
  const root = normalize(prefix);
  for (const path of [...files.keys()]) if (path === root || path.startsWith(`${root}/`)) files.delete(path);
  for (const path of [...children.keys()]) if (path === root || path.startsWith(`${root}/`)) children.delete(path);
  children.get(dirname(root))?.delete(root.slice(root.lastIndexOf("/") + 1));
}

export function isFile(path: string): boolean {
  return files.has(normalize(path));
}

export function isDirectory(path: string): boolean {
  return children.has(normalize(path));
}

export function read(path: string): string | undefined {
  return files.get(normalize(path));
}

export function list(path: string): string[] {
  return [...(children.get(normalize(path)) ?? [])].sort();
}

export function mounted(prefix: string): boolean {
  return children.has(normalize(prefix));
}
