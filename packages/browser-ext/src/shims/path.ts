export const sep = "/";
export const delimiter = ":";

export function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  if (absolute) return `/${joined}`;
  return joined || ".";
}

export function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== "").join("/"));
}

export function resolve(...parts: string[]): string {
  let resolved = "";
  for (let i = parts.length - 1; i >= 0 && !resolved.startsWith("/"); i--) {
    const part = parts[i];
    if (part) resolved = resolved ? `${part}/${resolved}` : part;
  }
  return normalize(resolved.startsWith("/") ? resolved : `/${resolved}`);
}

export function dirname(path: string): string {
  const normal = normalize(path);
  const at = normal.lastIndexOf("/");
  if (at < 0) return ".";
  if (at === 0) return "/";
  return normal.slice(0, at);
}

export function basename(path: string, ext = ""): string {
  const base = normalize(path).split("/").pop() ?? "";
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(path: string): string {
  const base = basename(path);
  const at = base.lastIndexOf(".");
  return at <= 0 ? "" : base.slice(at);
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split("/").filter(Boolean);
  const b = resolve(to).split("/").filter(Boolean);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return [...a.slice(shared).map(() => ".."), ...b.slice(shared)].join("/");
}

export const posix = { sep, delimiter, normalize, isAbsolute, join, resolve, dirname, basename, extname, relative };
export default posix;
