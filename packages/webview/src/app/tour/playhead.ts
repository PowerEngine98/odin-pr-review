import { frameSeconds, type Frame, type Topic } from "@odin/core/tour/tour.js";

import { frameStarts } from "./timeline.js";

/**
 * Where the player is in a topic, and where it goes next.
 *
 * Each frame owns the stretch `frameSeconds` gives it, end to end — the same
 * strip the bar is drawn from — so the timer, the bar and a seek agree about
 * which frame a second belongs to. The voice may run a little long or short of
 * the estimate; the player holds the clock inside the frame it is on, so the
 * bar never claims a frame the narration has not reached.
 *
 * Pure, so it can be tested without a page.
 */

/** When one frame begins, in seconds from the start of the topic. */
export function startOf(topic: Topic, frame: number): number {
  return frameStarts(topic)[clampFrame(topic, frame)] ?? 0;
}

/** When one frame ends, which is when the next one begins. */
export function endOf(topic: Topic, frame: number): number {
  const index = clampFrame(topic, frame);
  return startOf(topic, index) + frameSeconds(topic.frames[index]!);
}

/**
 * The frame on screen at a second of the topic.
 *
 * Before the start is the first frame and past the end is the last, so a seek
 * dragged off either end of the bar lands somewhere real.
 */
export function frameAt(topic: Topic, seconds: number): number {
  const starts = frameStarts(topic);
  let found = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= seconds) found = i;
    else break;
  }
  return found;
}

/**
 * The first frame whose drawing is still on screen at `frame`.
 *
 * A frame clears what came before it unless it says `keep`, so what is drawn at
 * any moment is the run of frames back to the last one that did not keep.
 * Jumping into the middle of a topic redraws that run, and the reader sees what
 * they would have seen had they watched it through.
 */
export function keptFrom(frames: readonly Frame[], frame: number): number {
  let at = Math.max(0, Math.min(frame, frames.length - 1));
  while (at > 0 && frames[at]!.keep) at--;
  return at;
}

/**
 * The frame that last placed the camera, at or before `frame`, or -1.
 *
 * Only "go" and "focus" move it on purpose. Arriving at a highlight by a seek,
 * or playing on after the reader wandered off, is arriving where the last of
 * those left the guide standing.
 */
export function cameraFrom(frames: readonly Frame[], frame: number): number {
  for (let at = Math.min(frame, frames.length - 1); at >= 0; at--) {
    const kind = frames[at]!.kind;
    if (kind === "go" || kind === "focus") return at;
  }
  return -1;
}

/** The frame before or after one, across topics, or nothing at either end. */
export function step(
  topics: readonly Topic[],
  topic: number,
  frame: number,
  by: 1 | -1,
): { topic: number; frame: number } | null {
  const frames = topics[topic]?.frames.length ?? 0;
  const next = frame + by;
  if (next >= 0 && next < frames) return { topic, frame: next };
  if (by > 0) return topic + 1 < topics.length ? { topic: topic + 1, frame: 0 } : null;
  if (topic <= 0) return null;
  return { topic: topic - 1, frame: Math.max(0, topics[topic - 1]!.frames.length - 1) };
}

/**
 * Where the word at `chars` characters into a text starts.
 *
 * For a frame that is not read aloud, whose subtitle still moves along at the
 * pace `frameSeconds` assumes, so the box shows the same progress either way.
 */
export function wordBefore(text: string, chars: number): number {
  let found = 0;
  for (const word of text.matchAll(/\S+/g)) {
    if (word.index > chars) break;
    found = word.index;
  }
  return found;
}

function clampFrame(topic: Topic, frame: number): number {
  return Math.max(0, Math.min(frame, topic.frames.length - 1));
}
