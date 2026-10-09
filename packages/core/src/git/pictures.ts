import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { looksLikePicture, pictureIn, type Picture } from "../graph/pictures.js";
import type { ChangeGraph, FileNode, Side } from "../model/types.js";
import type { GitOptions } from "./exec.js";

const execFileAsync = promisify(execFile);

/**
 * Reads the pictures in a change, so their cards can be the picture.
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
export interface PictureOptions extends GitOptions {
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

/** What a reading knows about its pictures, beyond the shapes on the nodes. */
export type Drawings = Map<string, string>;

const DEFAULT_MAX = 6 * 1024 * 1024;
const DEFAULT_TOTAL = 24 * 1024 * 1024;

/**
 * Finds every picture in the change and measures it.
 *
 * Writes `picture` onto the nodes it recognises and hands back the data URI for
 * each, keyed by node id.
 *
 * A file that is named like a picture and is not one is left entirely alone: no
 * `picture`, no entry here, and a card that goes on saying what it said before.
 * The bytes decide, because a name can be wrong and a card drawn from a wrong
 * name is a broken-image glyph where the diff used to be.
 */
export async function enrichPictures(
  graph: ChangeGraph,
  options: PictureOptions,
): Promise<Drawings> {
  const most = options.maxBytes ?? DEFAULT_MAX;
  const budget = options.maxTotalBytes ?? DEFAULT_TOTAL;
  const drawings: Drawings = new Map();
  let spent = 0;

  for (const node of graph.nodes) {
    // A file nothing happened to is in the drawing because something points at
    // it. Opening it to draw it would be reading blobs for files the change
    // does not touch, which on a large repository is most of them.
    if (node.status === "phantom") continue;
    if (!looksLikePicture(node.path)) continue;

    const bytes = await readBytes(node, sideOf(node), graph, options, most);
    if (!bytes) continue;

    const picture = pictureIn(bytes);
    if (!picture) continue;

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

    node.picture = picture;
    drawings.set(node.id, dataUri(picture, bytes));
  }

  // Left on the graph as well as handed back, so that everything already given
  // a graph to draw — the page, the static export, the command line — has the
  // pictures without a new argument being threaded to each of them. Dropped
  // again by `serializeGraph`: see the note on `ChangeGraph.drawings`.
  if (drawings.size > 0) graph.drawings = Object.fromEntries(drawings);

  return drawings;
}

/** Which side of the comparison a card shows, which is the one to draw. */
function sideOf(node: FileNode): Side {
  return node.status === "deleted" ? "base" : "head";
}

/** The picture as a page can hold it. */
function dataUri(picture: Picture, bytes: Uint8Array): string {
  return `data:${picture.mime};base64,${Buffer.from(bytes).toString("base64")}`;
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
