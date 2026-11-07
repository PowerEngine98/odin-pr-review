import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Known {
  paths: string[];
  chosen?: string;
}

export function githubRepositories(remotes: string): string[] {
  const found = new Set<string>();
  for (const line of remotes.split("\n")) {
    const url = line.trim().split(/\s+/)[1] ?? "";
    const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
    if (match) found.add(`${match[1]}/${match[2]}`.toLowerCase());
  }
  return [...found];
}

export class Repositories {
  constructor(private readonly file: string) {}

  private read(): Record<string, Known> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, Known>;
    } catch {
      return {};
    }
  }

  private write(all: Record<string, Known>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  record(name: string, path: string): void {
    const all = this.read();
    const key = name.toLowerCase();
    const known = all[key] ?? { paths: [] };
    if (known.paths.includes(path)) return;
    all[key] = { ...known, paths: [...known.paths, path] };
    this.write(all);
  }

  choose(name: string, path: string): void {
    const all = this.read();
    const key = name.toLowerCase();
    const known = all[key] ?? { paths: [] };
    all[key] = { paths: known.paths.includes(path) ? known.paths : [...known.paths, path], chosen: path };
    this.write(all);
  }

  forget(name: string, path: string): void {
    const all = this.read();
    const key = name.toLowerCase();
    const known = all[key];
    if (!known) return;
    const paths = known.paths.filter((p) => p !== path);
    all[key] = { paths, ...(known.chosen && known.chosen !== path ? { chosen: known.chosen } : {}) };
    this.write(all);
  }

  async candidates(name: string, still: (path: string) => Promise<boolean>): Promise<Known> {
    const known = this.read()[name.toLowerCase()] ?? { paths: [] };
    const paths: string[] = [];
    for (const path of known.paths) {
      if (existsSync(path) && (await still(path))) paths.push(path);
      else this.forget(name, path);
    }
    return { paths, ...(known.chosen && paths.includes(known.chosen) ? { chosen: known.chosen } : {}) };
  }
}
