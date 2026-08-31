import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A picture on its way from the clipboard to an agent.
 *
 * It crosses as a data URI because that is what the page can hold and draw, and
 * becomes a file here because that is what an agent can open: every one of
 * these tools takes a path, and none of them takes a megabyte of base64 on the
 * command line.
 */
export interface Pasted {
  /** Whatever the clipboard called it, which is often nothing useful. */
  name?: string;
  /** `data:image/png;base64,…`, as the page read it. */
  data: string;
}

/** What a picture is written as, by what it says it is. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

/**
 * A data URI taken apart, or nothing at all.
 *
 * Strict on purpose. This decides what gets written to disk from something the
 * page was handed by the operating system's clipboard, and the only shape worth
 * accepting is the one the page produces: an image, base64, and nothing else.
 * Anything else is refused rather than guessed at.
 */
export function decodePasted(data: string): { bytes: Buffer; ext: string } | undefined {
  const match = /^data:([\w.+/-]+);base64,([\s\S]+)$/.exec(data.trim());
  if (!match) return undefined;

  const [, mime = "", body = ""] = match;
  const ext = EXTENSIONS[mime.toLowerCase()];
  if (!ext) return undefined;

  const bytes = Buffer.from(body, "base64");
  // An empty picture is not a picture. Round-tripping catches a body that was
  // truncated on the way here, which base64 decoding itself will not.
  if (bytes.length === 0) return undefined;
  return { bytes, ext };
}

/**
 * Somewhere to keep pictures for as long as a reading lasts.
 *
 * Outside the repository, deliberately: a screenshot pasted into a conversation
 * is not part of the change, and writing one into the working tree would put it
 * in the next diff — of the very branch being reviewed.
 */
export function imageFolder(): string {
  return mkdtempSync(join(tmpdir(), "odin-pasted-"));
}

/**
 * Writes what was pasted, and says where it went.
 *
 * Best effort per picture: one that cannot be decoded is dropped rather than
 * taking the message down with it. A reader who pasted two screenshots and got
 * one through is better served than one whose question never arrived.
 */
export function keepPasted(images: readonly Pasted[], folder: string): string[] {
  const kept: string[] = [];
  for (const [at, image] of images.entries()) {
    const decoded = decodePasted(image.data);
    if (!decoded) continue;
    const name = `pasted-${Date.now()}-${at + 1}.${decoded.ext}`;
    const path = join(folder, name);
    try {
      writeFileSync(path, decoded.bytes);
      kept.push(path);
    } catch {
      // A picture that will not write is a picture the agent does not get. The
      // message it came with still goes.
    }
  }
  return kept;
}

/**
 * The message as the agent will read it, with the pictures named in it.
 *
 * Markdown rather than a bare list of paths, because that is what these tools
 * are written to read and what the thread will draw. The paths are absolute:
 * an agent runs with its own working directory and a relative one would point
 * at whatever happened to be there.
 */
export function withImages(body: string, paths: readonly string[]): string {
  if (paths.length === 0) return body;
  const shown = paths.map((path) => `![pasted image](${path})`).join("\n");
  return body ? `${body}\n\n${shown}` : shown;
}
