<!--
  A question an agent has stopped on, and the reader answering it.

  An agent asks two kinds of thing. It asks whether it may do something — which
  is a yes or a no, and has had two buttons for a while — and it asks the reader
  to choose between options it has worked out. The second kind had nowhere to go
  at all: the rung marked "Ask" said so in its own description, and a question
  arrived as a line in a log that nobody could answer. The agent then waited,
  with no timeout, for the rest of the session.

  So this is drawn the way a terminal draws it, because that is the thing it has
  to be as good as: a row of steps, a list to move through with the arrows, and
  return to settle. Every question also takes an answer that is on none of the
  lists, because the useful answer often is not.

  The arithmetic — what each key does, what is answerable, how a multi-select
  joins — is in `deciding.ts` and not here. This draws a state and reports keys.
-->
<script lang="ts">
  import {
    answerable,
    answersOf,
    asking,
    last,
    onOther,
    otherRow,
    pressed,
    stoppedWriting,
    typed,
    type Asking,
    type Key,
    type Step,
  } from "@odin/core/agents/deciding.js";

  import { notify, ui } from "../state.svelte.js";

  /**
   * The question on screen, which is the first one waiting.
   *
   * One at a time on purpose. Two agents stopped at once is two stoppages, and
   * a reader shown both would be choosing a library for one while reading the
   * question from the other.
   */
  const waiting = $derived(ui.deciding[0]);

  /**
   * Where the reader has got to, rebuilt when the question changes.
   *
   * Keyed by the decision's id rather than watched as a whole: the host sends
   * this list with every update, so an object identity check would start the
   * reader again from the first question every time an agent printed a line.
   */
  let held = $state<{ id: string; state: Asking } | null>(null);
  const state = $derived.by(() => {
    if (!waiting) return null;
    if (held?.id === waiting.id) return held.state;
    return asking(waiting.steps as Step[]);
  });

  function put(next: Asking): void {
    if (waiting) held = { id: waiting.id, state: next };
  }

  const step = $derived(state ? state.steps[state.at] : undefined);

  /** The box that takes an answer on no list, so the caret can be put in it. */
  let box: HTMLInputElement | undefined = $state();

  function act(key: Key): void {
    if (!state || !waiting) return;
    const { next, done } = pressed(state, key);
    put(next);
    if (!done) return;

    notify("answerQuestions", { id: waiting.id, answers: answersOf(next) });
    // Taken off the screen now rather than when the host says so. The agent is
    // stopped until this message lands, and a stepper still sitting there while
    // it starts again reads as a press that did nothing.
    held = null;
    ui.deciding = ui.deciding.filter((one) => one.id !== waiting.id);
  }

  /*
   * The keys, taken at the window.
   *
   * At the window because the reader has not necessarily clicked anything: the
   * question appears while they are reading a card, and the first thing they
   * should be able to do is press an arrow. The box that takes text is the one
   * exception — while the caret is in it, the arrows belong to the caret.
   */
  $effect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      const writing = state.writing && document.activeElement === box;
      const key: Key | undefined =
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "ArrowLeft"
              ? "left"
              : event.key === "ArrowRight"
                ? "right"
                : event.key === " "
                  ? "space"
                  : event.key === "Enter"
                    ? "enter"
                    : undefined;
      if (!key) return;
      // A space typed into the box is a space in the answer, and the arrows
      // there move the caret. Only return means the same thing in both places.
      if (writing && key !== "enter") return;
      event.preventDefault();
      event.stopPropagation();
      act(key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  /* The caret follows the highlight onto the box, and leaves with it. */
  $effect(() => {
    if (!state || !step) return;
    if (state.cursor === otherRow(step) && state.writing) box?.focus();
  });

  /** Which circle a step draws: answered, the one in hand, or not yet reached. */
  function mark(at: number): "done" | "here" | "ahead" {
    if (!state) return "ahead";
    if (at === state.at) return "here";
    return at < state.furthest || (state.picked[at] ?? []).length > 0 ? "done" : "ahead";
  }
</script>

{#if state && step && waiting}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="deciding" onclick={(event) => event.stopPropagation()}>
    <div class="who">
      {waiting.agent} is waiting · {state.at + 1} of {state.steps.length}
    </div>

    <!--
      The steps, as circles joined by the line between them.

      The line is painted up to where the reader has got to and grey after it,
      so how far through this is reads without counting. A circle behind them is
      pressable; one in front is not — a question is answered in order, and
      jumping to the last would leave the ones behind it blank.
    -->
    <div class="steps" role="list">
      {#each state.steps as one, at (one.question)}
        <div class="step {mark(at)}" role="listitem">
          {#if at > 0}<span class="join {mark(at) === 'ahead' ? 'ahead' : 'done'}"></span>{/if}
          <button
            class="dot"
            disabled={at > state.furthest}
            title={one.header}
            aria-current={at === state.at ? "step" : undefined}
            onclick={() => put({ ...state, at, writing: false })}
          ></button>
          <span class="label">{one.header}</span>
        </div>
      {/each}
    </div>

    <p class="question">{step.question}</p>

    <div class="options">
      {#each step.options as option, at (option.label)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="option"
          class:on={state.cursor === at}
          class:taken={(state.picked[state.at] ?? []).includes(option.label)}
          role="option"
          tabindex="-1"
          aria-selected={(state.picked[state.at] ?? []).includes(option.label)}
          onclick={() => {
            put({ ...state, cursor: at, writing: false });
            // A press is the whole gesture: moving to a row and settling it. On
            // a multi-select it ticks instead, because there the reader is
            // building an answer rather than giving one.
            act(step.multi ? "space" : "enter");
          }}
        >
          <span class="pip">{marker(step.multi, (state.picked[state.at] ?? []).includes(option.label))}</span>
          <span class="said">
            <span class="name">{option.label}</span>
            {#if option.description}<span class="why">{option.description}</span>{/if}
          </span>
        </div>
      {/each}

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="option other"
        class:on={onOther(state)}
        role="option"
        tabindex="-1"
        aria-selected={onOther(state)}
        onclick={() => put({ ...state, cursor: otherRow(step), writing: true })}
      >
        <span class="pip">{marker(step.multi, false)}</span>
        <span class="said">
          <span class="name">Something else</span>
          <input
            bind:this={box}
            class="wrote"
            value={state.written[state.at] ?? ""}
            placeholder="type an answer"
            oninput={(event) => put(typed(state, event.currentTarget.value))}
            onblur={() => put(stoppedWriting(state))}
          />
        </span>
      </div>
    </div>

    <div class="keys">
      <span>↑↓ choose</span>
      {#if step.multi}<span>space tick</span>{/if}
      <span>⏎ {last(state) ? "send" : "next"}</span>
      {#if state.furthest > 0}<span>←→ back</span>{/if}
      {#if !answerable(state)}<span class="blocked">type an answer first</span>{/if}
    </div>
  </div>
{/if}

<script lang="ts" module>
  /** The mark on a row: a box where several answers are wanted, else a dot. */
  function marker(multi: boolean, taken: boolean): string {
    if (multi) return taken ? "☑" : "☐";
    return taken ? "◉" : "○";
  }
</script>

<style>
  /*
   * Over the drawing and under nothing.
   *
   * An agent is stopped until this is answered and there is no timeout behind
   * it, so a question that can be lost behind a panel is a turn that never
   * finishes. It sits where a reader cannot miss it and takes the keys with it.
   */
  .deciding {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: var(--z-compose, 24);
    width: min(560px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px 12px;
    border-radius: 10px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--here-edge, var(--vscode-focusBorder, #0a84ff));
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.42);
    font-size: 13px;
  }

  .who {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .steps {
    display: flex;
    align-items: flex-start;
  }
  /* Each step owns the line that arrives at it, so the row stays even however
     many there are and the line can be coloured per segment. */
  .step {
    display: flex;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    gap: 6px;
  }
  .step:first-child { flex: 0 0 auto; }
  .join {
    flex: 1 1 auto;
    height: 2px;
    min-width: 14px;
    border-radius: 1px;
    background: var(--vscode-foreground);
    opacity: 0.18;
  }
  .join.done {
    background: var(--vscode-progressBar-background, #0a84ff);
    opacity: 1;
  }

  .dot {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--vscode-foreground) 30%, transparent);
    background: transparent;
    cursor: pointer;
  }
  .step.done .dot {
    background: var(--vscode-progressBar-background, #0a84ff);
    border-color: var(--vscode-progressBar-background, #0a84ff);
  }
  /* The one in hand is a ring rather than a disc: filled would be indis-
     tinguishable from answered, which is the one distinction this row makes. */
  .step.here .dot {
    border-color: var(--vscode-progressBar-background, #0a84ff);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-progressBar-background, #0a84ff) 24%, transparent);
  }
  .dot:disabled { cursor: default; }

  .label {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step.here .label { color: var(--vscode-foreground); }

  .question {
    margin: 0;
    color: var(--vscode-foreground);
  }

  .options { display: flex; flex-direction: column; gap: 2px; }

  .option {
    display: flex;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 5px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .option:hover { background: var(--vscode-list-hoverBackground); }
  /* Where the arrows are. An outline rather than a wash, because the wash is
     already the hover and a reader must be able to tell them apart without
     moving the pointer away to check. */
  .option.on {
    background: var(--here-wash);
    border-color: var(--here-edge);
  }

  .pip {
    flex: 0 0 auto;
    color: var(--vscode-progressBar-background, #0a84ff);
    font-size: 12px;
    line-height: 1.5;
  }
  .said { display: flex; flex-direction: column; min-width: 0; }
  .name { color: var(--vscode-foreground); }
  .why { color: var(--muted); font-size: 11px; }

  .wrote {
    margin-top: 3px;
    width: 100%;
    font: inherit;
    font-size: 12px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 3px 6px;
  }
  .wrote:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

  .keys {
    display: flex;
    gap: 12px;
    color: var(--muted);
    font-size: 11px;
  }
  .keys .blocked { color: var(--warning); }
</style>
