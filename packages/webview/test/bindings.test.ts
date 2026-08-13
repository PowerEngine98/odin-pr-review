import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  defaults,
  KEYS_KEY,
  readKeys,
  waitFor,
  waitingFor,
  type Store,
} from "../src/app/shared/bindings.js";
import * as keys from "../src/app/canvas/keys.js";

const held = (value: string | null): Store => ({ getItem: () => value });

describe("the one bindings table", () => {
  it("is the same table the canvas acts on", () => {
    // The point of the module. Two copies of this list is the arrangement this
    // replaced, and the way it failed was silent: the panel drew a key the
    // canvas had stopped obeying.
    expect(keys.ACTIONS).toBe(ACTIONS);
  });

  it("still says what it has always said", () => {
    // Spelled out rather than derived, so that moving the table cannot quietly
    // change what is in it. A binding that does something different after a
    // refactor is a regression however tidy the refactor was.
    expect(ACTIONS.map((action) => [action.id, action.key])).toEqual([
      ["fit", "h"],
      ["open", "F"],
      ["read", "Enter"],
      ["comment", "c"],
      ["right", "ArrowRight"],
      ["left", "ArrowLeft"],
      ["down", "ArrowDown"],
      ["up", "ArrowUp"],
      ["clear", "Escape"],
    ]);
  });

  it("names every action for the panel to draw", () => {
    for (const action of ACTIONS) expect(action.says).not.toBe("");
  });

  it("hands out defaults nobody else can edit", () => {
    // The panel resets by taking a copy and putting it in reactive state, and a
    // shared object handed out twice would be rebound for everyone at once.
    const mine = defaults();
    mine.fit = "z";
    expect(defaults().fit).toBe("h");
    expect(ACTIONS.find((action) => action.id === "fit")?.key).toBe("h");
  });
});

describe("what the reader chose", () => {
  it("is kept where both sides look for it", () => {
    // The panel writes this name and the canvas reads it. Were they to disagree
    // about the spelling, rebinding would appear to work and then do nothing.
    expect(KEYS_KEY).toBe("odin.keys");
    const store: Store = { getItem: (key) => (key === KEYS_KEY ? '{"fit":"z"}' : null) };
    expect(readKeys(store).fit).toBe("z");
  });

  it("survives a file that says nothing about most actions", () => {
    expect(readKeys(held('{"comment":"k"}'))).toEqual({ ...defaults(), comment: "k" });
  });
});

describe("the panel listening for a key", () => {
  it("says so where a handler with no runes in it can ask", () => {
    // The canvas sees the answering press first, on the document. Without this
    // it would obey the key on its way past, and binding "comment" to `c` would
    // open a composer as it was bound.
    expect(waitingFor()).toBeNull();
    waitFor("comment");
    expect(waitingFor()).toBe("comment");
    waitFor(null);
    expect(waitingFor()).toBeNull();
  });
});
