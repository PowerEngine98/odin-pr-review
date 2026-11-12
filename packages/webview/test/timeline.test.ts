import { describe, expect, it } from "vitest";

import { frameSeconds, topicSeconds, type Topic } from "@odin/core/tour/tour.js";

import {
  fractionAt,
  frameStarts,
  markerPositions,
  secondsAt,
  spokenRuns,
} from "../src/app/tour/timeline.js";

/**
 * A topic laid along the player's bar: where each frame's marker sits, what a
 * press on the bar seeks to, and which word of a subtitle is being said.
 */
const topic: Topic = {
  id: "saving",
  title: "Saving a draft",
  summary: "How a draft reaches the store.",
  frames: [
    { kind: "go", file: "src/form.ts", say: "The form starts it." },
    { kind: "highlight", file: "src/form.ts", code: "save()", say: "Pressing save calls this." },
    { kind: "pause", seconds: 3 },
    { kind: "say", say: "And that is the whole trip." },
  ],
};

describe("frame markers", () => {
  it("starts each frame where the one before it ends", () => {
    const starts = frameStarts(topic);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeCloseTo(starts[i - 1]! + frameSeconds(topic.frames[i - 1]!));
    }
  });

  it("places markers as fractions of the topic, the first at the left edge", () => {
    const at = markerPositions(topic);
    expect(at).toHaveLength(topic.frames.length);
    expect(at[0]).toBe(0);
    expect(at.every((one, i) => i === 0 || one > at[i - 1]!)).toBe(true);
    expect(at[at.length - 1]!).toBeLessThan(1);
    const total = topicSeconds(topic);
    expect(at[2]).toBeCloseTo(frameStarts(topic)[2]! / total);
  });

  it("puts every marker at the start of a topic with no running time", () => {
    expect(markerPositions({ ...topic, frames: [] })).toEqual([]);
  });
});

describe("seeking", () => {
  it("turns a point on the bar into seconds and back", () => {
    const total = topicSeconds(topic);
    expect(secondsAt(topic, 0.5)).toBeCloseTo(total / 2);
    expect(fractionAt(topic, total / 4)).toBeCloseTo(0.25);
  });

  it("clamps a drag past either end", () => {
    expect(secondsAt(topic, -0.3)).toBe(0);
    expect(secondsAt(topic, 1.4)).toBeCloseTo(topicSeconds(topic));
    expect(fractionAt(topic, 9999)).toBe(1);
  });
});

describe("the spoken word", () => {
  const text = "Pressing save calls this.";

  const words = (runs: ReturnType<typeof spokenRuns>) => runs.filter((run) => run.text.trim());

  it("marks the word the offset falls in", () => {
    const runs = spokenRuns(text, 10);
    expect(words(runs).map((run) => run.state)).toEqual(["said", "now", "ahead", "ahead"]);
    expect(words(runs)[1]!.text.trim()).toBe("save");
  });

  it("boxes the word alone, never the space after it", () => {
    const now = spokenRuns("In the API, pricing", 0).filter((run) => run.state === "now");
    expect(now.map((run) => run.text)).toEqual(["In"]);
    expect(spokenRuns(text, 10).find((run) => run.state === "now")!.text).toBe("save");
  });

  it("gives back the text when joined", () => {
    expect(spokenRuns(`  ${text}`, 4).map((run) => run.text).join("")).toBe(`  ${text}`);
  });

  it("marks the next word when the offset is on a space", () => {
    expect(words(spokenRuns(text, 8)).map((run) => run.state)).toEqual(["said", "now", "ahead", "ahead"]);
  });

  it("has said everything at the end", () => {
    expect(spokenRuns(text, text.length).every((run) => run.state === "said")).toBe(true);
  });

  it("is nothing for no subtitle", () => {
    expect(spokenRuns("", 0)).toEqual([]);
  });
});
