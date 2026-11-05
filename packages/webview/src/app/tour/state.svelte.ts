/**
 * "Give me a tour": what the page knows about the tour, shared by the player,
 * its controls and the agent panel's Tour tab.
 *
 * The host makes the tour (an agent reads the change and answers with the JSON
 * in `@odin/core/tour/tour.js`), keeps it on disk with the reader's progress, and
 * hands both to the page. The page plays it.
 *
 * Messages, page → host:
 *   "tourMake"     { fresh?: boolean }   make one, or make it again
 *   "tourCancel"   {}                    stop making one
 *   "tourProgress" { topic, frame, watched, frames }  where the reader is, to keep
 *   "tourMode"     { on: boolean }       entering or leaving the tour, so the
 *                                        host can put its side bar away and back
 * Messages, host → page:
 *   "tour"         { tour, progress?: { topic, frame, watched, frames }, stale?: boolean }
 *   "tourStatus"   { status: "none" | "making" | "failed", note?: string }
 */

import type { Tour } from "@odin/core/tour/tour.js";

export type TourStatus = "none" | "making" | "ready" | "failed";

/** Something a frame drew, found in the code where it is now. */
export interface Mark {
  kind: "highlight" | "arrow";
  /** For a highlight: the card and the lines. For an arrow: where it starts. */
  nodeId: string;
  side: "head" | "base";
  start: number;
  end: number;
  /** An arrow's other end. */
  to?: { nodeId: string; side: "head" | "base"; start: number; end: number };
  label?: string;
}

/** A frame the reader took into the conversation: what it said, and where it pointed. */
export interface Attached {
  topic: number;
  topicTitle: string;
  /** One-based, as the reader counts frames. */
  frame: number;
  say: string;
  file?: string;
  code?: string;
  side?: "head" | "base";
  start?: number;
  end?: number;
}

export const tour = $state({
  status: "none" as TourStatus,
  /** What the host last said while making one: a step, or why it failed. */
  note: "",
  data: null as Tour | null,
  /** The tour was made for an earlier state of the change. */
  stale: false,

  /** In tour mode: the canvas is the player's, the side bar and the map are away. */
  active: false,
  /** Frames are advancing on their own. Paused, the reader may move about. */
  playing: false,
  topic: 0,
  frame: 0,
  /** Ids of the topics played to their end. */
  watched: [] as string[],
  frames: {} as Record<string, number>,

  /** Seconds into the current topic, for the timer and the progress bar. */
  elapsed: 0,
  /** What the narrator is saying now, and how far through it the voice is. */
  subtitle: "",
  spokenTo: 0,
  /** The last jump through the tour, for the edges of the screen to show: +5s, −12s. */
  jump: null as { seconds: number; id: number } | null,
  /** The reader's last play or pause, for the middle of the screen to answer. */
  flash: null as { playing: boolean; id: number } | null,
  /** The diagram a frame drew, where it stands on the canvas, until the frame ends. */
  diagram: null as { id: number; code: string; x: number; y: number; width: number; height: number } | null,
  /** What the current frames have drawn on the canvas. */
  marks: [] as Mark[],
  /** The frame waiting in an agent's composer, to be argued with. */
  attached: null as Attached | null,
  /** The voice is reading a frame right now. */
  speaking: false,
  /** The narrator reads the tour aloud. Subtitles show either way. */
  narrated: true,
});
