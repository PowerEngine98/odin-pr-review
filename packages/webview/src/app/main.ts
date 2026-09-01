import { hydrate } from "svelte";

import App from "./App.svelte";
import { bootStart } from "./hud/boot.svelte.js";
import { listen, restorePart } from "./state.svelte.js";

/**
 * Wakes the page up.
 *
 * `hydrate` rather than `mount`, and the difference is the whole page. The
 * host renders the components to text and puts that markup inside `#app`, so
 * the change is on screen before this script has parsed. `mount` does not know
 * that: it renders a second copy and appends it, leaving two of everything —
 * two canvases, two sets of arrows, two rows of faces stacked on each other,
 * each half of a pair fighting the other for the same fixed position.
 *
 * `hydrate` adopts what is already there instead, attaching to the existing
 * elements. Nothing is drawn twice and nothing flashes: the markup the reader
 * is already looking at is the markup that becomes live.
 */
/*
 * The build is watched rather than waited for.
 *
 * Said here, before anything is drawn, so that the first card to be placed is
 * already part of the sequence. Whatever is ready before the page wakes up
 * lands immediately, which is the honest picture of a small change: there was
 * nothing to watch.
 */
bootStart("reading the change");

listen();

/*
 * Back where the reader was.
 *
 * After the channel is open, so the file list beside the drawing is told at the
 * same moment the drawing narrows, and before the page is drawn, so the part is
 * the first thing built rather than a change of mind a beat later.
 */
restorePart();

const target = document.getElementById("app");
if (target) hydrate(App, { target });
