import type { LayoutMetrics, Theme } from "@odin/core";

/**
 * Stylesheet for the interactive renderer.
 *
 * Card geometry is not styled here: positions and sizes come from the layout
 * engine as inline values, so the browser and the static SVG agree pixel for
 * pixel. CSS only handles appearance and interaction state.
 */
export function stylesheet(theme: Theme, metrics: LayoutMetrics): string {
  return `
:root {
  --bg: ${theme.background};
  --card-bg: ${theme.cardBackground};
  --text: ${theme.text};
  --muted: ${theme.mutedText};
  --gutter: ${theme.gutter};
  --added: ${theme.change.added};
  --removed: ${theme.change.removed};
  --unchanged: ${theme.change.unchanged};
  --add-bg: ${theme.lineBackground.add};
  --del-bg: ${theme.lineBackground.del};
  --status-added: ${theme.status.added};
  --status-modified: ${theme.status.modified};
  --status-deleted: ${theme.status.deleted};
  --status-renamed: ${theme.status.renamed};
  --status-phantom: ${theme.status.phantom};
  --line-height: ${metrics.lineHeight}px;
  --font-size: ${metrics.fontSize}px;
  --title-height: ${metrics.titleHeight}px;
  --padding: ${metrics.padding}px;
  --gutter-width: ${metrics.gutterWidth}px;
  --right-gutter-width: ${metrics.rightGutterWidth}px;
  --line-number-right: ${metrics.lineNumberRight}px;
  --gap-bg: ${theme.gapBackground};
  --warning: ${theme.warning};
  /* The one colour in the page that means "do the thing". Dark enough to carry
     white at about five and a half to one, where the diff's own green — chosen
     to sit behind code rather than under text — managed two. */
  --action: #007C36;
  --action-ink: #ffffff;
  /* The wash over a picked range. Yellow because it is a selection, not a
     verdict: nothing has been said about these lines yet. */
  --pick-wash: color-mix(in srgb, var(--warning) 22%, transparent);
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

/* The attribute has to beat any display a class sets, or an element the script
   has hidden stays on screen — which is how a Submit review button appeared on
   a page with nothing to submit through. */
[hidden] { display: none !important; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  overflow: hidden;
}

/* How much of what is on screen has been read. Full width, because it is about
   the whole view rather than any one card, and pinned to the chrome's lower
   edge so a title sliding up to the bar meets it there. */
.done-bar {
  height: 2px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
}
.done-bar span {
  display: block;
  height: 100%;
  width: 0;
  background: var(--status-renamed);
  transition: width 200ms ease;
}

/* One tab per part of the change that can be read on its own. Drawn like the
   editor's own tabs rather than the forge's, because this is a place you come
   back to rather than a page you scroll. */
.parts {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 0 10px;
  overflow-x: auto;
  border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
}
.part-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 0;
  /* The mark rides the top edge, where the strip meets the header above it,
     rather than the bottom edge it shares with the canvas. */
  border-top: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.part-tab:hover { color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); }
.part-tab.on {
  color: var(--text);
  border-top-color: var(--status-renamed);
}
/* The count is the reason to pick one tab over another -- how much work is
   behind it -- so it is read, not glanced at. Gutter grey on a faint pill was
   two greys arguing with each other. */
.part-tab .count .done { color: var(--status-renamed); font-weight: 600; }
.part-tab .count {
  /* Centred by the box rather than by a line height guessed against the font's
     metrics, which sat the digits a pixel high in the pill. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  line-height: 1;
  /* The line box is centred exactly; the ink is not. Digits have no descenders,
     so half the font's descent is empty space under them and the numerals read
     as sitting high. One pixel down puts the ink in the middle, which is what
     the eye is measuring. */
  padding-top: 1px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  min-width: 18px;
  text-align: center;
  color: color-mix(in srgb, var(--text) 72%, transparent);
  background: color-mix(in srgb, var(--text) 16%, transparent);
  border-radius: 999px;
  padding: 0 6px;
}
.part-tab:hover .count { color: var(--text); }
/* Everything in it has been read. */
.part-tab .count .tick {
  display: inline-flex;
  align-items: center;
  color: var(--status-renamed);
}
.part-tab.finished .count {
  background: color-mix(in srgb, var(--status-renamed) 22%, transparent);
}
.part-tab.on .count {
  color: var(--text);
  background: color-mix(in srgb, var(--status-renamed) 28%, transparent);
}

/* ------------------------------------------------------------------ toolbar */

/* Everything stacks into columns rather than running across the top: a
   docked editor panel is narrow, and a row of eight items wraps into a mess
   long before it runs out of things to say. */
.chrome {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 20;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}

/* Docked at the foot of the canvas, out of the drawing's way. It used to run
   across the top, where it cost the picture a row of height on every screen
   for something read once and then only consulted. */
.toolbar {
  position: fixed;
  right: 14px;
  bottom: 52px;
  z-index: 20;
  display: flex;
  align-items: stretch;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  font-size: 12px;
}
/* The spacer earned its keep in a full-width bar; in a corner it would push
   everything apart. */
.toolbar .spacer { display: none; }

/* ------------------------------------------------------------ the pull request

   The forge's own header, repeated. A reviewer arriving here has just come from
   the browser, or is about to go back to it, and the question it answers —
   what am I looking at, who is merging what into where, how much have I read —
   is the same question in both places. */
.prbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}

.prbar .state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 4px 11px 4px 9px;
  border-radius: 999px;
  font-weight: 600;
  color: #fff;
  background: var(--muted);
}
/* The same green the actions use, for the same reason: white on the diff's own
   green is the weakest pairing in the page. */
.prbar .state.open { background: var(--action); color: #fff; }

/* The state is where a draft stops being a draft, so it is a button — with a
   caret, because a control that acts on the pull request should say that it
   opens something rather than doing it on the first click. */
.state-menu { position: relative; flex: 0 0 auto; }
.prbar .state.pressable {
  border: 0;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding-right: 8px;
}
.prbar .state.pressable:hover { filter: brightness(1.12); }
.prbar .state .caret { opacity: 0.8; margin-left: 1px; }

/* The diff settings, at the end of the bar where the forge keeps them. */
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
  z-index: 45;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 230px;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
}
.settings-title { font-size: 13px; font-weight: 600; color: var(--text); }
.settings-group {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-top: 2px;
}
.settings-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.settings-option:hover { color: var(--text); }

.state-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 45;
  min-width: 260px;
  padding: 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
}
.state-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  font: inherit;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 7px 9px;
  cursor: pointer;
}
.state-item:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
/* What it will do, said before it is done rather than in a dialog afterwards. */
.state-item .why { color: var(--muted); font-size: 11px; }
.prbar .state.draft { background: color-mix(in srgb, var(--muted) 80%, var(--text)); }
.prbar .state.local { background: color-mix(in srgb, var(--muted) 70%, transparent); }

.prbar .about {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 0 1 auto;
}
.prbar .head-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.prbar .pr-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prbar .pr-number { color: var(--muted); text-decoration: none; flex: 0 0 auto; }
.prbar .pr-number:hover { color: var(--status-renamed); text-decoration: underline; }

.prbar .merge-line {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
}
.prbar .who { color: var(--status-renamed); }

/* The refs as chips, because the two names are the part of this sentence the
   eye is looking for. */
.prbar .ref {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--status-renamed);
  background: color-mix(in srgb, var(--status-renamed) 14%, transparent);
  border-radius: 999px;
  padding: 1px 8px;
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prbar .copy-ref {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.prbar .copy-ref:hover { color: var(--text); background: color-mix(in srgb, var(--text) 10%, transparent); }
.prbar .copy-ref.done { color: var(--added); }

.prbar .spacer { flex: 1 1 auto; }

.prbar .viewed-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  color: var(--muted);
}
.prbar .viewed-count .tally { color: var(--text); font-weight: 600; }
.prbar .ring { color: var(--status-renamed); }

.prbar .tag {
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 11px;
  flex: 0 0 auto;
}
.prbar .tag.ok { color: var(--added); }
.prbar .tag.warn { color: var(--warning); }
.prbar .tag.muted { color: var(--muted); }

/* Sending a review is the one irreversible thing this page can do, so it is
   the one control drawn as a filled button. White on the diff's own green was
   the weakest contrast in the page — that green is chosen to sit behind code,
   not under text — so the action takes a colour of its own. */
.prbar .submit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font: inherit;
  font-weight: 600;
  color: var(--action-ink);
  background: var(--action);
  border: 1px solid color-mix(in srgb, #000 22%, var(--action));
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
}
.prbar .submit:hover { filter: brightness(1.08); }
.prbar .submit .count {
  background: color-mix(in srgb, var(--action-ink) 22%, transparent);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 11px;
}

/* Stacking the rest of the toolbar into columns freed a great deal of width,
   so branch names get most of it. Real ones are long and the tail is the part
   that identifies them. */
/* A rule between the groups, so the bar reads as sections rather than as one
   long run of unrelated things. */
.toolbar > .gaps,
.toolbar > .filters,
.toolbar > button {
  border-left: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
  padding-left: 16px;
}
.toolbar > .gaps { border-left-color: color-mix(in srgb, var(--warning) 45%, transparent); }

.legend, .filters, .toolbar button { flex: 0 0 auto; }
.toolbar .spacer { flex: 1; }

.toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.toolbar label:hover { color: var(--text); }
.toolbar input { margin: 0; }

/* Every box in the page is drawn rather than left to the platform. A native
   checkbox is stark white on a dark page — it outshines the code it sits
   beside, and an unticked one shouts louder than a ticked one, which is
   backwards. Same shape as the sidebar's, so the two halves of the tool agree
   about what a checkbox looks like. */
/* Drawn, like every other control here: a native radio ignores the page's
   colours and arrives white in a dark theme. */
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 1px solid color-mix(in srgb, var(--text) 32%, transparent);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border-radius: 50%;
  position: relative;
  cursor: pointer;
  transition: background-color 100ms ease, border-color 100ms ease;
}
input[type="radio"]:hover { border-color: color-mix(in srgb, var(--text) 55%, transparent); }
input[type="radio"]:checked {
  border-color: var(--status-renamed);
  background: var(--status-renamed);
}
input[type="radio"]:checked::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #fff;
}

input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 1px solid color-mix(in srgb, var(--text) 32%, transparent);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border-radius: 3px;
  position: relative;
  cursor: pointer;
  transition: background-color 100ms ease, border-color 100ms ease;
}
input[type="checkbox"]:hover {
  border-color: color-mix(in srgb, var(--text) 55%, transparent);
}
input[type="checkbox"]:checked {
  background: var(--status-renamed);
  border-color: var(--status-renamed);
}
/* Centred by the box model rather than by hand. The nudge is optical: a tick's
   mass sits low and right of its bounding box, so squaring it to the box
   leaves it looking dropped. */
input[type="checkbox"]::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 3.5px;
  height: 7px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: translate(-0.5px, -1px) rotate(45deg) scale(0);
  transform-origin: center;
  transition: transform 90ms ease;
}
input[type="checkbox"]:checked::after {
  transform: translate(-0.5px, -1px) rotate(45deg) scale(1);
}

/* No outline of its own: it is the only thing on that row, inside a panel that
   already has an edge, and a box drawn inside a box reads as a seam. */
.toolbar button {
  font: inherit;
  color: var(--muted);
  background: color-mix(in srgb, var(--text) 8%, transparent);
  border: 0;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.toolbar button:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 16%, transparent);
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: var(--muted);
  line-height: 1.35;
}
.legend span { display: inline-flex; align-items: center; gap: 5px; }

.filters {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.35;
}
/* The same box the file list draws, so a status reads the same in both places.
   Filled rather than hollow: an outlined square of this size is what an
   unticked checkbox looks like, and a legend is not something you can tick. */
.legend .box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.legend .phantom .box { border-style: dashed; }

/* What the change is, above; what to do with it, below. */
.facts { display: flex; flex-direction: column; gap: 1px; }
/* Across the panel rather than tucked in a corner: it is the one thing here
   that acts on the drawing, and a button the width of what it sits under is
   easier to hit than one the width of its own word. */
.toolbar #action-fit {
  align-self: stretch;
  text-align: center;
  padding: 4px 0;
}
.legend .added { color: var(--status-added); }
.legend .modified { color: var(--status-modified); }
.legend .deleted { color: var(--status-deleted); }
.legend .renamed { color: var(--status-renamed); }
.legend .phantom { color: var(--status-phantom); }


/* ----------------------------------------------------------------- viewport */

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
}
.viewport.panning { cursor: grabbing; }

.canvas {
  position: absolute;
  transform-origin: 0 0;
  /* Deliberately not promoted at rest. A layer carrying will-change: transform
     is rasterised once and then stretched as a bitmap, so zooming in magnifies
     pixels instead of redrawing glyphs — code goes soft exactly when it is
     being read closely. Promotion is granted only while the view is moving,
     where the trade is worth it, and given back on settle so the browser
     redraws the text at the scale it is actually shown. */
  will-change: auto;
}
.canvas.moving { will-change: transform; }

/* -------------------------------------------------------------------- cards */

.card {
  position: absolute;
  background: var(--card-bg);
  border: 1.5px solid var(--status-modified);
  border-radius: 14px;
  overflow: hidden;
  transition: box-shadow 160ms ease, border-color 160ms ease, opacity 160ms ease;
}

.card.status-added    { border-color: var(--status-added); }
.card.status-modified { border-color: var(--status-modified); }
.card.status-deleted  { border-color: var(--status-deleted); }
.card.status-renamed  { border-color: var(--status-renamed); }
.card.status-phantom  { border-color: var(--status-phantom); border-style: dashed; }

.card-title {
  /* Sits above the code so it can be moved down over it: the card's name stays
     in view while the card runs off the top of the window. */
  position: relative;
  z-index: 3;
  background: var(--card-bg);
  height: var(--title-height);
  padding: 0 var(--padding);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: calc(var(--font-size) + 1px);
  color: var(--status-modified);
  cursor: pointer;
}
/* Only while it is being held in place, so a card sitting still in the middle
   of the canvas looks exactly as it did. */
.card-title.pinned {
  box-shadow: 0 1px 0 0 color-mix(in srgb, var(--text) 14%, transparent),
              0 6px 12px color-mix(in srgb, #000 30%, transparent);
}

/* The file list's own mark, in the title's colour: the card says what kind of
   change it is in the same shape the list does. */
.card-title .box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.status-phantom .card-title .box { border-style: dashed; }

.status-added    .card-title { color: var(--status-added); }
.status-deleted  .card-title { color: var(--status-deleted); }
.status-renamed  .card-title { color: var(--status-renamed); }
.status-phantom  .card-title { color: var(--status-phantom); }

.card-title .was { color: var(--muted); font-size: calc(var(--font-size) - 1px); }
.card-title .stats { color: var(--muted); font-size: calc(var(--font-size) - 2px); }
.card-title .stats .added { color: var(--added); }
.card-title .stats .removed { color: var(--removed); }

/* A file nothing could read. Marked rather than left blank, because a card
   with no arrows otherwise looks like a file that references nothing. */
/* Marking a file reviewed is a per-reader note, not a fact about the change,
   so it sits apart from the counts and stays quiet until hovered. */
.card-title .viewed {
  display: inline-flex;
  align-items: center;
  /* The box and the word are one control, but they are not one glyph: touching
     they read as a box with a broken border. */
  gap: 6px;
  padding: 0 2px;
  flex: 0 0 auto;
  opacity: 0.35;
  cursor: pointer;
  transition: opacity 120ms ease;
}
.card-title .viewed:hover,
.card.is-viewed .card-title .viewed { opacity: 1; }
.card-title .viewed input { margin: 0; cursor: pointer; }

/* The forge's file-header controls, grouped at the end of the title. */
.card-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex: 0 0 auto;
}
.card-controls > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 auto;
  height: 20px;
  min-width: 20px;
  padding: 0 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: calc(var(--font-size) - 2px);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.card-controls > button:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 14%, transparent);
}
/* Said out loud, because a checkbox alone on a file header is a question with
   no wording: read what? */
.card-title .viewed-label {
  font-size: calc(var(--font-size) - 2px);
  color: var(--muted);
}
.card.is-viewed .card-title .viewed-label { color: var(--text); }
/* Nothing said about this file yet, so nothing to say about it. */
.card-controls .remarks .tally { font-variant-numeric: tabular-nums; }

/* Opening the file is a separate intention from reading the change to it, so it
   gets a control of its own rather than a modifier on the filename. */
.card-title .jump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  opacity: 0.35;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease;
}
.card:hover .card-title .jump { opacity: 0.8; }
.card-title .jump { opacity: 0.8; }
.card-title .jump:hover {
  opacity: 1;
  color: var(--text);
  background: color-mix(in srgb, var(--text) 14%, transparent);
}


.card.is-viewed { opacity: 0.45; }
/* Settled by its callers rather than by a click: dimmed like the rest, but
   without the checkbox lighting up, which would claim a decision nobody made. */
.card.is-implied .card-title .viewed { opacity: 0.2; }

.card-title .note {
  color: var(--warning);
  font-size: calc(var(--font-size) - 2px);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-radius: 5px;
  padding: 0 6px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.card.unresolved { border-style: dashed; }

/* A pill radius on a box that has wrapped turns it into a circle, which is
   what a narrow editor panel does to it. Fixed radius, one line, and let the
   toolbar scroll instead. */
.toolbar .gaps {
  align-self: center;
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-radius: 5px;
  padding: 1px 8px;
  white-space: nowrap;
  flex: 0 0 auto;
}

.card-body { padding: var(--padding) 0; }
/* Both readings of the change are in the document; the page shows one. */
body.split .card-body.unified-view,
body:not(.split) .card-body.split-view { display: none; }

.row {
  display: flex;
  height: var(--line-height);
  line-height: var(--line-height);
  font-size: var(--font-size);
  white-space: pre;
}
/* A run of changed lines is one block of colour, not a stack of them.
   Row heights are whole CSS pixels, but the canvas is scaled by a fraction, so
   two rows that share an edge land it between device pixels and the compositor
   antialiases both sides of it — a hairline of the page showing through every
   boundary. Each row paints one pixel up into its own kind of neighbour, which
   closes the seam without touching layout: a shadow occupies no space, so
   nothing that measures rows can notice. Adjacency does the work of a wrapper
   element, which would break the sibling rules that open and close gaps. */
.row.split:has(.side.add) + .row.split .side.add { box-shadow: 0 -1px 0 0 var(--add-bg); }
.row.split:has(.side.del) + .row.split .side.del { box-shadow: 0 -1px 0 0 var(--del-bg); }
.row.split:has(.side.empty) + .row.split .side.empty { box-shadow: 0 -1px 0 0 var(--gap-bg); }
.row.flat.add + .row.flat.add { box-shadow: 0 -1px 0 0 var(--add-bg); }
.row.flat.del + .row.flat.del { box-shadow: 0 -1px 0 0 var(--del-bg); }
.row.gap + .row.gap { box-shadow: 0 -1px 0 0 var(--gap-bg); }

/* A collapsed run of untouched code, banded the way a diff viewer marks the
   part of a file it is not showing. */
.row.gap {
  background: var(--gap-bg);
  color: var(--muted);
  font-size: calc(var(--font-size) - 1px);
  padding: 0 var(--padding);
  justify-content: space-between;
  gap: 12px;
}
/* Rows the card starts out hiding: past the height cap, or inside a closed
   gap. Present in the document, absent from the picture. */
.row.beyond-cap,
.row.in-gap { display: none; }
.card.expanded .row.beyond-cap { display: flex; }
.row.gap.open + .row.in-gap,
.row.in-gap.open { display: flex; }

/* Gaps open and close rather than opening once, so a band keeps its row
   instead of dissolving into what it revealed and leaving no way back. */
.row.gap.expandable.open { color: var(--gutter); }
.row.gap.expandable.open .text::before { content: "▾ "; }
.row.gap.expandable:not(.open) .text::before { content: "▸ "; }

.row.gap.expandable,
.row.more {
  cursor: pointer;
  user-select: none;
}
.row.gap.expandable:hover,
.row.more:hover { color: var(--text); }

.row.more {
  background: var(--gap-bg);
  color: var(--muted);
  font-size: calc(var(--font-size) - 1px);
  justify-content: center;
}
.row.more .text { flex: 0 0 auto; }
/* Sized to its words rather than stretched across the row: a box placed after
   the label is placed after the words, and a stretched span ends at the far
   side of the card. */
.row.gap .text { flex: 0 0 auto; }

.row.gap .header {
  color: var(--gutter);
  font-size: calc(var(--font-size) - 2px);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Two panes: the base of the change on the left, the head on the right. Equal
   halves of the row, each with its own marker, number and code, so a line and
   the line that replaced it read across rather than down and both numbers are
   real. The card was measured as two of these plus its padding. */
/* One column of code, a gutter either side of it: the base number on the left
   and the head number on the right, which is how this card answers "where is
   this line in each checkout". */
.row.flat { padding: 0 var(--padding); }
.row.flat.add { background-color: var(--add-bg); color: var(--added); }
.row.flat.del { background-color: var(--del-bg); color: var(--removed); }
.row.flat.add .marker, .row.flat.del .marker { color: inherit; }
.row.flat .num.new {
  width: calc(var(--right-gutter-width) - 14px);
  padding-right: 0;
  padding-left: 8px;
}
/* The plus lives on the head side, where the line it marks has its number. */
.row.flat .marker.right {
  width: 14px;
  padding-left: 4px;
  text-align: left;
}

/* An edge marker down both sides of the card, in the diff's own colours, so a
   run of changed lines is visible from further out than the code inside it can
   be read -- and so a row whose other side is empty still says what happened to
   it. Painted as the row's own background under the padding, which is the strip
   between the card border and where a pane begins. */
.row.flat.add,
.row.split:has(.side.add):not(:has(.side.del)) {
  background-image:
    linear-gradient(to right, var(--added) 0 3px, transparent 3px),
    linear-gradient(to left, var(--added) 0 3px, transparent 3px);
}
.row.flat.del,
.row.split:has(.side.del):not(:has(.side.add)) {
  background-image:
    linear-gradient(to right, var(--removed) 0 3px, transparent 3px),
    linear-gradient(to left, var(--removed) 0 3px, transparent 3px);
}
/* A line rewritten in place: what it was on the left, what it became on the
   right, which is the same story the two panes tell. */
.row.split:has(.side.del):has(.side.add) {
  background-image:
    linear-gradient(to right, var(--removed) 0 3px, transparent 3px),
    linear-gradient(to left, var(--added) 0 3px, transparent 3px);
}

.row.split { padding: 0 var(--padding); }
.row.split .side {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
}
.row.split .side.add { background: var(--add-bg); color: var(--added); }
.row.split .side.del { background: var(--del-bg); color: var(--removed); }
/* Nothing on this side of the change: not blank code, no code. */
.row.split .side.empty { background: var(--gap-bg); opacity: 0.35; }

.row .marker {
  width: 14px;
  /* Inside the marker's own box, which is border-box, so the gutter is still
     exactly as wide as the layout engine measured it. Without this the sign
     sits against the card border and reads as part of the frame. */
  padding-left: 5px;
  flex: 0 0 auto;
  color: var(--gutter);
}
.row .num {
  color: var(--gutter);
  opacity: 0.85;
  font-size: calc(var(--font-size) - 1px);
  text-align: right;
  padding-right: 8px;
  width: calc(var(--gutter-width) - 22px);
  flex: 0 0 auto;
  user-select: none;
}
.row .marker { flex: 0 0 auto; }
.row .side.add .marker, .row .side.del .marker { color: inherit; }

/* min-width:0 is load-bearing: without it a flex item refuses to shrink below
   its own content, so a long pre-formatted line runs past the card border and
   out from under the line numbers. */
.row .text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Rows an arrow touches get a marker so the eye can find them without
   following the line all the way back. */
.row.anchor::after {
  content: "";
  position: absolute;
  right: 0;
  width: 3px;
  height: var(--line-height);
  background: currentColor;
  opacity: 0;
}

/* -------------------------------------------------------------------- edges */

#edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

#edges path.wire {
  fill: none;
  stroke-width: 1.8;
  opacity: 0.85;
  transition: opacity 160ms ease, stroke-width 160ms ease;
}
/* Carries the head and nothing else: the stem already stopped where it starts. */
#edges path.head {
  fill: none;
  stroke: none;
}
#edges path.hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  pointer-events: stroke;
  cursor: pointer;
}
#edges g.edge.added    path.wire { stroke: var(--added); }
#edges g.edge.removed  path.wire { stroke: var(--removed); }
#edges g.edge.unchanged path.wire { stroke: var(--unchanged); }
#edges g.edge.import   path.wire { stroke-dasharray: 4 4; opacity: 0.5; }

#edges g.edge.hidden { display: none; }
#edges g.edge.dim path.wire { opacity: 0.12; }
#edges g.edge.active path.wire { opacity: 1; stroke-width: 3; }

.card.hidden,
.card.viewed-hidden { display: none; }
#edges g.edge.viewed-hidden { display: none; }
.card.dim { opacity: 0.32; }
.card.active { box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 22%, transparent); }
.card.flash { animation: flash 900ms ease-out; }

@keyframes flash {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-renamed) 80%, transparent); }
  100% { box-shadow: 0 0 0 26px color-mix(in srgb, var(--status-renamed) 0%, transparent); }
}

/* -------------------------------------------------------------------- hover */

.tooltip {
  position: fixed;
  z-index: 30;
  max-width: 440px;
  padding: 7px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 92%, var(--text) 8%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}
.tooltip.visible { opacity: 1; }
.tooltip .arrow { color: var(--unchanged); font-weight: 600; }
.tooltip.added .arrow { color: var(--added); }
.tooltip.removed .arrow { color: var(--removed); }
.tooltip .target,
.tooltip .meta {
  white-space: normal;
  overflow-wrap: anywhere;
}
.tooltip .target { color: var(--text); }
.tooltip .meta { color: var(--muted); }
.tooltip .meta .at { color: var(--gutter); margin: 0 1px; }
.tooltip .meta .line { color: var(--text); opacity: 0.75; }

/* What the reference is says something different from where it goes, so it is
   set apart rather than run on as a third line of the same grey. */
.tooltip .facts {
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  color: var(--gutter);
  font-size: 10px;
  letter-spacing: 0.02em;
}
.tooltip .facts .added { color: var(--added); }
.tooltip .facts .removed { color: var(--removed); }
.tooltip .facts .unchanged { color: var(--unchanged); }

/* ------------------------------------------------------------------ review */

/* A line carrying a remark is marked in the margin rather than by tinting the
   row: the row's colour already says whether the line was added or removed,
   and overloading it would cost more than the marker is worth. */
.row.commented .comment-badge,
.row.drafted .comment-badge {
  position: absolute;
  right: 2px;
  min-width: 12px;
  height: 12px;
  margin-top: 3px;
  border-radius: 6px;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
  padding: 0 3px;
}
.row { position: relative; }
.row.commented .comment-badge {
  background: color-mix(in srgb, var(--status-renamed) 80%, transparent);
  color: var(--bg);
}
.row.drafted .comment-badge {
  background: color-mix(in srgb, var(--warning) 85%, transparent);
  color: var(--bg);
}
.card:not(.is-viewed) .row.commented,
.card:not(.is-viewed) .row.drafted { cursor: text; }

/* A remark covering several lines draws one bracket down the passage, so the
   extent is read at a glance instead of counted badge by badge. It is inset
   rather than laid over the row, because the row's own left edge is already
   spoken for by the added/removed marker. */
.row.commented::before,
.row.drafted::before {
  content: "";
  position: absolute;
  left: 0;
  /* A pixel past the row at each end so consecutive rows overlap. Meeting
     exactly leaves a hairline between them once the canvas scale turns whole
     pixels into fractions, and a bracket down a passage came out as a dashed
     one. */
  top: -1px;
  bottom: -1px;
  width: 3px;
  z-index: 1;
}
.row.commented::before { background: var(--status-renamed); }
.row.drafted::before { background: var(--warning); }
/* The ends of the passage are the only places the bracket stops. */
.row.span-start::before { border-top-left-radius: 2px; top: 1px; }
.row.span-end::before { border-bottom-left-radius: 2px; bottom: 1px; }

/* The lines a comment is about to be written against. Selected text inside a
   card would say the same thing more faintly and would be lost the moment the
   composer took focus, so the pick is held as state instead.

   Laid on as an image rather than a colour: the row's own background already
   says added or removed, and replacing it would cost that while the reader is
   choosing what to say about it. The wash tints, it does not overwrite. */
/* A pick is one block, not a stack of marked lines.
   The wash used to sit on top of whatever each row already was, so the diff's
   colours and the change markers down the card's edges showed through it and
   read as rules ruled between the rows. Inside a pick the row is flattened to
   one opaque colour across its whole width: the reader is choosing a passage,
   and which of its lines were added is a question for after they have chosen. */
.row.picked {
  background-color: color-mix(in srgb, var(--warning) 20%, var(--card-bg));
  background-image: none;
}
.row.split.picked .side,
.row.split.picked .side.add,
.row.split.picked .side.del,
.row.split.picked .side.empty {
  background: transparent;
  box-shadow: none;
  opacity: 1;
}
.row.flat.picked.add,
.row.flat.picked.del {
  background-color: color-mix(in srgb, var(--warning) 20%, var(--card-bg));
  background-image: none;
  box-shadow: none;
}
/* Gutter grey on a lit background is the one place these numbers are hard to
   read, and a picked range is exactly when they are being read: the reader is
   about to quote them. */
.row.picked .num { color: var(--text); opacity: 0.9; }
.row.picked .marker { color: color-mix(in srgb, var(--text) 75%, transparent); }

.card.picking { user-select: none; }

/* The same button the pick's own handles are, offered before there is a pick:
   hovering the rail says a remark can start here, in the place it would start. */
.pick-hint {
  position: absolute;
  top: 1px;
  width: 18px;
  height: calc(var(--line-height) - 2px);
  border-radius: 5px;
  background: var(--status-renamed);
  color: #fff;
  font-weight: 700;
  font-size: calc(var(--font-size) + 1px);
  line-height: calc(var(--line-height) - 2px);
  text-align: center;
  cursor: cell;
  user-select: none;
  z-index: 2;
}
.pick-hint:hover { filter: brightness(1.15); }

/* Where a remark starts. The rail is the only part of a row that begins one,
   so it is the only part that says it can: pressing the code used to open a
   composer over the passage being read, and the way out was to notice. */
.card:not(.is-viewed) .row.in-diff .marker,
.card:not(.is-viewed) .row.in-diff .num { cursor: cell; }
.card:not(.is-viewed) .row.in-diff .marker:hover,
.card:not(.is-viewed) .row.in-diff .num:hover {
  color: var(--status-renamed);
}

/* The pick's own edge, drawn where the code starts rather than at the row's
   left edge: that is the line the eye already follows down a diff. */
.pick-edge {
  position: absolute;
  left: calc(var(--gutter-width) - 1px);
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--status-renamed);
  pointer-events: none;
}

/* The handles at the two ends of the pick. They straddle the same edge, which
   is what makes a span read as one thing with a top and a bottom rather than
   as a stack of marked rows. */
/* Clear of the numbers rather than straddling them: the handle sat centred on
   the code's edge, and its left half covered the line number of the row it
   marks -- the number the reader needs most while choosing a range. */
.pick-plus {
  position: absolute;
  left: calc(var(--gutter-width) + 3px);
  top: 1px;
  width: 18px;
  height: calc(var(--line-height) - 2px);
  border-radius: 5px;
  background: var(--status-renamed);
  color: #fff;
  font-weight: 700;
  font-size: calc(var(--font-size) + 1px);
  line-height: calc(var(--line-height) - 2px);
  text-align: center;
  cursor: pointer;
  user-select: none;
  z-index: 2;
}
.pick-plus:hover { filter: brightness(1.15); }

/* The composer is pinned under the line it is about, at the card's own left
   edge — the way an inline comment box sits in a diff, rather than floating
   where the cursor happened to be. A remark belongs to a passage of code, and a
   box that hides that passage or drifts away from it makes the reviewer hold
   the connection in their head instead of seeing it. */
/* Wide enough for the toolbar to sit on one row: a box that writes markdown
   and hides half its buttons is worse than one that never offered them. */
.composer, .review {
  position: fixed;
  z-index: 40;
  width: 430px;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  font-size: 12px;
}
.composer {
  width: 520px;
  padding: 12px;
  box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
}
.composer[hidden], .review[hidden] { display: none; }

.composer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}
.composer-where { color: var(--text); font-weight: 600; font-size: 13px; }

/* One frame around the tabs, the tools and the field, so they read as a single
   control rather than three stacked ones. */
.editor {
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  border-radius: 7px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg) 80%, var(--text) 4%);
}
.editor-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  background: color-mix(in srgb, var(--bg) 60%, var(--text) 5%);
}
.editor .tab {
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  border-radius: 0;
  padding: 7px 11px;
  background: transparent;
  color: var(--muted);
}
.editor .tab.is-on {
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 80%, var(--text) 4%);
  border-bottom: 1px solid color-mix(in srgb, var(--bg) 80%, var(--text) 4%);
  margin-bottom: -1px;
}

.md-tools {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: auto;
  padding: 0 4px;
}
.editor .md {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.editor .md:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 12%, transparent);
}
/* Rules between the groups, as the forge has them: the suggestion stands alone,
   then the marks, then the lists. Ten of one thing would be a wall. */
.editor .md[data-md="heading"],
.editor .md[data-md="ol"] {
  margin-left: 6px;
  border-left: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
  border-radius: 0 5px 5px 0;
  padding-left: 6px;
  width: 30px;
}
.editor .md svg { display: block; }

.editor-body {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-family: var(--mono);
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 80%, var(--text) 4%);
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
  border-radius: 5px;
  padding: 6px;
  resize: vertical;
}
.editor-body {
  display: block;
  border: 0;
  border-radius: 0;
  padding: 9px 10px;
  min-height: 96px;
}
.editor-body:focus { outline: none; }

/* Preview renders a deliberately small subset. Whatever it does not know how to
   draw is shown as the text that was typed, which is what the forge will store
   anyway — better a plain line than a confident wrong rendering. */
.editor-preview {
  padding: 10px;
  min-height: 96px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.editor-preview .empty { color: var(--muted); }
.editor-preview p { margin: 0 0 8px; }
.editor-preview ul, .editor-preview ol { margin: 0 0 8px; padding-left: 20px; }
.editor-preview blockquote {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 3px solid color-mix(in srgb, var(--text) 20%, transparent);
  color: var(--muted);
}
.editor-preview pre {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  overflow-x: auto;
}
.editor-preview code {
  font-family: var(--mono);
  font-size: 11px;
}
.editor-preview p > code,
.editor-preview li > code,
.editor-preview td > code {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
}
.editor-preview h1, .editor-preview h2, .editor-preview h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
/* The language a block declares, so an uncoloured one still says what it is. */
.editor-preview pre .lang,
.remark .text pre .lang {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.editor-preview table,
.remark .text table {
  border-collapse: collapse;
  margin: 0 0 8px;
  font-size: 11px;
}
.editor-preview th, .editor-preview td,
.remark .text th, .remark .text td {
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
  padding: 3px 8px;
  text-align: left;
}
.editor-preview th, .remark .text th {
  background: color-mix(in srgb, var(--text) 7%, transparent);
  font-weight: 600;
}
.editor-preview hr, .remark .text hr {
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
  margin: 8px 0;
}
.editor-preview del, .remark .text del { color: var(--muted); }


.composer-actions, .review-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 8px;
}
.composer button, .review button {
  font: inherit;
  color: var(--muted);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
  border-radius: 5px;
  padding: 3px 10px;
  cursor: pointer;
}
.composer button:hover, .review button:hover { color: var(--text); }
.editor .md:hover { color: var(--text); }
.composer button.primary {
  color: var(--action-ink);
  background: var(--action);
  border-color: color-mix(in srgb, #000 22%, var(--action));
  font-weight: 600;
}
.composer button.primary:hover { color: var(--action-ink); filter: brightness(1.08); }
.composer-actions { align-items: center; }
.composer-actions .composer-cancel { font-weight: 600; color: var(--text); }

/* The panel sits at a corner rather than following the cursor: it is a summary
   of everything pending, not a remark about one line. */
.review { right: 16px; top: 96px; }
.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  margin-bottom: 6px;
}
/* A way out that is not the button that opened it. Closing keeps every draft:
   this panel is a view of what is pending, not the pending itself. */
.review .review-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: -4px -4px -4px 0;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.review .review-close:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 12%, transparent);
}
.review-list { max-height: 190px; overflow-y: auto; margin-bottom: 8px; }
.review-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 3px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
}
.review-item .where { color: var(--muted); flex: 0 0 auto; }
.review-item .what {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-item .drop { padding: 0 6px; font-size: 11px; }
.review-submit[data-event="APPROVE"] {
  color: var(--action-ink);
  background: var(--action);
  border-color: color-mix(in srgb, #000 22%, var(--action));
  font-weight: 600;
}
.review-submit[data-event="APPROVE"]:hover {
  color: var(--action-ink);
  filter: brightness(1.08);
}
.review-submit[data-event="REQUEST_CHANGES"] { color: var(--removed); border-color: var(--removed); }

.toolbar #action-review {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 50%, transparent);
}
.toolbar #action-review[hidden] { display: none; }

.hint {
  position: fixed;
  left: 14px;
  bottom: 12px;
  z-index: 20;
  color: var(--muted);
  font-size: 11px;
  text-align: left;
  line-height: 1.7;
  pointer-events: none;
}

/* ------------------------------------------------------------------- checks

   What the forge made of the branch, in the bar and in a list under it. */
.checks-menu { position: relative; flex: 0 0 auto; }
.checks {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.checks:hover { color: var(--text); background: color-mix(in srgb, var(--text) 10%, transparent); }
.checks-tally { font-variant-numeric: tabular-nums; }
/* Green while everything that has finished has passed, red the moment one has
   not: a reviewer wants the bad news without opening anything. */
.checks.ok { color: var(--action); }
.checks.bad { color: var(--removed); }
.checks.busy { color: var(--warning); }

.checks-list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 45;
  display: flex;
  flex-direction: column;
  width: 380px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
  font-size: 12px;
}
.check-row:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
.check-row .mark { flex: 0 0 auto; display: inline-flex; width: 14px; }
.check-row.passed .mark { color: var(--action); }
.check-row.failed .mark { color: var(--removed); }
.check-row.running .mark { color: var(--warning); }
.check-row.skipped .mark { color: var(--gutter); }
.check-row .name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.check-row .flow { color: var(--muted); }
.checks-empty { padding: 8px; color: var(--muted); font-size: 12px; }

/* --------------------------------------------------------------- reviewers

   Everyone who has left a remark, as a row of faces under the chrome. Clicking
   one lists what that person said; clicking a line of that goes to it. */
.reviewers {
  position: fixed;
  right: 14px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
/* The forge's own list, in the forge's own order: who was asked, and how far
   they have got. */
.review-list {
  width: 220px;
  padding: 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  font-size: 12px;
}
.review-head {
  color: var(--muted);
  padding: 0 2px 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  margin-bottom: 4px;
}
.reviewer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  color: var(--text);
  text-decoration: none;
  border-radius: 5px;
}
.reviewer-row:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
.reviewer-row .face {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex: 0 0 auto;
  object-fit: cover;
}
.reviewer-row .face.team {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  background: color-mix(in srgb, var(--text) 10%, transparent);
}
.reviewer-row .login {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Approved, changes asked for, spoke without a verdict, or still waiting. */
.reviewer-row .state { flex: 0 0 auto; display: inline-flex; }
.reviewer-row .state.ok { color: var(--action); }
.reviewer-row .state.warn { color: var(--removed); }
.reviewer-row .state.waiting,
.reviewer-row .state.said {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning);
}
.reviewer-row .state.said { background: var(--status-renamed); }

.faces {
  display: flex;
  flex-direction: row-reverse;
  padding: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
/* Overlapped, and the one under the pointer comes forward: a row of faces is
   one object saying who is in the conversation, not five separate buttons. */
.faces .reviewer {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--bg);
  margin-left: -9px;
  cursor: pointer;
  object-fit: cover;
  transition: transform 120ms ease;
}
.faces .reviewer:last-child { margin-left: 0; }
.faces .reviewer:hover,
.faces .reviewer.on { transform: translateY(-2px) scale(1.06); z-index: 2; }
.faces .reviewer.initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--bg);
  background: var(--status-renamed);
}

.reviewer-panel {
  width: 320px;
  max-height: 50vh;
  overflow-y: auto;
  padding: 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
  font-size: 12px;
}
.reviewer-panel .who {
  padding: 4px 8px 6px;
  color: var(--muted);
}
.reviewer-panel .remark-link {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.reviewer-panel .remark-link:hover {
  background: color-mix(in srgb, var(--text) 10%, transparent);
}
.reviewer-panel .where {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--status-renamed);
}
.reviewer-panel .by { color: var(--text); }
.reviewer-panel .said {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ------------------------------------------------------------------ remarks

   Comments already on the pull request, shown beside the file rather than in
   it. A remark is about a line but it is not part of the code, and threading it
   through the diff pushes the code around to make room for something the reader
   may not want to read yet. The mark sits in the margin, at the height of the
   line it belongs to, and opens on being asked. */
/* A layer over the canvas rather than part of it, so the faces keep their size
   and stay clear of the arrows they would otherwise be buried under. */
.marks {
  position: fixed;
  inset: 0;
  z-index: 22;
  pointer-events: none;
}
.mark {
  position: fixed;
  pointer-events: auto;
  --mark-size: 26px;
  width: var(--mark-size);
  height: var(--mark-size);
  cursor: pointer;
}
/* A pointer back to the line, so the mark belongs to something rather than
   floating beside the card. */
.mark .tail {
  position: absolute;
  /* Clear of the face rather than growing out of it: the two are a pointer and
     a portrait, and touching they read as one lopsided shape. */
  right: calc(var(--mark-size) * -0.5);
  top: 50%;
  width: 0;
  height: 0;
  margin-top: calc(var(--mark-size) * -0.19);
  border: calc(var(--mark-size) * 0.19) solid transparent;
  border-left-color: color-mix(in srgb, var(--text) 34%, transparent);
}
.mark .face {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: color-mix(in srgb, var(--text) 14%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--text) 34%, transparent);
  box-sizing: border-box;
}
/* No picture: the author's initials, which say who without pretending to be a
   photograph. */
.mark .face.initials {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--mark-size) * 0.38);
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.02em;
}
.mark:hover .face { border-color: var(--status-renamed); }
.mark.is-open .face { border-color: var(--status-renamed); }

/* How many remarks are on the thread, when there is more than one. */
.mark .bubble {
  position: absolute;
  right: calc(var(--mark-size) * -0.16);
  bottom: calc(var(--mark-size) * -0.14);
  min-width: calc(var(--mark-size) * 0.55);
  height: calc(var(--mark-size) * 0.55);
  padding: 0 calc(var(--mark-size) * 0.14);
  border-radius: 999px;
  background: var(--status-renamed);
  color: #fff;
  font-size: calc(var(--mark-size) * 0.34);
  font-weight: 700;
  line-height: calc(var(--mark-size) * 0.55);
  text-align: center;
  box-shadow: 0 0 0 2px var(--bg);
}

/* The thread itself, under the mark that opened it. Fixed rather than placed on
   the canvas: prose at a tenth of its size is not readable, and a comment is
   not part of the drawing. */
.thread {
  position: fixed;
  z-index: 41;
  width: 430px;
  max-height: 60vh;
  /* A column, so the reply box stays put and the remarks scroll behind it. A
     long thread used to push the button that answers it off the bottom of the
     popover, which left the reader scrolling to reach the one control they
     opened the thread to use. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
  font-size: 12px;
}
.thread-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--muted);
}
.thread-where { font-family: var(--mono); }
.thread .thread-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: -4px -4px -4px 0;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.thread .thread-close:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 12%, transparent);
}

.remark { display: flex; gap: 8px; padding: 7px 0; }
.remark + .remark { border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent); }
.remark .face { width: 22px; height: 22px; flex: 0 0 auto; }
.remark .said { min-width: 0; flex: 1 1 auto; }
.remark .who { color: var(--text); font-weight: 600; }
.remark .when { color: var(--muted); margin-left: 6px; font-size: 11px; }
.remark .outdated {
  margin-left: 6px;
  color: var(--warning);
  font-size: 10px;
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  border-radius: 999px;
  padding: 0 6px;
}
.remark .text { margin-top: 3px; line-height: 1.5; overflow-wrap: anywhere; }
.remark .text p { margin: 0 0 6px; }
.remark .text pre {
  margin: 0 0 6px;
  padding: 7px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  overflow-x: auto;
}
.remark .text code { font-family: var(--mono); font-size: 11px; }
.remark .text p > code,
.remark .text li > code,
.remark .text td > code {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
}
.remark .text ul, .remark .text ol { margin: 0 0 6px; padding-left: 18px; }

/* What was left on a remark, and the way to leave one. */
.reactions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.reactions .pill,
.reactions .add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
/* Room for the face, and no more: it is one glyph, not a label. */
.reactions .add { width: 34px; padding: 0; }
.reactions .add svg { display: block; }
.reactions .pill .emoji { font-size: 13px; line-height: 1; }
.reactions .pill:hover,
.reactions .add:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--status-renamed) 60%, transparent);
}
.reactions .pill .n { font-weight: 600; }

/* The eight the forge offers, in the order it offers them. */
.picker {
  position: fixed;
  z-index: 43;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 45%, transparent);
}
.picker button {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.picker button:hover { background: color-mix(in srgb, var(--text) 14%, transparent); }

/* One remark's own actions. Quiet until the remark is under the pointer, the
   way the forge keeps them out of the way of the words. */
.remark .more-actions {
  margin-left: auto;
  width: 22px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  opacity: 0;
  cursor: pointer;
}
.remark:hover .more-actions { opacity: 0.8; }
.remark .more-actions:hover { opacity: 1; background: color-mix(in srgb, var(--text) 12%, transparent); }
.remark .said > div:first-child { display: flex; align-items: center; gap: 2px; }

.menu {
  position: fixed;
  z-index: 44;
  min-width: 190px;
  padding: 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 45%, transparent);
}
.menu button {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 6px 9px;
  cursor: pointer;
}
.menu button:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
.menu button.danger { color: var(--removed); }
.menu .divider {
  height: 1px;
  margin: 4px 2px;
  background: color-mix(in srgb, var(--text) 12%, transparent);
}

/* Answering in the thread, rather than starting another one beside it. */
/* The remarks are what grows; everything else in the popover holds still. */
.thread-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.thread-reply {
  flex: 0 0 auto;
  margin-top: 10px;
}
.reply-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
.thread-reply .primary {
  font: inherit;
  font-weight: 600;
  color: var(--action-ink);
  background: var(--action);
  border: 1px solid color-mix(in srgb, #000 22%, var(--action));
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
}
.thread-reply .primary:hover { filter: brightness(1.08); }
.remark .text blockquote {
  margin: 0 0 6px;
  padding-left: 9px;
  border-left: 3px solid color-mix(in srgb, var(--text) 20%, transparent);
  color: var(--muted);
}

/* A suggestion is a change, drawn as one: what it replaces above what it puts
   there, numbered where those lines sit in the file. A block of green with no
   idea what it is replacing is half the story. */
.suggestion {
  margin: 0 0 8px;
  border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
  border-radius: 6px;
  overflow: hidden;
}
.suggestion-head {
  padding: 6px 10px;
  color: var(--muted);
  border-bottom: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
}
.suggestion table {
  width: 100%;
  margin: 0;
  border: 0;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 11px;
}
.suggestion td {
  border: 0;
  padding: 1px 0;
  vertical-align: top;
}
/* nowrap is load-bearing: the number column is sized to its content, and
   without it "23" wraps to a "2" over a "3" — which reads as two rows with the
   wrong numbers on them, and doubles the height of every line. */
.suggestion .n {
  width: 1px;
  padding: 1px 8px;
  text-align: right;
  white-space: nowrap;
  color: var(--gutter);
  background: color-mix(in srgb, var(--text) 6%, transparent);
  user-select: none;
}
.suggestion .m {
  width: 1px;
  padding: 1px 8px 1px 4px;
  white-space: nowrap;
  user-select: none;
}
/* A long line stays a long line. Wrapping it puts one line of code on two rows
   with one number between them, which is exactly the confusion the two number
   columns exist to prevent; the table scrolls sideways instead. */
.suggestion .code {
  padding-right: 10px;
  white-space: pre;
}
.suggestion { overflow-x: auto; }
.suggestion .del { background: var(--del-bg); }
.suggestion .add { background: var(--add-bg); }
.suggestion .del .m { color: var(--removed); }
.suggestion .add .m { color: var(--added); }

/* -------------------------------------------------------------- teleporters

   An arrow says where a reference goes; these two make the graph go there. The
   dot at its start jumps to the definition, the dashes past its head jump back
   to the call. On a change of any size the alternative is finding the other end
   by eye, and then finding your way home the same way. */
#edges .port {
  cursor: pointer;
  pointer-events: all;
  transition: opacity 120ms ease;
}
#edges circle.port {
  fill: var(--bg);
  stroke-width: 2.5;
  opacity: 0.9;
}
#edges g.edge.added .port { stroke: var(--added); }
#edges g.edge.removed .port { stroke: var(--removed); }
#edges g.edge.unchanged .port { stroke: var(--unchanged); }

#edges g.edge:hover .port,
#edges g.edge.active .port { opacity: 1; }
#edges circle.port:hover { fill: var(--added); }
#edges g.edge.removed circle.port:hover { fill: var(--removed); }
#edges g.edge.unchanged circle.port:hover { fill: var(--unchanged); }

/* A dimmed edge keeps its ports out of the way with it. */
#edges g.edge.dim .port { opacity: 0.1; pointer-events: none; }
#edges g.edge.hidden .port { display: none; }

/* The word an arrow lands on, boxed. The arrow reaches the line; this says
   which name on it, which is the difference between "somewhere in here" and
   the answer. Filled faintly rather than outlined alone, so it reads at the
   zoom a whole change is taken in at. */
.symbol-box {
  position: absolute;
  top: 1px;
  height: calc(var(--line-height) - 2px);
  border-radius: 3px;
  cursor: pointer;
}
/* Pressing it goes back to the call. The box is already at the far end of the
   journey, and it is the only thing there that belongs to the arrow. */
.symbol-box:hover { filter: brightness(1.5); }
/* On a band there is no code underneath, so the box carries the name itself. */
.symbol-box.folded {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  opacity: 0.85;
  white-space: pre;
  overflow: hidden;
}
.symbol-box[data-change="added"] {
  border: 1px solid color-mix(in srgb, var(--added) 75%, transparent);
  background: color-mix(in srgb, var(--added) 16%, transparent);
}
.symbol-box[data-change="removed"] {
  border: 1px solid color-mix(in srgb, var(--removed) 75%, transparent);
  background: color-mix(in srgb, var(--removed) 16%, transparent);
}
.symbol-box[data-change="unchanged"] {
  border: 1px solid color-mix(in srgb, var(--unchanged) 65%, transparent);
  background: color-mix(in srgb, var(--unchanged) 14%, transparent);
}
`;
}
