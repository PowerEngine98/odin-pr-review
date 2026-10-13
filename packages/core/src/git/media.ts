import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { looksLikePicture, pictureIn } from "../graph/pictures.js";
import { looksLikeSound, soundIn } from "../graph/sounds.js";
import type { ChangeGraph, FileNode, Side } from "../model/types.js";
import type { GitOptions } from "./exec.js";

const execFileAsync = promisify(execFile);

/**
 * Reads the pictures and recordings in a change, so their cards can be them.
 *
 * The shape goes on the node and the bytes do not. That split is the whole
 * design here. A card's size is worked out in the extension host before any
 * page exists — the arrows are placed against those sizes — so the engine needs
 * the proportions, and the proportions are four numbers. The bytes are a
 * megabyte, they are only ever drawn, and the graph is a document people export
 * and commit: a change with a dozen screenshots in it would serialise to a file
 * mostly made of base64.
 *
 * So the data URIs are kept apart from the nodes. They are handed back, the way
 * snippets are, and also left on the graph itself — which is not the same thing
 * as being in the document: `serializeGraph` drops them, and there is a test
 * that says so. The graph object is what a build passes to whatever draws it,
 * and everything that draws already has one; the exported file is the contract,
 * and it stays as it was.
 */
export interface MediaOptions extends GitOptions {
  /**
   * The most bytes worth embedding in a page, per file.
   *
   * There is a limit because the page holds them all at once and base64 is a
   * third larger again. Past it the card falls back to what it was before any
   * of this: a filename and the word "binary", which is true and costs nothing.
   */
  maxBytes?: number;
  /**
   * The most bytes worth embedding across the whole change.
   *
   * A per-file limit bounds one card and says nothing about a page. A change
   * that replaces forty screenshots is forty files each under the per-file
   * limit and a document of a third of a gigabyte, which is not a slow page but
   * a window that never comes back.
   *
   * Past it the remaining pictures are left undrawn rather than the whole lot
   * refused: the cards that fit are worth having, and the rest say what they
   * said before.
   */
  maxTotalBytes?: number;
}

/**
 * Everything a reading can draw or play, as data URIs, by node id.
 *
 * One map for both, because a node is one or the other and never both. One
 * budget for the same reason: a change carrying pictures and recordings would
 * otherwise be allowed to spend the whole of it twice over.
 */
export type Media = Map<string, string>;

const DEFAULT_MAX = 6 * 1024 * 1024;
const DEFAULT_TOTAL = 24 * 1024 * 1024;

/**
 * Finds every picture and recording in the change, and says what each is.
 *
 * Writes `picture` or `sound` onto the nodes it recognises and hands back the
 * data URI for each, keyed by node id.
 *
 * A file named like one and holding something else is left entirely alone: no
 * `picture`, no `sound`, no entry here, and a card that goes on saying what it
 * said before. The bytes decide, because a name can be wrong — and a card built
 * from a wrong name is a broken-image glyph, or a player that will not play,
 * where the diff used to be. Either looks like a broken file rather than an
 * unreadable one.
 */
export async function enrichMedia(
  graph: ChangeGraph,
  options: MediaOptions,
): Promise<Media> {
  const most = options.maxBytes ?? DEFAULT_MAX;
  const budget = options.maxTotalBytes ?? DEFAULT_TOTAL;
  const found: Media = new Map();
  let spent = 0;

  for (const node of graph.nodes) {
    // A file nothing happened to is in the drawing because something points at
    // it. Opening it to draw it would be reading blobs for files the change
    // does not touch, which on a large repository is most of them.
    if (node.status === "phantom") continue;
    const drawn = looksLikePicture(node.path);
    const heard = !drawn && looksLikeSound(node.path);
    if (!drawn && !heard) continue;

    const bytes = await readBytes(node, sideOf(node), graph, options, most);
    if (!bytes) continue;

    const picture = drawn ? pictureIn(bytes) : undefined;
    const sound = heard ? soundIn(bytes) : undefined;
    // What to tell a browser it is. Nothing recognised means nothing to show.
    const mime = picture?.mime ?? sound?.mime;
    if (!mime) continue;

    /*
     * Measured, then drawn only if there is room left for it.
     *
     * The shape is recorded either way, because it costs four numbers and the
     * card is sized from it — but a card sized for a picture it has not got
     * would be an empty frame. So the drawing and the shape are kept together:
     * past the budget, neither.
     */
    if (spent + bytes.length > budget) continue;
    spent += bytes.length;

    // What these bytes are, so that a replaced file is seen as a change at all.
    // Everything else about a binary one stays identical when its contents are
    // swapped: see the note on `Picture.digest`.
    const digest = digestOf(bytes);
    if (picture) node.picture = { ...picture, digest };
    if (sound) node.sound = { ...sound, digest };
    found.set(node.id, dataUri(mime, bytes));
  }

  // Left on the graph as well as handed back, so that everything already given
  // a graph to draw — the page, the static export, the command line — has them
  // without a new argument being threaded to each. Dropped again by
  // `serializeGraph`: see the note on `ChangeGraph.media`.
  if (found.size > 0) graph.media = Object.fromEntries(found);

  return found;
}

/** Which side of the comparison a card shows, which is the one to play. */
function sideOf(node: FileNode): Side {
  return node.status === "deleted" ? "base" : "head";
}

/**
 * These bytes, short enough to sit on a node and in a document.
 *
 * Sixteen hex characters of SHA-256. It is compared against another digest of
 * the same kind and never used to prove anything about the bytes to anybody
 * else, so the only property wanted is that two different images do not collide
 * in one reading of one change.
 */
function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** The file as a page can hold it. */
function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * The blob behind a card, as bytes.
 *
 * The text reader beside this one cannot be reused and the reason is the
 * encoding: `git show` decoded as UTF-8 replaces every byte that is not valid
 * UTF-8 with U+FFFD, which for a PNG is almost all of them. The image would
 * arrive corrupted and — worse — plausibly sized, because the header bytes that
 * survive are the ones in ASCII range.
 *
 * A live reading is of the working tree, so its head side is the file on disk
 * rather than the commit `HEAD` names. The same rule the text reader follows,
 * and for the same reason: somebody watching an agent work is watching a tree
 * full of changes that were never committed, and a picture just written has no
 * blob to show.
 */
async function readBytes(
  node: FileNode,
  side: Side,
  graph: ChangeGraph,
  options: GitOptions,
  most: number,
): Promise<Uint8Array | undefined> {
  const path = side === "base" ? (node.prevPath ?? node.path) : node.path;
  const live = graph.meta.worktree === true && side === "head";
  const sha = side === "base" ? graph.meta.mergeBase : graph.meta.headSha;
  if (!live && !sha) return undefined;

  try {
    if (live) {
      const bytes = await readFile(resolve(graph.meta.repo ?? options.cwd, path));
      return bytes.length === 0 || bytes.length > most ? undefined : bytes;
    }

    /*
     * Asked for its size first.
     *
     * `cat-file -s` is a lookup in the object database, where reading the blob
     * to find out how big it is means inflating it — and the files this guards
     * against are the large ones, so the waste is worst exactly where the guard
     * matters. It also keeps a video somebody named `.png` from being inflated
     * into this process before anything gets to refuse it.
     */
    const measured = Number(
      (await git(["cat-file", "-s", `${sha}:${path}`], options)).trim(),
    );
    if (!Number.isFinite(measured) || measured === 0 || measured > most) return undefined;

    const { stdout } = await execFileAsync("git", ["show", `${sha}:${path}`], {
      cwd: options.cwd,
      maxBuffer: Math.max(most * 2, 16 * 1024 * 1024),
      // No encoding at all, which is what makes stdout a Buffer. Naming one —
      // even "binary" — hands back a string, and the bytes are gone.
      encoding: null as unknown as undefined,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return stdout as unknown as Uint8Array;
  } catch {
    // Unreadable, not there, or a path git has never been told about. The card
    // says what it has always said.
    return undefined;
  }
}

/** The text form, for the one call above that wants a number back. */
async function git(args: string[], options: GitOptions): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout;
}
