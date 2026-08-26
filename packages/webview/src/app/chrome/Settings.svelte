<!--
  How the change is being read, as opposed to what it is.

  At the end of the bar, where the forge keeps its own. Every switch here writes
  to the shared settings and nothing else: the old page found each control by
  id, read `.checked` off the element and toggled classes on whatever it thought
  the switch governed, so a setting existed in as many places as there were
  readers of it and the DOM was the only one that could be asked. Here the
  fields are the setting, and the components that draw from them redraw.
-->
<script lang="ts">
  import { ACTIONS, KEYS_KEY, defaults, readKeys, waitFor } from "../shared/bindings.js";
  import { model, settings } from "../state.svelte.js";
  import Viewed from "../shared/Viewed.svelte";
  import { GEAR } from "./icons.js";

  let {
    hasSchema = false,
    notes,
  }: {
    hasSchema?: boolean;
    notes?: { gaps?: string; unpainted?: string[] };
  } = $props();

  let open = $state(false);
  let menu: HTMLElement | undefined = $state();

  /**
   * Kept on the device, because a preference that resets every reload is not a
   * preference. Read once at the top rather than in an effect: an effect runs
   * after the first paint, and the panel would open showing the defaults and
   * then correct itself in front of the reader.
   */
  function stored(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function store(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* a webview with storage denied still works; it just forgets */
    }
  }

  // The reader's choice if they have made one, and otherwise the reading the
  // layout was built for.
  const savedMode = stored("odin.diff-mode");
  settings.unified =
    savedMode === "unified" ? true : savedMode === "split" ? false : model.current.unified;

  try {
    const savedHud = JSON.parse(stored("odin.hud") ?? "{}") as Record<string, unknown>;
    for (const part of ["reviewers", "comments", "map"] as const) {
      if (savedHud[part] === false) settings.hud[part] = false;
    }
  } catch {
    /* nothing saved, or something else wrote nonsense there; the defaults show
       every corner, which is the state a reader can undo from */
  }

  $effect(() => {
    store("odin.diff-mode", settings.unified ? "unified" : "split");
  });

  $effect(() => {
    store("odin.hud", JSON.stringify(settings.hud));
  });

  /** Anywhere else puts the panel away, the way every other menu here does. */
  function dismiss(event: MouseEvent) {
    if (!open) return;
    if (menu?.contains(event.target as Node)) return;
    open = false;
    rebinding = null;
  }

  /*
   * What each key does comes from `../shared/bindings.js`, and so does the
   * reading of what the reader has chosen instead. The panel used to declare
   * the table itself, alongside the canvas declaring its own copy: the rows
   * drawn here and the presses obeyed there were two lists that happened to
   * match. This draws the shared one and writes back to the same file the
   * canvas reads on every press.
   */
  let keys = $state(readKeys({ getItem: stored }));
  /** The action waiting for a key, so the next press is an answer rather than a
      command. */
  let rebinding: string | null = $state(null);

  $effect(() => {
    store(KEYS_KEY, JSON.stringify(keys));
  });

  /*
   * Said out loud where the canvas can hear it.
   *
   * The rune is what redraws the cap; the shared module is what a handler with
   * no runes in it can ask before it obeys a press, so that the key being bound
   * is not also acted on as it goes past. Mirrored in one effect rather than at
   * each of the four places that stop the wait, because a single one of them
   * forgotten leaves the canvas deaf until the panel is opened again — and the
   * teardown covers the panel being taken off the page mid-rebind, which is the
   * same deafness arrived at from the other direction.
   */
  $effect(() => {
    waitFor(rebinding);
    return () => waitFor(null);
  });

  /** How a key is written where a reader has to recognise it. */
  function keyName(key: string): string {
    if (key === " ") return "space";
    if (key === "Enter") return "enter";
    if (key === "Escape") return "esc";
    if (key.startsWith("Arrow")) return `${key.slice(5).toLowerCase()} arrow`;
    return key;
  }

  function bind(event: KeyboardEvent) {
    if (!rebinding) return;
    // Somebody typing is typing, even in the middle of rebinding: a press in a
    // field is text, and taking it for an answer binds an action to whatever
    // letter they happened to be writing.
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "Escape") {
      rebinding = null;
      return;
    }
    keys[rebinding] = event.key;
    rebinding = null;
    event.preventDefault();
  }

  function resetKeys() {
    keys = defaults();
    rebinding = null;
  }

  /**
   * Languages present in the change that nothing could colour.
   *
   * Said out loud rather than left as a card that is quietly grey. Odin bundles
   * grammars for the languages it lists, not for all two hundred Shiki carries,
   * and a reviewer looking at uncoloured code deserves to know which of the two
   * reasons they are looking at.
   */
  const unpainted = $derived(notes?.unpainted ?? []);
  const paint = $derived(
    unpainted.length > 3
      ? `${unpainted.slice(0, 3).join(", ")} and ${unpainted.length - 3} more`
      : unpainted.join(", "),
  );

  /* ----------------------------------------------------------- the bottom */

  /** The column that scrolls, once there is more in it than the panel is tall. */
  let pane: HTMLElement | undefined = $state();

  /**
   * Whether the reader has reached the foot of the panel.
   *
   * The panel is taller than the window has room for now that the keys are
   * always in it, so its last rows are clipped — and a row cut off by a flat
   * edge looks like the end of the list rather than the middle of it. A fade
   * over that edge says there is more below.
   *
   * It has to go once there is nothing left to reveal. A gradient that stays
   * put sits over the last row for as long as the reader is reading it, which
   * costs more than the hard edge it was there to soften.
   */
  let atEnd = $state(true);

  function measure(): void {
    if (!pane) return;
    const room = pane.scrollHeight - pane.clientHeight;
    // A pixel of slack at both ends: a panel that does not overflow at all has
    // nothing to announce, and fractional scroll heights mean the bottom is
    // rarely reached to the exact pixel.
    atEnd = room <= 1 || pane.scrollTop >= room - 1;
  }

  /*
   * Asked again whenever the panel could have changed height. The database
   * switch and the notes at the foot both come and go with the change being
   * read, and the window can be made shorter under an open panel — a fade
   * decided once at the moment of opening would be describing a panel that no
   * longer exists.
   */
  $effect(() => {
    void hasSchema;
    void unpainted;
    measure();
  });
</script>

<svelte:window onclick={dismiss} onkeydown={bind} onresize={measure} />

<span class="settings-menu" bind:this={menu}>
  <button
    class="icon-button"
    title="Diff settings"
    aria-label="Diff settings"
    onclick={() => (open = !open)}
  >{@html GEAR}</button>

  {#if open}
    <span class="settings-panel">
      <!-- The panel's contents are their own scrolling column rather than the
           panel itself scrolling, so the fade below can be placed against the
           panel: anything absolute inside a scrolling box scrolls away with the
           text it was covering, which puts the gradient in the middle of the
           list the moment the reader moves. -->
      <span class="settings-scroll" bind:this={pane} onscroll={measure}>
        <span class="settings-title">Settings</span>
        <span class="settings-rule"></span>

        <span class="settings-group">Diff display</span>
        <!-- Two readings of one fact, so they are radios rather than a switch —
             and their state is read off the setting instead of the element,
             which is why nothing here has to be told when the other changes. -->
        <label class="settings-option">
          <input
            type="radio"
            name="diff-mode"
            checked={settings.unified}
            onchange={() => (settings.unified = true)}
          /><span>Unified</span>
        </label>
        <label class="settings-option">
          <input
            type="radio"
            name="diff-mode"
            checked={!settings.unified}
            onchange={() => (settings.unified = false)}
          /><span>Split</span>
        </label>

        <span class="settings-rule"></span>
        <span class="settings-group">Show</span>
        <!-- Every switch below is the sidebar's drawn box, which is why nothing
             here declares one. See ../shared/Viewed.svelte: the panel used to
             put the platform's checkbox in these rows, and a column of stark
             white squares was the loudest thing on a page whose subject is a
             drawing. -->
        <Viewed
          label="Imports"
          title="Import statements and the arrows they produce"
          bind:checked={settings.showImports}
        />
        <Viewed label="Unchanged references" bind:checked={settings.showUnchanged} />
        <Viewed
          label="Tests"
          title="Test files reference a great deal of what they exercise, which buries the change under them"
          bind:checked={settings.showTests}
        />
        <Viewed
          label="Hide viewed relations"
          title="Hides untouched files once everything referencing them has been read. Files the change touched always stay."
          bind:checked={settings.hideViewed}
        />
        <!-- A switch for something the change does not have is a switch that
             teaches the reader nothing, so the database only appears in the menu
             when there is a schema on the canvas. -->
        {#if hasSchema}
          <Viewed
            label="Database"
            title="The database schema as a card of its own, and the migrations and generated code that reach it"
            bind:checked={settings.showInfra}
          />
        {/if}

        <span class="settings-rule"></span>
        <span class="settings-group">View</span>
        <Viewed label="Reviewers" bind:checked={settings.hud.reviewers} />
        <Viewed label="Comments" bind:checked={settings.hud.comments} />
        <Viewed label="Map" bind:checked={settings.hud.map} />
        <Viewed label="Checks" bind:checked={settings.hud.checks} />
        <!-- Only worth offering over a reading that has one. Over the forge's
             copy the switch would turn on a panel that does not appear, which
             reads as the switch being broken. -->
        {#if model.current.meta.worktree}
          <Viewed
            label="AI pairing"
            title="Agents on this machine that can take work from your comments"
            bind:checked={settings.hud.agents}
          />
        {/if}

        <span class="settings-rule"></span>
        <!--
          The keys, and what they do: a section of the panel like any other,
          rather than a list a button had to be found and pressed to see.

          The reader who needs this list is the one who does not know the page
          answers the keyboard at all, and that reader has no reason to press a
          button labelled "Keys" — so the list existed for the people who
          already knew it was there. There is no button for fitting the drawing
          beside it any more either: `h` does that, the row below says so, and a
          button competing with a binding teaches the binding to nobody.
        -->
        <span class="settings-group">Keys</span>
        {#each ACTIONS as action (action.id)}
          <div class="key-row">
            <span class="key-says">{action.says}</span>
            <button
              class="key-cap"
              class:waiting={rebinding === action.id}
              onclick={() => (rebinding = rebinding === action.id ? null : action.id)}
            >
              {rebinding === action.id ? "press a key" : keyName(keys[action.id] ?? "")}
            </button>
          </div>
        {/each}
        <button class="key-reset" onclick={resetKeys}>Reset to defaults</button>

        <!--
          What the page could not do, said once and quietly.

          Files with diff lines and no arrows, and languages nothing could
          colour. Neither stops a review, and both explain something a reader
          would otherwise put down to a bug — so they belong where the settings
          are, not across the top of the drawing.
        -->
        {#if notes?.gaps || unpainted.length > 0}
          <span class="settings-rule"></span>
          {#if notes?.gaps}
            <span
              class="settings-note"
              title="These files have diff lines but no arrows, because nothing could read them"
            >{notes.gaps}</span>
          {/if}
          {#if unpainted.length > 0}
            <span
              class="paint"
              title="Odin ships VS Code's own grammars for the languages it supports. These are not among them, so their code is shown uncoloured; adding one is a line in @odin/highlight."
            >no highlighting for {paint}</span>
          {/if}
        {/if}
      </span>

      <!-- Says that the column carries on past the edge of the panel, and says
           nothing once it does not. Not a control and not in the reading order:
           it is the clipped row underneath that the reader is being pointed at. -->
      <span class="settings-edge" class:spent={atEnd} aria-hidden="true"></span>
    </span>
  {/if}
</span>

<style>
  .settings-menu { position: relative; display: inline-flex; }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .icon-button:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }

  .settings-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    /* A menu, and the scale says where menus sit. Read from the scale rather
       than written out, because the number is only ever meaningful next to the
       panels and the threads it has to come out over. */
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    min-width: 230px;
    /* Never taller than the window it hangs in. The panel is anchored under a
       bar at the top of the page, so a panel free to be as tall as its contents
       ran off the bottom of the screen and took the last rows with it — there
       is no scrolling past the end of a box that has no end. The rest of the
       height is the bar above and a margin at the foot. */
    max-height: min(70vh, 520px);
    /* Named, because the fade at the foot has to be this exact colour: a
       gradient that ends a shade off the panel it lies on draws a band across
       the bottom of the panel instead of disappearing into it. */
    --panel-fill: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    border-radius: 8px;
    background: var(--panel-fill);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    /* What the switches say, at the panel's size rather than the drawing's.
       They read it across the component boundary, which a class could not do.
       Their own default is two under `--font-size`, and that number is the
       width the arrows were placed against rather than a type scale — taken
       literally here it put the rows at ten pixels under headings of twelve. */
    --viewed-label-size: 12px;
  }

  /* The column of settings, which is what scrolls. The padding lives here
     rather than on the panel so that the scrollbar runs the full height of the
     box, with no dead strip of background above and below it. */
  .settings-scroll {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    overflow-y: auto;
    /* The canvas behind this zooms on a wheel. Reaching the end of the list and
       carrying on would otherwise hand the rest of the gesture to the drawing,
       and the reader who was reading the keys would find the whole change had
       jumped a zoom level under the panel. */
    overscroll-behavior: contain;
  }

  /* The bottom edge of the panel, faded into whatever is still below it.
     Absolute against the panel rather than the scrolling column, so it stays at
     the edge instead of travelling with the rows; and out of the pointer's way,
     since what it covers is a row the reader may well want to press. */
  .settings-edge {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 34px;
    border-radius: 0 0 8px 8px;
    pointer-events: none;
    background: linear-gradient(
      to top,
      var(--panel-fill) 30%,
      /* Mixed from the panel's own colour rather than written as `transparent`,
         which is transparent black: fading to it drags a grey bloom through the
         middle of the gradient on a light theme. */
      color-mix(in srgb, var(--panel-fill) 0%, transparent)
    );
    transition: opacity 120ms ease;
  }
  /* Nothing left to say: the list has been read to the end, and a gradient over
     the last row from here on is just a row that is harder to read. */
  .settings-edge.spent { opacity: 0; }

  .settings-title { font-size: 13px; font-weight: 600; color: var(--text); }
  .settings-group {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    margin-top: 2px;
  }
  /* The two readings of the diff, and nothing else: every other row in the
     panel is the shared box, which brings its own row with it. */
  .settings-option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
  }
  .settings-option:hover { color: var(--text); }

  /*
   * The radio, drawn rather than left to the platform.
   *
   * The checkbox beside it is drawn — for the reason recorded where it lives: a
   * native control is stark white on a dark editor and drags the eye off the
   * words, which are the point of a settings row. Two switches in one menu, one
   * of them the editor's own and one of them ours, is worse than either alone,
   * so the radio follows the checkbox: the same size, the same border, the same
   * quiet until it means something, and the same blue when it does.
   *
   * Round rather than square, which is the whole of what a radio says that a
   * checkbox does not — one of these, not any of these.
   */
  .settings-option input[type="radio"] {
    appearance: none;
    -webkit-appearance: none;
    box-sizing: border-box;
    flex: 0 0 auto;
    margin: 0;
    width: 14px;
    height: 14px;
    border: 1px solid var(--vscode-checkbox-border, var(--vscode-contrastBorder, #6b6b6b));
    border-radius: 50%;
    background: var(--vscode-checkbox-background, transparent);
    opacity: var(--viewed-quiet, 0.55);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: opacity 120ms ease, background-color 120ms ease, border-color 120ms ease;
  }
  .settings-option:hover input[type="radio"] { opacity: 1; }

  /* Chosen: filled, with the dot punched out of it in the ink the editor picked
     to be legible on its own buttons — the same pair the tick uses. */
  .settings-option input[type="radio"]:checked {
    opacity: 1;
    background: var(--box-set, var(--vscode-button-background, #0a84ff));
    border-color: var(--box-set, var(--vscode-button-background, #0a84ff));
  }
  .settings-option input[type="radio"]::after {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--action-ink, #ffffff);
    transform: scale(0);
    transition: transform 90ms ease;
  }
  .settings-option input[type="radio"]:checked::after { transform: scale(1); }
  .settings-option input[type="radio"]:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, var(--box-set, #0a84ff));
    outline-offset: 1px;
  }
  /* One rule between groups, so the menu reads as sections rather than as a
     column of switches. */
  .settings-rule {
    height: 1px;
    margin: 4px 0 2px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }
  /* What the page could not do. Said once, in the place explanations live. */
  .settings-note,
  .paint {
    display: block;
    color: var(--warning);
    font-size: 11px;
    line-height: 1.4;
  }

  /* A row of the panel like the switches above it, rather than a box of its
     own. The list used to be drawn inside a bordered card within the panel —
     the shape it had when it floated over the toolbar in the corner — which
     read as a second panel that had landed on top of the settings. */
  .key-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .key-says {
    flex: 1 1 auto;
    font-size: 12px;
    color: var(--muted);
  }
  .key-cap {
    flex: 0 0 auto;
    min-width: 76px;
    font: inherit;
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--text) 10%, transparent);
    border: 0;
    border-radius: 5px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .key-cap:hover { color: var(--text); }
  /* Listening. The next press is the answer, so it says so. */
  .key-cap.waiting {
    color: var(--bg);
    background: var(--status-renamed);
  }
  .key-reset {
    margin-top: 8px;
    width: 100%;
    font: inherit;
    font-size: 11px;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 5px;
    padding: 4px;
    cursor: pointer;
  }
  .key-reset:hover { color: var(--text); background: color-mix(in srgb, var(--text) 10%, transparent); }

  @media (prefers-reduced-motion: reduce) {
    .settings-edge { transition: none; }
  }
</style>
