/**
 * Reading an agent's answer aloud, one block at a time.
 *
 * One narration for the whole page: starting a block stops whichever was
 * speaking. The text is taken from what the block drew rather than from its
 * markdown, so every character spoken has a place on screen for the current
 * word to be boxed at. Fenced code is left out — a listing read aloud is noise —
 * while inline code is read, because it is part of the sentence around it.
 */

import { settings } from "../state.svelte.js";
import { sentences, voiced, writtenSpan } from "./voiced.js";
import { canSpeak, prepare, silence, utter } from "./voices.js";

/** Where a piece of the spoken text came from, so a word can be found again. */
interface Piece {
  node: Text;
  /** Where this node's text starts in the whole. */
  start: number;
}

interface Spoken {
  text: string;
  pieces: Piece[];
}

const SKIPPED = "pre, svg, button, .suggestion, .diagram";
const BLOCKS = "p, li, h1, h2, h3, blockquote, td, th";

export const narration = $state<{ current: HTMLElement | null }>({ current: null });

let generation = 0;

/** Every block that can be read, so one finishing can hand on to the next. */
const readable = new Map<HTMLElement, (from: number) => void>();

/** How far into each block the voice has got, so new text is read from there. */
const readTo = new WeakMap<HTMLElement, number>();

export function readableBlock(root: HTMLElement, start: (from: number) => void): () => void {
  readable.set(root, start);
  return () => readable.delete(root);
}

/**
 * A block that has just arrived in a turn still running, or grown in one, for
 * reading aloud on its own — from where the voice left it, if it was read.
 *
 * Left alone while something is being read, which reaches it by going on to
 * the next block, and when it is not the last block — a log mounted mid-turn
 * puts every block in at once, and only the newest is news.
 */
export function arrived(root: HTMLElement): void {
  queueMicrotask(() => {
    if (narration.current || after(root)) return;
    readable.get(root)?.(readTo.get(root) ?? 0);
  });
}

/** The block after this one in the log, if there is one. */
function after(root: HTMLElement): (() => void) | undefined {
  let best: HTMLElement | undefined;
  for (const other of readable.keys()) {
    if (!(root.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (!best || other.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = other;
    }
  }
  return best && readable.get(best);
}

export function canNarrate(): boolean {
  return canSpeak();
}

export function hush(): void {
  generation++;
  silence();
  narration.current = null;
}

/** The block's words in reading order, with where each text node begins. */
function spoken(root: HTMLElement): Spoken {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIPPED)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const pieces: Piece[] = [];
  let text = "";
  let block: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const here = node.parentElement?.closest(BLOCKS) ?? null;
    if (text && here !== block) text += "\n";
    block = here;
    pieces.push({ node: node as Text, start: text.length });
    text += node.textContent ?? "";
  }
  return { text, pieces };
}

/** The written span from `at` to `end`, as a range over whichever nodes hold it. */
function wordAt(spoken: Spoken, at: number, end: number): Range | null {
  const locate = (offset: number, closing: boolean) => {
    for (let i = spoken.pieces.length - 1; i >= 0; i--) {
      const piece = spoken.pieces[i]!;
      const length = piece.node.length;
      const inside = closing
        ? offset > piece.start && offset <= piece.start + length
        : offset >= piece.start && offset < piece.start + length;
      if (inside) return { node: piece.node, offset: offset - piece.start };
    }
    return null;
  };
  const from = locate(at, false);
  const to = locate(end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/**
 * The word under a point on screen, for starting a reading there.
 *
 * Snapped back to the start of the word, so the voice never begins halfway
 * through one. `from` is where in the block the reading starts, and `caret` is
 * the first character of that word, for drawing where it will begin.
 */
export function wordUnder(
  root: HTMLElement,
  x: number,
  y: number,
): { from: number; caret: Range } | null {
  const hit = document.caretRangeFromPoint?.(x, y);
  if (!hit || !root.contains(hit.startContainer)) return null;
  const said = spoken(root);
  const piece = said.pieces.find((one) => one.node === hit.startContainer);
  if (!piece) return null;
  let from = piece.start + hit.startOffset;
  while (from > 0 && /\S/.test(said.text[from - 1]!)) from--;
  while (from < said.text.length && /\s/.test(said.text[from]!)) from++;
  if (from >= said.text.length) return null;
  const caret = wordAt(said, from, from + 1);
  return caret && { from, caret };
}

/**
 * Reads a block aloud, telling `onWord` about each word as it is spoken.
 *
 * `onWord(null)` is the end of it, however it ended. A block read to its end
 * goes on to the next one in the log. The block is read again between
 * sentences, so an answer still arriving is read as far as it has got.
 */
export function narrate(
  root: HTMLElement,
  onWord: (word: Range | null) => void,
  from = 0,
): void {
  hush();
  if (!canNarrate()) return;
  const mine = generation;
  narration.current = root;
  let done = from;

  const speak = (): void => {
    if (mine !== generation) return;
    const said = spoken(root);
    const first = sentences(said.text.slice(done))[0];
    const chunk = first && { start: done + first.start, text: first.text };
    if (chunk) done = chunk.start + chunk.text.length;
    readTo.set(root, done);
    if (!chunk) {
      narration.current = null;
      onWord(null);
      after(root)?.(0);
      return;
    }
    const voice = voiced(chunk.text, settings.narrateExtensions, settings.narrateFolders);
    const ahead = sentences(said.text.slice(done))[0];
    if (ahead) prepare(voiced(ahead.text, settings.narrateExtensions, settings.narrateFolders).text);
    utter(
      voice.text,
      (index) => {
        if (mine !== generation) return;
        const span = writtenSpan(voice, index);
        if (!span) return;
        onWord(wordAt(said, chunk.start + span.start, chunk.start + span.end));
      },
      speak,
    );
  };

  speak();
}
