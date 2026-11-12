import { frameSeconds, topicSeconds, type Topic } from "@odin/core/tour/tour.js";

/**
 * A topic laid out along a player's bar.
 *
 * Kept apart from the controls so the arithmetic can be tested: a component
 * cannot be, here, and a marker a few per cent off its frame is a seek that
 * lands in the middle of the sentence before the one the reader aimed at.
 */

/** Seconds into the topic at which each frame comes on screen. */
export function frameStarts(topic: Topic): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const frame of topic.frames) {
    starts.push(at);
    at += frameSeconds(frame);
  }
  return starts;
}

/**
 * Where each frame's marker sits on the bar, from 0 at the left to 1 at the
 * right. A topic with no running time has every frame at its start.
 */
export function markerPositions(topic: Topic): number[] {
  const total = topicSeconds(topic);
  if (total <= 0) return topic.frames.map(() => 0);
  return frameStarts(topic).map((start) => start / total);
}

/** The seconds a point on the bar stands for, clamped to the topic. */
export function secondsAt(topic: Topic, fraction: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return clamped * topicSeconds(topic);
}

/** How far along the bar the reader is, from 0 to 1. */
export function fractionAt(topic: Topic, seconds: number): number {
  const total = topicSeconds(topic);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, seconds / total));
}

/** A run of a subtitle, and whether the voice has passed it, is on it, or has yet to reach it. */
export interface Spoken {
  text: string;
  state: "said" | "now" | "ahead";
}

/**
 * A subtitle cut at the word being spoken.
 *
 * `spokenTo` is a character offset into the text: the word that contains it,
 * or the next word when it falls on a space, is the one being said. Words and
 * the whitespace between them are separate runs, so only the word is boxed, and
 * joining the runs gives back the text.
 * At or past the end, everything has been said.
 */
export function spokenRuns(text: string, spokenTo: number): Spoken[] {
  if (!text) return [];
  const runs: Spoken[] = [];
  const words = /\S+\s*/g;
  let found = false;
  let match: RegExpExecArray | null;
  const lead = /^\s*/.exec(text)![0];
  if (lead) runs.push({ text: lead, state: spokenTo > 0 ? "said" : "ahead" });
  while ((match = words.exec(text))) {
    const start = match.index;
    const end = start + match[0].trimEnd().length;
    let state: Spoken["state"];
    if (found) state = "ahead";
    else if (spokenTo >= text.length) state = "said";
    else if (spokenTo < end) {
      state = "now";
      found = true;
    } else state = "said";
    const word = match[0].slice(0, end - start);
    const gap = match[0].slice(end - start);
    runs.push({ text: word, state });
    if (gap) runs.push({ text: gap, state: state === "now" ? "said" : state });
  }
  return runs;
}
