/**
 * Text as it should be spoken rather than as it is written.
 *
 * An answer about code is full of `Order.total(total)` and `Main.kt`, and a
 * voice reads the dot in those as the end of a sentence and the brackets as
 * nothing at all. So a dot between two words is said as "dot" — "point"
 * between two digits, so `123.4` is a number — and brackets become a gap
 * between the words they held. A dot that ends a sentence is left alone, which
 * is what gives the voice its pause.
 *
 * A file's extension can be left unsaid, so `Main.kt` is read as "Main". Only
 * the extensions below count: `Order.total` is not a file.
 *
 * `at` maps every character of the spoken text back to the one it came from,
 * because the voice reports where it is in what it was given, and the box has
 * to be drawn over what is on screen.
 */

export interface Voiced {
  text: string;
  at: number[];
}

const WORD = /[\p{L}\p{N}_]/u;
const DIGIT = /\p{N}/u;
const BRACKETS = new Set(["(", ")", "[", "]", "{", "}", "<", ">"]);
const EXTENSION =
  /^\.(?:kts?|java|scala|groovy|gradle|tsx?|jsx?|mjs|cjs|svelte|vue|py|rb|go|rs|swift|c|h|cc|cpp|hpp|cs|php|sql|sh|zsh|json|ya?ml|toml|xml|html|css|scss|md|txt|lock|properties|env)(?![\p{L}\p{N}_])/u;

const FOLDERS = /^(?:~|\.{1,2})?\/?(?:[\p{L}\p{N}_.@-]+\/)+(?=[\p{L}\p{N}_.@-])/u;
const PATH_START = /[\p{L}\p{N}_.@~/:-]/u;

const NAME = /[\p{L}\p{N}_.@-]/u;

function folders(written: string, i: number): { skip: number; trailing?: number } {
  const none = { skip: 0 };
  if (PATH_START.test(written[i - 1] ?? "")) return none;
  const match = FOLDERS.exec(written.slice(i));
  if (!match) return none;
  const prefix = match[0];
  const rest = /^[\p{L}\p{N}_.@-]+/u.exec(written.slice(i + prefix.length))?.[0] ?? "";
  const end = i + prefix.length + rest.length;
  const closed = written[end] === "/";
  if (closed && (NAME.test(written[end + 1] ?? "") || written[end + 1] === "/")) return none;
  const rooted = /^(?:~|\.{1,2})?\//.test(prefix);
  const slashes = prefix.split("/").length - 1 + (closed ? 1 : 0);
  const named = /\.[\p{L}\p{N}]+$/u.test(rest) && EXTENSION.test(rest.slice(rest.lastIndexOf(".")));
  if (!(rooted || slashes >= 2 || named)) return none;
  return closed ? { skip: prefix.length, trailing: end } : { skip: prefix.length };
}

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const LONG_NUMBER = 6;

function digitRun(written: string, i: number): number {
  if (!DIGIT.test(written[i] ?? "") || DIGIT.test(written[i - 1] ?? "")) return 0;
  if (written[i - 1] === "." && DIGIT.test(written[i - 2] ?? "")) return 0;
  let end = i;
  while (DIGIT.test(written[end] ?? "")) end++;
  if (written[end] === "." && DIGIT.test(written[end + 1] ?? "")) return 0;
  return end - i >= LONG_NUMBER ? end - i : 0;
}

export function voiced(written: string, extensions = true, paths = true): Voiced {
  let text = "";
  const at: number[] = [];
  const emit = (said: string, from: number) => {
    text += said;
    for (let i = 0; i < said.length; i++) at.push(from);
  };
  /* Words read in place of a written span, each one boxed over the whole span. */
  const words = (said: string[], from: number, to: number) => {
    for (const word of said) {
      text += " ";
      at.push(from);
      for (let k = 0; k < word.length; k++) at.push(k === word.length - 1 ? to : from);
      text += word;
    }
    text += " ";
    at.push(to);
  };
  let trailing = -1;
  for (let i = 0; i < written.length; i++) {
    const char = written[i]!;
    if (i === trailing) continue;
    const run = digitRun(written, i);
    if (run) {
      for (let k = i; k < i + run; k++) words([DIGITS[Number(written[k])] ?? written[k]!], k, k);
      i += run - 1;
      continue;
    }
    const arrow = char === "→" ? 1 : char === "-" && written[i + 1] === ">" ? 2 : 0;
    if (arrow) {
      words(["transforms", "into"], i, i + arrow - 1);
      i += arrow - 1;
      continue;
    }
    const path = paths ? { skip: 0 } : folders(written, i);
    if (path.skip) {
      if (path.trailing !== undefined) trailing = path.trailing;
      i += path.skip - 1;
      continue;
    }
    const extension = !extensions && char === "." && WORD.test(written[i - 1] ?? "")
      ? EXTENSION.exec(written.slice(i))
      : null;
    if (extension) {
      i += extension[0].length - 1;
      continue;
    }
    const joins =
      char === "." && WORD.test(written[i - 1] ?? "") && WORD.test(written[i + 1] ?? "");
    const number = joins && DIGIT.test(written[i - 1]!) && DIGIT.test(written[i + 1]!);
    if (number) emit(" point ", i);
    else if (joins) emit(" dot ", i);
    else if (BRACKETS.has(char)) emit(" ", i);
    else emit(char, i);
  }
  return { text, at };
}

/**
 * The written span behind the spoken word starting at `index`, if one starts
 * there.
 */
export function writtenSpan(voice: Voiced, index: number): { start: number; end: number } | null {
  const lead = /^\s*/.exec(voice.text.slice(index))?.[0].length ?? 0;
  const start = index + lead;
  const length = /^\S+/.exec(voice.text.slice(start))?.[0].length ?? 0;
  if (length === 0) return null;
  return { start: voice.at[start]!, end: voice.at[start + length - 1]! + 1 };
}

/**
 * Sentences, each spoken as its own utterance so a long answer is not cut off.
 *
 * Only a stop followed by a space or the end of the text ends one: the dot in
 * `Main.kt` is part of a word.
 */
export function sentences(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const match of text.matchAll(/(?:[^.!?\n]|[.!?](?=[^\s.!?]))+[.!?]*/g)) {
    if (match[0].trim()) out.push({ start: match.index, text: match[0] });
  }
  return out;
}
