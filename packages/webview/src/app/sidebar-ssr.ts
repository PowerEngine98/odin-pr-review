import { render } from "svelte/server";

import type { SidebarModel } from "./sidebar/model.js";
import Sidebar from "./sidebar/Sidebar.svelte";

/**
 * The sidebar as text, before anything has run.
 *
 * The same arrangement the page uses: the host renders the components here and
 * puts the markup in the document it serves, so the view has the list in it the
 * moment it resolves rather than a blank strip while a bundle parses. The
 * script then adopts that markup rather than replacing it.
 *
 * A separate entry from the page's, because they are separate documents with
 * separate lifetimes — the view is rebuilt whenever the change or the question
 * behind the list changes, and the panel is not — and because the sidebar's
 * bundle has no reason to carry the canvas.
 */
export interface Rendered {
  /** The markup, for the body. */
  body: string;
  /** Anything the components asked to have in the head. */
  head: string;
}

/**
 * The model is passed as a prop rather than read from `window`, because on this
 * side there is no window. The browser half reads `window.__ODIN_SIDEBAR__`;
 * both halves must be handed the same object or the markup the script wakes up
 * into will not be the markup it expects.
 */
export function renderSidebarApp(model: SidebarModel): Rendered {
  const { body, head } = render(Sidebar, { props: { model, ssr: true } });
  return { body, head };
}
