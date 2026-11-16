import { describe, expect, it } from "vitest";

import { Lanes } from "../src/lanes.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("work the reader asked for, ahead of work done for them", () => {
  it("runs background work one at a time, in order", async () => {
    const lanes = new Lanes();
    const done: string[] = [];
    let release!: () => void;
    lanes.later(() => new Promise<void>((resolve) => (release = () => {
      done.push("a");
      resolve();
    })));
    lanes.later(async () => void done.push("b"));
    await tick();
    expect(done).toEqual([]);
    release();
    await tick();
    expect(done).toEqual(["a", "b"]);
  });

  it("holds background work back while something clicked is running, then carries on", async () => {
    const lanes = new Lanes();
    const done: string[] = [];
    let finish!: () => void;
    const clicked = lanes.now(() => new Promise<void>((resolve) => (finish = () => {
      done.push("clicked");
      resolve();
    })));
    lanes.later(async () => void done.push("background"));
    await tick();
    expect(done).toEqual([]);
    finish();
    await clicked;
    await tick();
    expect(done).toEqual(["clicked", "background"]);
  });

  it("forgets queued work for a question nobody is asking any more", async () => {
    const lanes = new Lanes();
    const done: string[] = [];
    let release!: () => void;
    lanes.later(() => new Promise<void>((resolve) => (release = resolve)));
    lanes.later(async () => void done.push("stale"));
    lanes.clear();
    lanes.later(async () => void done.push("fresh"));
    release();
    await tick();
    expect(done).toEqual(["fresh"]);
  });

  it("keeps going after a background task fails", async () => {
    const lanes = new Lanes();
    const done: string[] = [];
    lanes.later(async () => {
      throw new Error("forge timed out");
    });
    lanes.later(async () => void done.push("next"));
    await tick();
    expect(done).toEqual(["next"]);
  });
});
