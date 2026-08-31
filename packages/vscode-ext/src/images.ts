import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

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
 * A picture read back for the page to draw, or nothing.
 *
 * A webview cannot open a file on this machine, so the bytes have to travel —
 * and that makes this a door into the file system with the page on the other
 * side of it. It is opened exactly as far as the reason for it: a file with a
 * picture's extension, inside one of the folders named by the caller, reached
 * by a path that is really in there rather than one that walks out through
 * `..` and a symlink.
 */
export function readImage(path: string, within: readonly string[]): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = Object.entries(EXTENSIONS).find(([, e]) => e === ext)?.[0];
  if (!mime) return undefined;

  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return undefined;
  }

  const inside = within.some((folder) => {
    let root: string;
    try {
      root = realpathSync(folder);
    } catch {
      return false;
    }
    return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
  });
  if (!inside) return undefined;

  try {
    const bytes = readFileSync(real);
    // A picture nobody could see is not worth a megabyte of message, and a
    // screenshot is nothing like this big.
    if (bytes.length === 0 || bytes.length > 24 * 1024 * 1024) return undefined;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
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
