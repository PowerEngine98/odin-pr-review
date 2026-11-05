/**
 * Who does the speaking, best first: Kokoro, the system's own voice, the
 * browser's.
 *
 * Kokoro is a neural voice the host runs on this machine once it has set it up.
 * It hands back each sentence as audio, which is played here — and because the
 * length of that audio is known before it starts, the word being spoken is
 * placed along it by where each word falls in the sentence. The next sentence is
 * asked for while this one plays, so there is no gap between them.
 *
 * The system voice is the one chosen in the operating system's settings. It is
 * spoken by the host, which reports when a sentence starts and ends but not
 * where in it the voice is, so the word is worked out from how fast the voice
 * has been going, learned from the sentences it has already finished. The
 * browser's voice reports each word itself.
 *
 * Each is only used when the reader has asked for it, and the first time the
 * host says one cannot be reached the next one down takes over for good.
 */

import { host, notify, settings } from "../state.svelte.js";

/** Starts of words in a spoken text, by character. */
type OnWord = (index: number) => void;

/** Whether the host has shown it can speak — until it fails once. */
let reachable = host !== null;
/** Whether the host has Kokoro set up — until it says it has not. */
let kokoroUp = host !== null;
let asked = 0;
/** Bumped by every silence, so audio that arrives for a stopped reading is dropped. */
let turn = 0;
let timers: ReturnType<typeof setTimeout>[] = [];
/** Characters a second, as the system voice has actually been going. */
let pace = 14;

const waiting = new Map<number, { text: string; onWord: OnWord; done: () => void; at: number }>();
const rendering = new Map<number, (audio: string | null) => void>();
/** Sentences Kokoro has been asked for, by their text, ready or on the way. */
const rendered = new Map<string, Promise<AudioBuffer | null>>();

let context: AudioContext | undefined;
let playing: AudioBufferSourceNode | undefined;
let listening = false;

/*
 * Audio a page may only start after the reader has touched it. Narration that
 * begins on its own — new content read aloud — arrives before any touch, and
 * its context stays suspended: no sound, and no end to wait for. The first
 * press anywhere wakes it.
 */
let waking = false;
function wakeOnTouch(): void {
  if (waking || typeof window === "undefined") return;
  waking = true;
  const wake = () => void context?.resume();
  window.addEventListener("pointerdown", wake, { capture: true });
  window.addEventListener("keydown", wake, { capture: true });
}

function listen(): void {
  wakeOnTouch();
  if (listening) return;
  listening = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as
      | { type?: string; id?: number; ok?: boolean; audio?: string; unavailable?: boolean }
      | undefined;
    if (!message || typeof message.id !== "number") return;
    if (message.type === "spoken") {
      const answer = rendering.get(message.id);
      rendering.delete(message.id);
      if (message.unavailable) kokoroUp = false;
      answer?.(message.ok && message.audio ? message.audio : null);
      return;
    }
    const one = waiting.get(message.id);
    if (!one) return;
    if (message.type === "saying") {
      one.at = performance.now();
      follow(one.text, one.onWord, pace);
      return;
    }
    if (message.type !== "said") return;
    waiting.delete(message.id);
    stopFollowing();
    if (message.ok) {
      const took = (performance.now() - one.at) / 1000;
      if (one.at > 0 && took > 0.3) pace = (pace + one.text.length / took) / 2;
      one.done();
      return;
    }
    reachable = false;
    browser(one.text, one.onWord, one.done);
  });
}

function kokoro(): boolean {
  return kokoroUp && settings.kokoroVoice;
}

function system(): boolean {
  return reachable && settings.systemVoice;
}

export function canSpeak(): boolean {
  return kokoro() || system() || typeof speechSynthesis !== "undefined";
}

/** Asks for a sentence ahead of time, so it is ready when its turn comes. */
export function prepare(text: string): void {
  if (kokoro()) void render(text);
}

/** Speaks one sentence, telling `onWord` where each word starts, then `done`. */
export function utter(text: string, onWord: OnWord, done: () => void): void {
  if (!kokoro()) {
    fallBack(text, onWord, done);
    return;
  }
  const mine = turn;
  void render(text).then((buffer) => {
    rendered.delete(text);
    if (mine !== turn) return;
    if (buffer) play(buffer, text, onWord, done);
    else if (!kokoroUp) fallBack(text, onWord, done);
    else done();
  });
}

export function silence(): void {
  turn++;
  waiting.clear();
  rendered.clear();
  stopFollowing();
  const source = playing;
  playing = undefined;
  source?.stop();
  if (reachable) notify("hush");
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

function fallBack(text: string, onWord: OnWord, done: () => void): void {
  if (!system()) {
    browser(text, onWord, done);
    return;
  }
  listen();
  const id = ++asked;
  waiting.set(id, { text, onWord, done, at: 0 });
  notify("say", { id, text });
}

function render(text: string): Promise<AudioBuffer | null> {
  const held = rendered.get(text);
  if (held) return held;
  listen();
  const id = ++asked;
  const audio = new Promise<string | null>((resolve) => rendering.set(id, resolve)).then(
    async (base64) => {
      if (!base64) return null;
      try {
        context ??= new AudioContext();
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        return await context.decodeAudioData(bytes.buffer);
      } catch {
        return null;
      }
    },
  );
  rendered.set(text, audio);
  notify("speak", { id, text });
  return audio;
}

function play(buffer: AudioBuffer, text: string, onWord: OnWord, done: () => void): void {
  context ??= new AudioContext();
  const audio = context;
  wakeOnTouch();
  void audio.resume();
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const mine = turn;
  let over = false;
  let guard: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (over) return;
    over = true;
    if (guard) clearTimeout(guard);
    if (playing === source) playing = undefined;
    stopFollowing();
    if (mine === turn) done();
  };
  source.onended = () => {
    if (playing !== source) return;
    finish();
  };
  playing = source;
  source.start();
  follow(text, onWord, text.length / Math.max(buffer.duration, 0.1));
  /*
   * A suspended context never plays and never ends. Not waited on forever: if
   * it has not woken shortly, the sentence is given in another voice; and
   * whatever happens, it is over by the time its audio would have been.
   */
  setTimeout(() => {
    if (over || audio.state === "running" || mine !== turn) return;
    over = true;
    if (guard) clearTimeout(guard);
    playing = undefined;
    try {
      source.stop();
    } catch {
      /* never started */
    }
    stopFollowing();
    fallBack(text, onWord, done);
  }, 400);
  guard = setTimeout(finish, (buffer.duration + 1.5) * 1000);
}

function browser(text: string, onWord: OnWord, done: () => void): void {
  if (typeof speechSynthesis === "undefined") {
    done();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onboundary = (event) => {
    if (event.name === "word") onWord(event.charIndex);
  };
  utterance.onend = done;
  utterance.onerror = done;
  speechSynthesis.speak(utterance);
}

/** Moves the word along a sentence at `speed` characters a second. */
function follow(text: string, onWord: OnWord, speed: number): void {
  stopFollowing();
  for (const word of text.matchAll(/\S+/g)) {
    timers.push(setTimeout(() => onWord(word.index), (word.index / speed) * 1000));
  }
}

function stopFollowing(): void {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}
