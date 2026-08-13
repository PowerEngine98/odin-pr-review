// First, and before the components. `state.svelte.ts` reads `window` while its
// own module is being evaluated, which happens as a side effect of importing
// anything that imports it — long before any `ssr` flag could be consulted.
import "./svg/globals.js";

import type { GraphLayout } from "@odin/core";
import { render } from "svelte/server";

import App from "./App.svelte";
import type { ViewModel } from "./model.js";
import type { Drawn } from "./svg/card.js";
import { drawingOf, type DrawingOptions } from "./svg/scene.js";

/**
 * The page as text, before anything has run.
 *
 * Three callers want this and want different amounts of it. A webview wants
 * markup it can show immediately and then wake up, so the reader is not
 * looking at an empty panel while a bundle parses. A file written by
 * `odin view` wants the same, and has to survive being opened somewhere the
 * script never runs at all. An SVG wants only the drawing, and will never run
 * anything.
 *
 * They are the same components either way. A static target is not a cut-down
 * renderer — it is this one, never asked for its second half.
 */
export interface Rendered {
  /** The markup, for the body. */
  body: string;
  /** Anything the components asked to have in the head. */
  head: string;
}

/**
 * Renders the whole page.
 *
 * The model is passed as a prop rather than read from `window`, because on
 * this side there is no window. The browser half reads `window.__ODIN__`; both
 * halves must be handed the same object or the markup the script wakes up into
 * will not be the markup it expects.
 */
export function renderApp(model: ViewModel): Rendered {
  const { body, head } = render(App, { props: { model, ssr: true } });
  return { body, head };
}

/**
 * Just the drawing, for a target with no page around it.
 *
 * The cards, the arrows and the marks, in one SVG root. No chrome, no panels,
 * no minimap: none of them mean anything in a file that will be dropped into a
 * document or a README, and several of them are buttons.
 */
export function renderDrawing(model: ViewModel, drawn: Drawn): string {
  const { body } = render(App, {
    props: { model, drawn, ssr: true, drawingOnly: true },
  });
  // The hydration markers come off. They are there so a script can find its
  // place in markup it is about to adopt, and nothing will ever adopt this: it
  // is a picture, finished the moment it is written. They also bracket the
  // whole rendering, so leaving them in puts two comments in front of the root
  // element — legal XML, and enough to make a consumer that looks at the first
  // few bytes decide the file is not an SVG.
  return body.replace(/<!--(?:\[-?\d*|\])?-->/g, "").trim();
}

/**
 * A laid-out graph as a standalone SVG.
 *
 * Deliberately the signature `@odin/core`'s static exporter has always had, so
 * that swapping one for the other is a line rather than a plumbing job — and so
 * that the two can be rendered side by side while the port settles, which is
 * how the cards here were checked against the picture they replace.
 *
 * A card is drawn by a component of its own rather than by the one the page
 * uses, because SVG cannot hold the page's markup. What is shared is everything
 * above that: the model, the arrangement, and the routing every arrow is drawn
 * from — which is where the two used to drift.
 */
export function renderSvg(layout: GraphLayout, options: DrawingOptions): string {
  const { model, drawn } = drawingOf(layout, options);
  return renderDrawing(model, drawn);
}
