import { describe, expect, it } from "vitest";

import {
  answerable,
  answersOf,
  asking,
  onOther,
  pressed,
  stepsIn,
  stoppedWriting,
  typed,
  type Asking,
  type Key,
  type Step,
} from "../src/agents/deciding.js";

const COLOUR: Step = {
  header: "Colour",
  question: "Which colour for the shed?",
  options: [
    { label: "Red", description: "Loud." },
    { label: "Blue", description: "Quiet." },
  ],
  multi: false,
};

const EXTRAS: Step = {
  header: "Extras",
  question: "Which extras?",
  options: [
    { label: "Window", description: "" },
    { label: "Door", description: "" },
    { label: "Shelf", description: "" },
  ],
  multi: true,
};

/** A run of keys, because that is how a reader actually arrives anywhere. */
function press(state: Asking, ...keys: Key[]): { next: Asking; done?: boolean } {
  let held: { next: Asking; done?: boolean } = { next: state };
  for (const key of keys) held = pressed(held.next, key);
  return held;
}

describe("moving through the options", () => {
  it("starts on the first option rather than on the box that takes typing", () => {
    // The options are the answer the agent expects; the box is the escape.
    const state = asking([COLOUR]);
    expect(state.cursor).toBe(0);
    expect(onOther(state)).toBe(false);
  });

  it("walks down and back up", () => {
    const state = asking([COLOUR]);
    expect(press(state, "down").next.cursor).toBe(1);
    expect(press(state, "down", "up").next.cursor).toBe(0);
  });

  it("wraps at both ends", () => {
    /*
     * Two options plus the row that takes typing is three rows, so down three
     * times is back where it started. Wrapped rather than clamped because the
     * list is short and an arrow that stops working at the end looks broken.
     */
    const state = asking([COLOUR]);
    expect(press(state, "down", "down", "down").next.cursor).toBe(0);
    expect(press(state, "up").next.cursor).toBe(2);
  });
});

describe("answering one question", () => {
  it("takes the option under the cursor", () => {
    const { next, done } = press(asking([COLOUR]), "down", "enter");
    expect(done).toBe(true);
    expect(answersOf(next)).toEqual({ "Which colour for the shed?": "Blue" });
  });

  it("says it is finished only on the last question", () => {
    const two = asking([COLOUR, EXTRAS]);
    expect(press(two, "enter").done).toBeUndefined();
    expect(press(two, "enter", "enter").done).toBe(true);
  });

  it("moves to the next question when one is settled", () => {
    const { next } = press(asking([COLOUR, EXTRAS]), "enter");
    expect(next.at).toBe(1);
    expect(next.furthest).toBe(1);
  });
});

describe("a question that takes more than one answer", () => {
  it("ticks and unticks with the space bar", () => {
    const state = asking([EXTRAS]);
    const ticked = press(state, "space", "down", "space");
    expect(ticked.next.picked[0]).toEqual(["Window", "Door"]);
    expect(press(ticked.next, "space").next.picked[0]).toEqual(["Window"]);
  });

  it("joins what was ticked the way the tool reads it back", () => {
    // Measured against the tool: answering with "Window, Door" comes back to
    // the agent as both of them.
    const { next } = press(asking([EXTRAS]), "space", "down", "space", "enter");
    expect(answersOf(next)).toEqual({ "Which extras?": "Window, Door" });
  });

  it("takes the row under the cursor when nothing was ticked", () => {
    /*
     * Return on a multi-select with nothing ticked used to be a key that did
     * nothing while an agent waited. The cursor is resting on a row and that
     * row is plainly what return means.
     */
    const { next, done } = press(asking([EXTRAS]), "down", "down", "enter");
    expect(done).toBe(true);
    expect(answersOf(next)).toEqual({ "Which extras?": "Shelf" });
  });

  it("ignores the space bar where only one answer is wanted", () => {
    const state = asking([COLOUR]);
    expect(press(state, "space").next.picked[0]).toEqual([]);
  });
});

describe("an answer that is on no list", () => {
  it("takes what was typed", () => {
    // Confirmed against the tool: an answer that is on no list comes back to
    // the agent verbatim.
    const state = typed(asking([COLOUR]), "Purple with yellow spots");
    const { next, done } = pressed(state, "enter");
    expect(done).toBe(true);
    expect(answersOf(next)).toEqual({
      "Which colour for the shed?": "Purple with yellow spots",
    });
  });

  it("moves the highlight to the box, so return takes what is in it", () => {
    // Otherwise the caret is in one place and the highlight in another, and
    // return takes the highlighted one — which is not what was typed.
    const state = typed(asking([COLOUR]), "Green");
    expect(onOther(state)).toBe(true);
    expect(state.writing).toBe(true);
  });

  it("refuses an empty box, and one holding only spaces", () => {
    const empty = typed(asking([COLOUR]), "   ");
    expect(answerable(empty)).toBe(false);
    expect(pressed(empty, "enter").done).toBeUndefined();
  });

  it("leaves the arrows to the caret while the reader is typing", () => {
    /*
     * The whole point of the box is that it takes text, and a reader moving the
     * caret along a line they have just written must not have the highlight
     * jump off it and take the answer with it.
     */
    const state = typed(asking([COLOUR]), "Gre");
    expect(pressed(state, "up").next.cursor).toBe(state.cursor);
    expect(pressed(state, "down").next.cursor).toBe(state.cursor);
    // And once they are finished with it, the arrows are the list's again.
    expect(pressed(stoppedWriting(state), "up").next.cursor).not.toBe(state.cursor);
  });
});

describe("going back to something already answered", () => {
  it("returns to the step and shows what was chosen there", () => {
    // A reader who goes back to change an answer should find the one they gave
    // under the highlight, not the first option.
    const { next } = press(asking([COLOUR, EXTRAS]), "down", "enter", "left");
    expect(next.at).toBe(0);
    expect(next.cursor).toBe(1);
  });

  it("lets the answer be changed, and keeps the rest", () => {
    const back = press(asking([COLOUR, EXTRAS]), "enter", "left").next;
    const changed = press(back, "down", "enter").next;
    expect(changed.picked[0]).toEqual(["Blue"]);
    expect(changed.at).toBe(1);
  });

  it("will not go forward past where the reader has reached", () => {
    /*
     * A question is answered in order or not at all. Skipping to the last one
     * would leave the ones behind it unanswered with nothing saying so, and the
     * agent would be handed a blank for a question it asked.
     */
    const state = asking([COLOUR, EXTRAS]);
    expect(press(state, "right").next.at).toBe(0);
  });

  it("will not go back past the first", () => {
    expect(press(asking([COLOUR]), "left").next.at).toBe(0);
  });

  it("puts the highlight on the box when the answer there was typed", () => {
    const written = typed(asking([COLOUR, EXTRAS]), "Chartreuse");
    const back = press(pressed(written, "enter").next, "left").next;
    expect(onOther(back)).toBe(true);
  });
});

describe("the questions an agent sent", () => {
  const sent = {
    questions: [
      {
        question: "Which colour?",
        header: "Colour",
        options: [{ label: "Red", description: "Loud." }],
        multiSelect: false,
      },
    ],
  };

  it("reads what the tool actually sends", () => {
    // The shape here was taken off the socket rather than from documentation.
    expect(stepsIn(sent)).toEqual([
      {
        header: "Colour",
        question: "Which colour?",
        options: [{ label: "Red", description: "Loud." }],
        multi: false,
      },
    ]);
  });

  it("carries multiSelect across", () => {
    const multi = { questions: [{ ...sent.questions[0], multiSelect: true }] };
    expect(stepsIn(multi)?.[0]?.multi).toBe(true);
  });

  it("falls back to the question itself when there is no header", () => {
    const bare = { questions: [{ ...sent.questions[0], header: undefined }] };
    expect(stepsIn(bare)?.[0]?.header).toBe("Which colour?");
  });

  it("refuses a question with nothing to answer it with", () => {
    /*
     * This arrives from another process. A question with no options is one the
     * reader cannot answer and the agent would wait on for ever, so it is
     * refused here rather than drawn as an empty list.
     */
    expect(stepsIn({ questions: [{ question: "Well?", options: [] }] })).toBeUndefined();
    expect(stepsIn({ questions: [{ options: [{ label: "Red" }] }] })).toBeUndefined();
  });

  it("refuses anything that is not a set of questions", () => {
    expect(stepsIn(undefined)).toBeUndefined();
    expect(stepsIn({})).toBeUndefined();
    expect(stepsIn({ questions: "lots" })).toBeUndefined();
    expect(stepsIn({ questions: [] })).toBeUndefined();
  });

  it("drops an option with no label and keeps the rest", () => {
    const mixed = {
      questions: [
        {
          question: "Which?",
          options: [{ description: "no label" }, { label: "Red", description: "" }],
        },
      ],
    };
    expect(stepsIn(mixed)?.[0]?.options).toEqual([{ label: "Red", description: "" }]);
  });
});
