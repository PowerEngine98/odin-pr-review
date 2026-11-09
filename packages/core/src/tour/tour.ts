/**
 * A guided tour of a change: what an agent writes, and the rules it is held to.
 *
 * The agent reads the whole change and answers with lessons — topics — each a
 * flow through the code in the order it runs, told the way a senior engineer
 * walks a colleague through a pull request: why each piece is shaped the way it
 * is, not merely where it lives. The page plays a topic like a short video,
 * one frame after another.
 *
 * Nothing here is a coordinate. A live reading moves its cards on every save,
 * so a frame names a file by its path and a place in it by a few lines of its
 * code, and the page finds those lines wherever they are now (`locate`).
 */

export const TOUR_VERSION = 1;

/** A place in the code: a file, and a few of its lines as they appear. */
export interface Anchor {
  /** Path from the repository root, exactly as the change lists it. */
  file: string;
  /** One to six consecutive lines copied from the file, verbatim. */
  code: string;
  /** Which side of the diff the lines are on. The new code unless it was removed. */
  side?: "head" | "base";
}

interface Spoken {
  /** What the narrator says while this frame is on screen. One or two sentences. */
  say?: string;
  /**
   * Keep the highlights and arrows already on screen. Without it, a frame
   * clears what earlier frames drew before drawing its own.
   */
  keep?: boolean;
}

/** Fly to a file's card. The camera's path between moves is the page's to smooth. */
export interface GoFrame extends Spoken {
  kind: "go";
  file: string;
  /** How close: the whole card, reading distance, or close up. Reading by default. */
  zoom?: "card" | "read" | "close";
}

/** Bring a few lines to the middle of the screen. */
export interface FocusFrame extends Spoken, Anchor {
  kind: "focus";
  zoom?: "card" | "read" | "close";
}

/** Draw a box around a few lines, with an optional label beside it. */
export interface HighlightFrame extends Spoken, Anchor {
  kind: "highlight";
  label?: string;
  /** More places boxed in the same frame, for a sentence about several at once. */
  also?: (Anchor & { label?: string })[];
}

/** An arrow's end: a few lines, or a whole file when it names no code. */
export type End = Omit<Anchor, "code"> & { code?: string };

/**
 * Draw an arrow from one place to another, to say "this leads to that".
 *
 * Two ends too far apart to read together are not shown from a distance: the
 * player travels the arrow, close on where it leaves, on its label, then close
 * on where it lands.
 */
export interface ArrowFrame extends Spoken {
  kind: "arrow";
  from: End;
  to: End;
  label?: string;
  /**
   * More arrows drawn in the same frame: five calls that all lead to one place
   * are one sentence and one picture, not five frames.
   */
  also?: { from: End; to: End; label?: string }[];
}

/** Every box a highlight frame draws, its own first. */
export function highlightsOf(frame: HighlightFrame): (Anchor & { label?: string })[] {
  const own = { file: frame.file, code: frame.code, ...(frame.side ? { side: frame.side } : {}), ...(frame.label ? { label: frame.label } : {}) };
  return [own, ...(frame.also ?? [])];
}

/** Every arrow an arrow frame draws, its own first. */
export function arrowsOf(frame: ArrowFrame): { from: End; to: End; label?: string }[] {
  return [{ from: frame.from, to: frame.to, ...(frame.label ? { label: frame.label } : {}) }, ...(frame.also ?? [])];
}

/**
 * A picture of the idea, drawn for this frame only: a mermaid diagram placed in
 * empty canvas beside the file it is about, and gone when the next frame starts
 * unless that one keeps it.
 */
export interface DiagramFrame extends Spoken {
  kind: "diagram";
  /** Mermaid source: a flowchart, a sequence, a state machine. Small. */
  mermaid: string;
  /** The changed file to stand beside. Beside whatever is on screen without one. */
  near?: string;
}

/** Narration over whatever is on screen. */
export interface SayFrame extends Spoken {
  kind: "say";
  say: string;
}

/** Stop and let the reader take it in. */
export interface PauseFrame extends Spoken {
  kind: "pause";
  /** One to fifteen. */
  seconds: number;
}

/**
 * A topic's title, read aloud over the canvas before its first frame.
 *
 * Never written by the agent: the page puts one at the head of every topic
 * (`titled`), so a reader always hears where one lesson ends and the next
 * begins.
 */
export interface TitleFrame extends Spoken {
  kind: "title";
  say: string;
}

export type Frame =
  | GoFrame
  | FocusFrame
  | HighlightFrame
  | ArrowFrame
  | DiagramFrame
  | SayFrame
  | PauseFrame
  | TitleFrame;

export interface Topic {
  /** Short, stable, kebab-case. */
  id: string;
  /** What the lesson is about, in a few words: the tab's label. */
  title: string;
  /** One sentence: what the reader will understand by the end. */
  summary: string;
  frames: Frame[];
}

export interface Tour {
  version: typeof TOUR_VERSION;
  title: string;
  topics: Topic[];
}

/** A topic's place in the tour as a roman numeral: 1 is I, 4 is IV. */
export function roman(n: number): string {
  const numerals: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let left = Math.max(0, Math.floor(n));
  let out = "";
  for (const [value, numeral] of numerals) {
    while (left >= value) {
      out += numeral;
      left -= value;
    }
  }
  return out;
}

/** Every topic opened by its title frame, once. */
export function titled(tour: Tour): Tour {
  return {
    ...tour,
    topics: tour.topics.map((topic) => {
      if (topic.frames[0]?.kind === "title") return topic;
      return { ...topic, frames: [{ kind: "title", say: topic.title }, ...topic.frames] };
    }),
  };
}

/* ------------------------------------------------------------- validating */

export type Parsed = { ok: true; tour: Tour; warnings: string[] } | { ok: false; errors: string[] };

const ZOOMS = new Set(["card", "read", "close"]);

/**
 * The agent's answer, checked against the rules before anything plays it.
 *
 * Accepts the JSON alone or inside a fenced block, since agents add one. Files
 * the change does not contain are errors when `files` is given: a tour that
 * flies to a card that is not on the canvas is a tour that stops for good.
 */
export function parseTour(answer: string, files?: readonly string[]): Parsed {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = files ? new Set(files) : undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(answer));
  } catch (error) {
    return { ok: false, errors: [`not JSON: ${String(error)}`] };
  }
  if (!isObject(raw)) return { ok: false, errors: ["the answer is not an object"] };
  if (raw.version !== TOUR_VERSION) errors.push(`version must be ${TOUR_VERSION}`);
  if (!text(raw.title)) errors.push("title is required");
  if (!Array.isArray(raw.topics) || raw.topics.length === 0) {
    errors.push("topics must be a non-empty array");
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  raw.topics.forEach((topic: unknown, t: number) => {
    const at = `topics[${t}]`;
    if (!isObject(topic)) return void errors.push(`${at} is not an object`);
    if (!text(topic.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic.id as string)) {
      errors.push(`${at}.id must be kebab-case`);
    } else if (ids.has(topic.id as string)) {
      errors.push(`${at}.id "${topic.id}" is repeated`);
    } else ids.add(topic.id as string);
    if (!text(topic.title)) errors.push(`${at}.title is required`);
    if (!text(topic.summary)) errors.push(`${at}.summary is required`);
    if (!Array.isArray(topic.frames) || topic.frames.length === 0) {
      return void errors.push(`${at}.frames must be a non-empty array`);
    }
    let placed = false;
    topic.frames.forEach((frame: unknown, f: number) => {
      const where = `${at}.frames[${f}]`;
      if (!isObject(frame)) return void errors.push(`${where} is not an object`);
      if (frame.say !== undefined && !text(frame.say)) errors.push(`${where}.say must be text`);
      const anchor = (value: unknown, name: string, whole = false) => {
        if (!isObject(value)) return void errors.push(`${name} must be an anchor`);
        if (!text(value.file)) errors.push(`${name}.file is required`);
        else if (known && !known.has(value.file as string)) {
          errors.push(`${name}.file "${value.file}" is not in the change`);
        }
        const fileOnly = whole && value.code === undefined;
        if (!fileOnly && !text(value.code)) errors.push(`${name}.code is required`);
        else if (!fileOnly && (value.code as string).split("\n").length > 6) {
          warnings.push(`${name}.code is longer than six lines`);
        }
        if (value.side !== undefined && value.side !== "head" && value.side !== "base") {
          errors.push(`${name}.side must be "head" or "base"`);
        }
      };
      switch (frame.kind) {
        case "go":
          if (!text(frame.file)) errors.push(`${where}.file is required`);
          else if (known && !known.has(frame.file as string)) {
            errors.push(`${where}.file "${frame.file}" is not in the change`);
          }
          if (frame.zoom !== undefined && !ZOOMS.has(frame.zoom as string)) {
            errors.push(`${where}.zoom must be card, read or close`);
          }
          placed = true;
          break;
        case "focus":
          anchor(frame, where);
          if (frame.zoom !== undefined && !ZOOMS.has(frame.zoom as string)) {
            errors.push(`${where}.zoom must be card, read or close`);
          }
          placed = true;
          break;
        case "highlight":
          anchor(frame, where);
          if (frame.also !== undefined) {
            if (!Array.isArray(frame.also)) errors.push(`${where}.also must be an array of anchors`);
            else frame.also.forEach((one: unknown, i: number) => anchor(one, `${where}.also[${i}]`));
          }
          if (!placed) warnings.push(`${where} highlights before the topic has gone anywhere`);
          break;
        case "arrow":
          anchor(frame.from, `${where}.from`, true);
          anchor(frame.to, `${where}.to`, true);
          if (frame.also !== undefined) {
            if (!Array.isArray(frame.also)) errors.push(`${where}.also must be an array of arrows`);
            else {
              frame.also.forEach((one: unknown, i: number) => {
                if (!isObject(one)) return void errors.push(`${where}.also[${i}] must be an arrow`);
                anchor(one.from, `${where}.also[${i}].from`, true);
                anchor(one.to, `${where}.also[${i}].to`, true);
              });
            }
          }
          break;
        case "diagram":
          if (!text(frame.mermaid)) errors.push(`${where}.mermaid is required`);
          else if ((frame.mermaid as string).split("\n").length > 30) {
            warnings.push(`${where}.mermaid is longer than thirty lines`);
          }
          if (frame.near !== undefined) {
            if (!text(frame.near)) errors.push(`${where}.near must be a file`);
            else if (known && !known.has(frame.near as string)) {
              errors.push(`${where}.near "${frame.near}" is not in the change`);
            }
          }
          break;
        case "say":
          if (!text(frame.say)) errors.push(`${where}.say is required`);
          break;
        case "pause":
          if (typeof frame.seconds !== "number" || frame.seconds < 1 || frame.seconds > 15) {
            errors.push(`${where}.seconds must be between 1 and 15`);
          }
          break;
        default:
          errors.push(`${where}.kind "${String(frame.kind)}" is not one of go, focus, highlight, arrow, diagram, say, pause`);
      }
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  const tour = raw as unknown as Tour;
  if (files) tour.topics.forEach((topic, t) => warnings.push(...unshown(topic, `topics[${t}]`, files)));
  return { ok: true, tour, warnings };
}

/**
 * Frames whose narration names a changed file the screen is not showing.
 *
 * A listener told about a file has to be able to find it: the camera on it, a
 * box on it or an arrow to it. What is on screen is followed frame by frame —
 * the file the camera last went to, and the files the marks still standing are
 * on — and a sentence naming any other changed file is reported.
 */
export function unshown(topic: Topic, at: string, files: readonly string[]): string[] {
  const named = files
    .map((path) => ({ path, names: spokenNames(path) }))
    .filter((file) => file.names.length > 0);
  const out: string[] = [];
  let camera: string | undefined;
  let marked = new Set<string>();
  topic.frames.forEach((frame, f) => {
    if (!frame.keep) marked = new Set();
    if (frame.kind === "go" || frame.kind === "focus") camera = frame.file;
    if (frame.kind === "highlight") for (const one of highlightsOf(frame)) marked.add(one.file);
    if (frame.kind === "diagram" && frame.near) marked.add(frame.near);
    if (frame.kind === "arrow") {
      for (const one of arrowsOf(frame)) {
        marked.add(one.from.file);
        marked.add(one.to.file);
      }
    }
    if (!frame.say) return;
    for (const file of named) {
      if (file.path === camera || marked.has(file.path)) continue;
      if (file.names.some((name) => mentions(frame.say!, name))) {
        out.push(`${at}.frames[${f}] names ${file.path} without showing it: focus it, highlight it, or draw an arrow to it`);
      }
    }
  });
  return out;
}

/**
 * How a sentence would name a file: its name without the extension, and that
 * name's words spaced out. Only names of two or more words count — "index" or
 * "types" turn up in sentences that mean nothing by them.
 */
function spokenNames(path: string): string[] {
  const stem = (path.split("/").pop() ?? "").replace(/\..*$/, "");
  const words = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean);
  if (words.length < 2) return [];
  return [stem, words.join(" ")];
}

function mentions(say: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, "i").test(say);
}

function extractJson(answer: string): string {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(answer);
  if (fenced) return fenced[1]!;
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  return start >= 0 && end > start ? answer.slice(start, end + 1) : answer;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/* --------------------------------------------------------------- locating */

/**
 * Where a few lines of code are in a file now, by similarity rather than by
 * number.
 *
 * Lines are compared with their whitespace collapsed, and a window of the same
 * length is slid down the file and scored by how many of its lines match the
 * anchor's — exactly, or failing that by shared tokens. The best window wins
 * when it clears `threshold`, so a line renamed since the tour was written still
 * lands, and a snippet that is gone lands nowhere rather than somewhere wrong.
 *
 * `lines` are the file's lines, first at index 0; the answer is 1-based and
 * inclusive.
 */
export function locate(
  lines: readonly string[],
  code: string,
  threshold = 0.6,
): { start: number; end: number; score: number } | null {
  const wanted = code.split("\n").map(squash).filter((line) => line.length > 0);
  if (wanted.length === 0 || lines.length === 0) return null;
  const have = lines.map(squash);
  let best: { start: number; end: number; score: number } | null = null;

  for (let at = 0; at < have.length; at++) {
    if (have[at] === "") continue;
    let score = 0;
    let i = at;
    let matched = 0;
    for (const line of wanted) {
      while (i < have.length && have[i] === "") i++;
      if (i >= have.length) break;
      score += similarity(have[i]!, line);
      matched++;
      i++;
    }
    if (matched === 0) continue;
    const mean = score / wanted.length;
    if (!best || mean > best.score) best = { start: at + 1, end: i, score: mean };
    if (mean === 1) break;
  }
  return best && best.score >= threshold ? best : null;
}

function squash(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.5 + 0.5;
  const left = new Set(a.split(/\W+/).filter(Boolean));
  const right = new Set(b.split(/\W+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return (2 * shared) / (left.size + right.size) * 0.9;
}

/* ---------------------------------------------------------------- timing */

/** Characters a second a narrator reads at, and what a camera move costs. */
const READING = 14;
const FLIGHT = 1.2;
const LINGER = 1.5;
/** Long enough for a title to come in, be read, and go. */
const TITLE = 2.6;

/** How long one frame stays on screen, in seconds, before the next. */
export function frameSeconds(frame: Frame): number {
  const spoken = frame.say ? frame.say.length / READING : 0;
  switch (frame.kind) {
    case "pause":
      return frame.seconds + spoken;
    case "go":
    case "focus":
      return FLIGHT + Math.max(spoken, LINGER);
    case "arrow":
      if (frame.also?.length) return FLIGHT + Math.max(spoken, LINGER + frame.also.length * 0.4);
      if (frame.from.file === frame.to.file) return Math.max(spoken, LINGER);
      return FLIGHT * (frame.label ? 3 : 2) + Math.max(spoken, LINGER);
    case "title":
      return Math.max(spoken, TITLE);
    case "diagram":
      return FLIGHT + Math.max(spoken, LINGER + 2);
    default:
      return Math.max(spoken, LINGER);
  }
}

/** A topic's running time, like the length printed on a video. */
export function topicSeconds(topic: Topic): number {
  return topic.frames.reduce((sum, frame) => sum + frameSeconds(frame), 0);
}

/** `3:07`, the way a player prints it. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- asking */

export interface TourContext {
  /** The change's title, when it has one. */
  title?: string;
  /** What the diff is measured from, for `git diff <base>`. */
  base: string;
  /** Whether the change includes uncommitted work in the working tree. */
  worktree: boolean;
  /** The changed files, in dependency order: what is depended on first. */
  files: { path: string; additions: number; deletions: number }[];
}

/**
 * The budget: how many topics, and how long the whole tour may run.
 *
 * Grows with the change but slowly — a reader with a two-hundred-file change
 * wants the five flows that matter, not twenty — and is said to the agent as a
 * limit rather than a target.
 */
export function budgetFor(context: TourContext): { topics: number; minutes: number } {
  const lines = context.files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const topics = Math.max(1, Math.min(8, Math.round(Math.log2(1 + lines / 40))));
  const minutes = Math.max(2, Math.min(25, Math.round(topics * 2.5)));
  return { topics, minutes };
}

export function tourPrompt(context: TourContext): string {
  const { topics, minutes } = budgetFor(context);
  const diff = context.worktree ? `git diff ${context.base}` : `git diff ${context.base}...HEAD`;
  const files = context.files
    .map((file) => `${file.path} (+${file.additions} -${file.deletions})`)
    .join("\n");
  return `You are a senior engineer giving a colleague a guided tour of a pull request${context.title ? ` — "${context.title}"` : ""}. A player will animate your tour over a drawing of the change: it flies between files, boxes lines, draws arrows and reads your narration aloud.

Read the whole change first (\`${diff}\`, and the files themselves). Then answer with ONE JSON object and nothing else.

What to teach
- Split the change into at most ${topics} topics; the whole tour at most ${minutes} minutes of narration (about 14 characters a second).
- Each topic is one flow, told in the order it runs: e.g. the button that starts it, the hook it calls, the controller that receives it, the service, the storage.
- Order topics so each builds on the ones before it: what others depend on comes first.
- Explain decisions: why it is shaped this way, the trade-off, what would break otherwise. Do not just read code aloud.
- When you meet something non-obvious — a serialization trick, an ordering constraint, a gotcha — give it a frame or its own topic where it fits. Do not wander into side branches; skip what is routine.

Shape
{"version":1,"title":string,"topics":[{"id":kebab-case,"title":"2-5 words","summary":"one sentence","frames":[Frame,...]}]}
Frame is one of:
{"kind":"go","file":PATH,"zoom":"card"|"read"|"close","say":TEXT}
{"kind":"focus","file":PATH,"code":LINES,"zoom":...,"say":TEXT}
{"kind":"highlight","file":PATH,"code":LINES,"label":"few words","say":TEXT}
{"kind":"arrow","from":{"file":PATH,"code":LINES},"to":{"file":PATH,"code"?:LINES},"label":"few words","say":TEXT}
{"kind":"diagram","mermaid":MERMAID,"near"?:PATH,"say":TEXT}
{"kind":"say","say":TEXT}
{"kind":"pause","seconds":1-15}
A highlight may add "also":[{"file":PATH,"code":LINES,"label"?:...},...] and an arrow "also":[{"from":...,"to":...,"label"?:...},...] to draw several at once — e.g. five calls the change folds into one, each boxed, or each arrowed to where it now goes. Keep them on one screen: several places in the same file or side by side.
Any frame may add "keep":true to leave earlier highlights and arrows on screen; otherwise they are cleared. Anchors may add "side":"base" for removed code. An arrow's end may leave out "code" to point at the whole file.

Show what you say
- Every frame points at what its sentence is about. The listener must never have to search the screen: if a sentence names a file, a class or a method, that thing is focused, boxed or at the end of an arrow in that frame.
- Naming a file that is not on screen: draw an arrow to it ({"file":PATH} with no code when no particular lines matter), or focus it first. Talking without showing is the one thing a tour must not do.
- One place per frame. Two things far apart are two frames, or one arrow between them; never one sentence about both over a zoomed-out view.
- An arrow between two files is travelled, not shown from afar: the camera stops close on where it leaves, then on its label, then close on where it lands. Write its sentence in that order — the source, then what the label says connects them, then the target — and make the label the few words that name the link.
- Prefer a focus on the source before an arrow that leaves it, so the arrow starts from something the listener already read.

Rules
- PATH: exactly one of the changed files listed below.
- LINES: 1-6 consecutive lines copied verbatim from that file (new version unless side is base), distinctive enough to find. Never line numbers, never coordinates.
- Start every topic with "go" or "focus". Highlight or arrow only what is on screen or about to be.
- "say": 1-2 plain spoken sentences, no markdown, no code blocks; name code as words (e.g. "the save method").
- Pause after a dense explanation, 2-4 seconds.
- "diagram": when a shape explains better than code — a flow across several files, a state machine, the order of calls, before versus after. MERMAID is a small flowchart, sequenceDiagram or stateDiagram (at most ~12 nodes, short labels, no styling, no click directives). It appears in empty space beside "near" and disappears at the next frame; add "keep":true on the next frame to keep talking over it. Use one or two per topic at most, never instead of showing the code.
- Output only the JSON object.

Changed files, dependencies first:
${files}`;
}

/**
 * Asking for a tour to be corrected rather than written again.
 *
 * The change moves under a tour — the reader edits, an agent edits, a review
 * asks for something else — and most of a tour survives that: the flows are
 * the same flows, a few lines moved, a topic belongs earlier. So the agent is
 * handed the tour it wrote and asked for the whole of it back, corrected: what
 * still holds kept, anchors that drifted re-copied from the code as it is now,
 * topics reordered or rewritten where the change or the reviewer says so.
 */
export function revisePrompt(context: TourContext, current: Tour, note?: string): string {
  return `${tourPrompt(context)}

You already wrote a tour of this change; it is below. The change may have moved since, and the reviewer may have asked for corrections. Answer with the WHOLE corrected tour under the same rules:
- Keep topics and frames that still hold. Re-copy any "code" that no longer appears verbatim in the file.
- Drop or rewrite frames about code that is gone; add frames or topics for new code the flow now goes through.
- Reorder or reorganize topics when the dependency order or the reviewer's request calls for it.
${note ? `
The reviewer asks:
${note}
` : ""}
Current tour:
${JSON.stringify(current)}`;
}
