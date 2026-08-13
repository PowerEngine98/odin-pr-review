import { DARK_THEME, type GraphLayout, type Theme } from "@odin/core";

import { APP_STYLES } from "./generated/app.js";

/**
 * The change as a standalone SVG, drawn by the application itself.
 *
 * The seam between the package and the compiled application. Two things can
 * only be reached from this side: the components' styles, which are a build
 * artefact rather than something a component can import without importing its
 * own build; and the theme, which is `@odin/core`'s and which the application
 * cannot import at runtime — everything it imports is bundled for a browser
 * too, and core's entry point reaches `node:child_process`.
 */
export interface SvgPageOptions {
  theme?: Theme;
  /** Draw arrows for references that were already there. */
  includeUnchanged?: boolean;
  /** Draw import edges. */
  includeImports?: boolean;
}

export async function renderSvg(
  layout: GraphLayout,
  options: SvgPageOptions = {},
): Promise<string> {
  // Loaded on demand, not at import. The application's own state module reads
  // `window` as it is evaluated, so the server bundle declares that global
  // before the components are loaded — which is harmless here and would not be
  // in an extension host, where half the world decides whether it is in a
  // browser by asking whether `window` exists. Nothing pays for that unless it
  // actually asks for a drawing.
  const { renderSvg: draw } = (await import("./generated/ssr.js")) as {
    renderSvg: (layout: GraphLayout, options: unknown) => string;
  };

  return draw(layout, {
    theme: options.theme ?? DARK_THEME,
    css: APP_STYLES,
    includeImports: options.includeImports !== false,
    includeUnchanged: options.includeUnchanged === true,
  });
}
