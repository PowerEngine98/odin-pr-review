export const STAMP_MS = 2000;

export const STAMP = /^\[odin:at ([^\]]+)\]$/;

export function stampLine(at: number): string {
  return `[odin:at ${new Date(at).toISOString()}]`;
}

export function withStamp(before: string, chunk: string, now: number, last: number): { text: string; stamped: boolean } {
  if (now - last < STAMP_MS || !chunk) return { text: chunk, stamped: false };
  if (before === "" || before.endsWith("\n")) return { text: `${stampLine(now)}\n${chunk}`, stamped: true };
  if (chunk.startsWith("\n")) return { text: `\n${stampLine(now)}\n${chunk.slice(1)}`, stamped: true };
  return { text: chunk, stamped: false };
}
