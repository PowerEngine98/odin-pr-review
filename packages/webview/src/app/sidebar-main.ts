import { hydrate } from "svelte";

import { listen } from "./sidebar/state.svelte.js";
import Sidebar from "./sidebar/Sidebar.svelte";

/**
 * Wakes the sidebar up.
 *
 * `hydrate` rather than `mount`, and the difference is the whole view. The host
 * renders the components to text and puts that markup inside `#app`, so the
 * list is on screen before this script has parsed. `mount` does not know that:
 * it renders a second copy and appends it, leaving two of everything — two
 * progress bars, two file trees, two Review This Branch buttons, one of them
 * fixed over the other.
 *
 * `hydrate` adopts what is already there instead. Nothing is drawn twice and
 * nothing flashes: the markup the reader is already looking at is the markup
 * that becomes live.
 */
listen();

const target = document.getElementById("app");
if (target) hydrate(Sidebar, { target });
