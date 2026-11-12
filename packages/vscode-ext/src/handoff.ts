import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HANDOFF_FILE = "handoff.json";
export const HANDOFF_MS = 120_000;

export interface Handoff {
  path: string;
  number: number;
  live: boolean;
  at: number;
}

function sameFolder(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function handoffFor(held: unknown, folders: readonly string[], now: number): Handoff | undefined {
  if (!held || typeof held !== "object") return undefined;
  const { path, number, live, at } = held as Partial<Handoff>;
  if (typeof path !== "string" || typeof number !== "number" || typeof at !== "number") return undefined;
  if (now - at < 0 || now - at > HANDOFF_MS) return undefined;
  const wanted = sameFolder(path);
  if (!folders.some((folder) => sameFolder(folder) === wanted)) return undefined;
  return { path, number, live: live === true, at };
}

export function leaveHandoff(dir: string, handoff: Handoff): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, HANDOFF_FILE), JSON.stringify(handoff));
}

export function claimHandoff(dir: string, folders: readonly string[], now: number): Handoff | undefined {
  const file = join(dir, HANDOFF_FILE);
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  const handoff = handoffFor(held, folders, now);
  if (!handoff) return undefined;
  const claimed = `${file}.${process.pid}.${now}`;
  try {
    renameSync(file, claimed);
  } catch {
    return undefined;
  }
  try {
    unlinkSync(claimed);
  } catch {
    return handoff;
  }
  return handoff;
}
