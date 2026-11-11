import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const HANDOFF = "odin.handoff";
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
