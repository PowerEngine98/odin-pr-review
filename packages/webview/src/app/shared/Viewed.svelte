<!--
  The box that marks a file read.

  One control for the two places a reader can mark a file off: the title bar of
  its card on the canvas, and its row in the sidebar's list. They used to be two
  — the card left its checkbox to the platform, the sidebar drew its own — and
  the same act looked like a different act depending on where the reader
  happened to be standing.

  The drawn box is the one that survived, and the list is the reason. A native
  checkbox is stark white on a dark editor and drags the eye away from the file
  names, which are the point of the list; drawn from the editor's own tokens it
  follows whatever theme is in use and stays at the quiet end of the row where
  it belongs.

  That argument was never about files, which is why the settings panel draws its
  switches from here too. Its rows were the last native checkboxes left on the
  page, and a panel of stark white squares floating over the drawing is the same
  complaint from a different corner. A switch there is not marking anything read,
  so it says its own word beside the box rather than "Viewed" — the box is the
  part that has to be one box everywhere.

  Quiet is the other half of it. Marking a file read is a note about the reader's
  progress, not a fact about the change, so the control waits at low opacity
  until it is hovered or until it is set. How quiet is the caller's business:
  a row that dims its whole contents until hovered raises `--viewed-quiet` on
  hover, and a custom property crosses the component boundary where a class
  cannot.
-->
<script lang="ts">
  let {
    checked = $bindable(false),
    label = false,
    title,
    hint,
    onchange,
  }: {
    /**
     * Whether the file has been read.
     *
     * Bindable, so a caller that wants the box and its own state kept in step
     * can say `bind:checked`. Passed plainly it still works: the box tracks
     * what it is given, and reports what it was set to through `onchange`.
     */
    checked?: boolean;
    /**
     * The word beside the box.
     *
     * Off in a list, where the column says it once; `true` for the file header,
     * where a box on its own is a question with no wording; and a string where
     * the box governs something other than a file having been read, which is
     * every row of the settings panel.
     */
    label?: boolean | string;
    title?: string;
    /** For the canvas's own hover hints, which read this attribute. */
    hint?: string;
    onchange?: (viewed: boolean) => void;
  } = $props();

  /**
   * What the box says when it is pointed at, when the caller has not said.
   *
   * "Mark as reviewed" is what this box has always meant, and it stays the
   * fallback for the two places that mark a file off. It is a lie on a settings
   * row — nothing is being reviewed by turning imports off — so a box carrying
   * its own wording gets no tooltip unless it was given one, rather than one
   * describing a different control.
   */
  const tooltip = $derived(title ?? (typeof label === "string" ? undefined : "Mark as reviewed"));

  /*
   * The new state is read off the element rather than off the prop.
   *
   * The prop is written here too, but a listener cannot assume it has already
   * settled by the time it runs — and the caller is being told what the reader
   * just did, which is a fact about the element.
   */
  function toggle(event: Event): void {
    const box = event.currentTarget as HTMLInputElement;
    checked = box.checked;
    onchange?.(box.checked);
  }
</script>

<!--
  The press is stopped here rather than allowed to carry on.

  Every caller puts this control inside something else that answers a click — a
  card that takes the reader's attention, a row that brings a file to the middle
  of the canvas, a panel that shuts when the page is clicked past it — and
  setting the box is not a request for any of that.
-->
<label class="viewed" class:is-viewed={checked} data-hint={hint} title={tooltip}>
  <input
    type="checkbox"
    {checked}
    onclick={(event) => event.stopPropagation()}
    onchange={toggle}
  />
  {#if label}<span class="label">{label === true ? "Viewed" : label}</span>{/if}
</label>

<style>
  .viewed {
    /* Named once, so the rules below read as what they draw rather than as a
       chain of fallbacks. The editor's own tokens where it has an opinion: a
       webview is handed the running theme as custom properties, so `var(x, y)`
       already means "x if the editor defined it, otherwise ours". */
    --box-edge: var(--vscode-checkbox-border, var(--vscode-contrastBorder, #6b6b6b));
    --box-fill: var(--vscode-checkbox-background, transparent);
    --box-tick: var(--action-ink, var(--vscode-button-foreground, #ffffff));

    display: inline-flex;
    align-items: center;
    /* The box and the word are one control, but they are not one glyph:
       touching, they read as a box with a broken border. */
    gap: 6px;
    flex: 0 0 auto;
    cursor: pointer;
    opacity: var(--viewed-quiet, 0.55);
    transition: opacity 120ms ease;
  }
  .viewed:hover,
  .viewed.is-viewed { opacity: 1; }

  /* Drawn rather than left to the platform. See the note at the top: a native
     checkbox is the loudest thing in a sidebar full of file names. */
  .viewed input {
    appearance: none;
    -webkit-appearance: none;
    flex: 0 0 auto;
    margin: 0;
    width: 14px;
    height: 14px;
    border: 1px solid var(--box-edge);
    background: var(--box-fill);
    border-radius: 3px;
    position: relative;
    cursor: pointer;
    transition: background-color 100ms ease, border-color 100ms ease;
  }

  /* Set: filled with the theme's accent and a light tick, the way a chosen
     control reads everywhere else, rather than an outline with a mark in it. */
  .viewed input:checked {
    background: var(--box-set, var(--vscode-button-background, #0a84ff));
    border-color: var(--box-set, var(--vscode-button-background, #0a84ff));
  }

  /* Taking the platform's drawing also takes its focus ring, so one is put
     back. Without it the control is invisible to anyone arriving by keyboard —
     there is nothing else on it to say where the caret is. */
  .viewed input:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, var(--box-set, #0a84ff));
    outline-offset: 1px;
  }

  /* Centred by the box model rather than by hand: inset plus auto margins
     places the mark, and rotating about its own centre keeps it there. The
     nudge up and left is optical — a tick's mass sits low and right of its
     bounding box, so squaring it to the box leaves it looking dropped. */
  .viewed input::after {
    content: "";
    position: absolute;
    inset: 0;
    margin: auto;
    width: 3.5px;
    height: 7px;
    border: solid var(--box-tick);
    border-width: 0 2px 2px 0;
    transform: translate(-0.5px, -1px) rotate(45deg) scale(0);
    transform-origin: center;
    transition: transform 90ms ease;
  }
  .viewed input:checked::after {
    transform: translate(-0.5px, -1px) rotate(45deg) scale(1);
  }

  /* Said out loud where there is room for it, because a checkbox alone on a
     file header is a question with no wording: read what?

     Two under the drawing's own size by default, which is the size a card's
     title bar was built around. Off the canvas that measurement means nothing —
     `--font-size` is the width the arrows were placed against, not a type
     scale, and the settings panel sets its own — so the size is a property the
     caller can name rather than a subtraction from a number it does not use. */
  .label {
    font-size: var(--viewed-label-size, calc(var(--font-size, 1em) - 2px));
    color: var(--muted);
  }
  .viewed.is-viewed .label { color: var(--text); }
</style>
