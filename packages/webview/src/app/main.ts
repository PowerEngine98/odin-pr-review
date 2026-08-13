import { hydrate } from "svelte";

import App from "./App.svelte";
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
listen();

const target = document.getElementById("app");
if (target) hydrate(App, { target });
