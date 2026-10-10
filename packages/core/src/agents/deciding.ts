/**
 * A decision an agent is waiting on, and what the reader's keys do to it.
 *
 * An agent stops for two kinds of question. It asks whether it may do something
 * it has not been permitted, and it asks the reader to choose between options it
 * has worked out — a library, a scope, a name. In a terminal both are a list you
 * move through with the arrows and settle with return. Inside Odin the second
 * kind had nowhere to go at all, and the first had two buttons.
 *
 * Both are the same shape once written down: a series of questions, each with a
 * few options, some of which take more than one answer and all of which will
 * take an answer that is not on the list. So they are one thing here, and the
 * only difference left is how many questions there are and what is done with
 * the answer at the end.
 *
 * Pure, and that is the point of it being a module rather than a component. The
 * cases that matter are the ones nobody produces on purpose: a multi-select with
 * nothing chosen, an "Other" box with only spaces in it, going back to the
 * second of four questions and changing the answer, a question whose options are
 * all identically labelled. None of those needs a browser to be wrong in.
 */

/** One of the things being offered. */
export interface Choice {
  label: string;
  description: string;
}

/** One question, as the reader is shown it. */
export interface Step {
  /** The two or three words above the circle in the stepper. */
  header: string;
  question: string;
  options: Choice[];
  /** Whether more than one option may be taken. */
  multi: boolean;
}

/**
 * How far through a decision the reader is.
 *
 * `furthest` is kept because the stepper draws the steps behind the reader
 * differently from the ones in front, and because going back is allowed and
 * going forward past where they have reached is not — a step is answered in
 * order or not at all.
 */
export interface Asking {
  steps: Step[];
  /** Which question is on screen. */
  at: number;
  /** The highlighted row, where `options.length` is the row that takes text. */
  cursor: number;
  /** Labels taken, per step. */
  picked: string[][];
  /** What was typed into the row that takes text, per step. */
  written: string[];
  /** Whether the caret is in that box rather than on the list. */
  writing: boolean;
  /** The furthest step reached, which is what the stepper paints behind. */
  furthest: number;
}

/** Everything the reader can press. */
export type Key = "up" | "down" | "left" | "right" | "space" | "enter";

/**
 * A decision with nothing answered yet.
 *
 * The cursor starts on the first option rather than on the text row, because
 * the options are the answer the agent expects and the text row is the escape
 * from them.
 */
export function asking(steps: Step[]): Asking {
  return {
    steps,
    at: 0,
    cursor: 0,
    picked: steps.map(() => []),
    written: steps.map(() => ""),
    writing: false,
    furthest: 0,
  };
}

/** The row that takes typing, which sits after the options. */
export function otherRow(step: Step): number {
  return step.options.length;
}

/** Whether the reader is standing on that row. */
export function onOther(state: Asking): boolean {
  const step = state.steps[state.at];
  return step !== undefined && state.cursor === otherRow(step);
}

/**
 * Whether return would do anything at all.
 *
 * A step is answerable when there is something to answer it with: an option
 * under the cursor, or text in the box. "Nothing" is never an answer — the
 * agent is blocked until one arrives, so an empty return would be a key that
 * silently does nothing while somebody waits.
 */
export function answerable(state: Asking): boolean {
  const step = state.steps[state.at];
  if (!step) return false;
  if (onOther(state)) return (state.written[state.at] ?? "").trim() !== "";
  // Multi-select with things already ticked is answerable even though the
  // cursor is only resting somewhere; with nothing ticked, the cursor's own
  // row is what return would take.
  return step.options.length > 0;
}

/** Whether this is the last question. */
export function last(state: Asking): boolean {
  return state.at >= state.steps.length - 1;
}

/**
 * The reader pressed something.
 *
 * Returns the state afterwards and, when the last question has just been
 * settled, `done` — which is the signal to send the answer and take the
 * decision off the screen. Nothing here sends anything; a pure function that
 * reached a socket would be a pure function nobody could test.
 */
export function pressed(state: Asking, key: Key): { next: Asking; done?: boolean } {
  const step = state.steps[state.at];
  if (!step) return { next: state };

  const rows = otherRow(step) + 1;

  switch (key) {
    case "up":
    case "down": {
      // Typing is typing: the arrows move the caret inside the box rather than
      // leaving it, until the reader says they are finished with it.
      if (state.writing) return { next: state };
      const by = key === "down" ? 1 : -1;
      // Wrapped, because the list is short and the alternative is an arrow that
      // stops working at the ends for no reason the reader can see.
      return { next: { ...state, cursor: (state.cursor + by + rows) % rows } };
    }

    case "space": {
      if (state.writing || !step.multi || onOther(state)) return { next: state };
      const label = step.options[state.cursor]?.label;
      if (label === undefined) return { next: state };
      return { next: withToggled(state, label) };
    }

    case "left":
    case "right": {
      if (state.writing) return { next: state };
      const to = state.at + (key === "right" ? 1 : -1);
      // Never past where they have got to: a question is answered in order, and
      // skipping to the last one would leave the ones behind it unanswered with
      // nothing saying so.
      if (to < 0 || to > state.furthest || to >= state.steps.length) return { next: state };
      return { next: { ...state, at: to, cursor: cursorFor(state, to), writing: false } };
    }

    case "enter": {
      if (!answerable(state)) return { next: state };
      const taken = onOther(state)
        ? [(state.written[state.at] ?? "").trim()]
        : step.multi && (state.picked[state.at] ?? []).length > 0
          ? state.picked[state.at]!
          : [step.options[state.cursor]!.label];

      const picked = state.picked.map((held, at) => (at === state.at ? taken : held));
      const settled = { ...state, picked, writing: false };
      if (last(settled)) return { next: settled, done: true };

      const at = settled.at + 1;
      return {
        next: {
          ...settled,
          at,
          furthest: Math.max(settled.furthest, at),
          cursor: cursorFor(settled, at),
        },
      };
    }
  }
}

/** What was typed, which is a different kind of event from a key. */
export function typed(state: Asking, text: string): Asking {
  const step = state.steps[state.at];
  if (!step) return state;
  return {
    ...state,
    // Typing is how the reader says they mean the box, so it takes the cursor
    // with it — otherwise the caret is in one place and the highlight in
    // another, and return takes the highlighted one.
    cursor: otherRow(step),
    writing: true,
    written: state.written.map((held, at) => (at === state.at ? text : held)),
  };
}

/** The caret leaving the box without the step being answered. */
export function stoppedWriting(state: Asking): Asking {
  return { ...state, writing: false };
}

/**
 * Where the highlight should sit on arriving at a step.
 *
 * On what was answered, when it was answered before — a reader going back to
 * change something should find the thing they chose under the highlight rather
 * than the first option. On the text row when the answer was typed.
 */
function cursorFor(state: Asking, at: number): number {
  const step = state.steps[at];
  if (!step) return 0;
  const taken = state.picked[at] ?? [];
  if (taken.length === 0) return 0;
  const found = step.options.findIndex((option) => option.label === taken[0]);
  return found >= 0 ? found : otherRow(step);
}

function withToggled(state: Asking, label: string): Asking {
  const held = state.picked[state.at] ?? [];
  const next = held.includes(label)
    ? held.filter((one) => one !== label)
    : [...held, label];
  return { ...state, picked: state.picked.map((one, at) => (at === state.at ? next : one)) };
}

/**
 * The answer, in the shape the asking tool reads back.
 *
 * Keyed by the question's own text and joined with a comma where more than one
 * option was taken — measured against the tool rather than guessed: answering a
 * multi-select with `"Window, Door"` comes back to the agent as both, and an
 * answer that is on no list at all comes back verbatim.
 *
 * Every question is in it, including any the reader never reached, which cannot
 * happen through the keys above but can through a page that sent early.
 */
export function answersOf(state: Asking): Record<string, string> {
  const out: Record<string, string> = {};
  state.steps.forEach((step, at) => {
    out[step.question] = (state.picked[at] ?? []).join(", ");
  });
  return out;
}

/**
 * The questions an asking tool sent, as steps, or nothing when it sent none.
 *
 * Defensive about every field, because this arrives from another process over a
 * socket: a question with no options is a step the reader cannot answer and the
 * agent would wait on for ever, so it is refused here rather than drawn.
 */
export function stepsIn(input: unknown): Step[] | undefined {
  const held = (input ?? {}) as { questions?: unknown };
  if (!Array.isArray(held.questions)) return undefined;

  const steps: Step[] = [];
  for (const one of held.questions) {
    const question = one as Record<string, unknown>;
    const text = typeof question.question === "string" ? question.question : "";
    const options = Array.isArray(question.options) ? question.options : [];
    const choices: Choice[] = [];
    for (const option of options) {
      const held = option as Record<string, unknown>;
      if (typeof held.label !== "string" || !held.label) continue;
      choices.push({
        label: held.label,
        description: typeof held.description === "string" ? held.description : "",
      });
    }
    if (!text || choices.length === 0) continue;
    steps.push({
      header: typeof question.header === "string" && question.header ? question.header : text,
      question: text,
      options: choices,
      multi: question.multiSelect === true,
    });
  }
  return steps.length > 0 ? steps : undefined;
}
