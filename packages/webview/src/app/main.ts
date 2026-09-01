import { hydrate } from "svelte";

import App from "./App.svelte";
import { detours } from "./canvas/wire.js";
import { listen } from "./state.svelte.js";

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
 * Roads take the plain way until the cards have stopped moving.
 *
 * Planning them around the cards is worth doing once. During the first build
 * every measured card changes the map and throws away every road planned
 * against the old one — two and a half seconds of a large boot, measured,
 * spent planning around arrangements that were replaced before anyone saw
 * them. The drawing turns them on itself once it has settled.
 *
 * Only the live page does this. The written document, the standalone drawing
 * and the tests each render once, from cards that are already where they
 * belong, and plan from the first line.
 */
detours.set(false);

listen();

const target = document.getElementById("app");
if (target) hydrate(App, { target });
