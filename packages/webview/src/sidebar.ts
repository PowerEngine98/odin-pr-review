import { DARK_THEME, type Theme } from "@odin/core";

import { SIDEBAR_SCRIPT, SIDEBAR_STYLES } from "./generated/sidebar.js";
import { renderSidebarApp } from "./generated/sidebar-ssr.js";
import type { SidebarModel } from "./sidebar-model.js";
import { sidebarTokens } from "./tokens.js";

/**
 * The sidebar as one self-contained document.
 *
 * Rendered twice over, the way the panel is: the markup comes from the
 * components running on this side, so the view shows the change the moment it
 * resolves rather than an empty strip while a bundle parses, and the same
 * components then wake up and take that markup over.
 *
 * They are handed the identical object. `window.__ODIN_SIDEBAR__` is what the
 * browser half reads, and rendering from anything else here would produce
 * markup the script did not expect to adopt.
 *
 * No content policy, deliberately. The view is created with no local resource
 * roots and serves nothing but this string; the faces in the chooser are
 * already inlined as data by the host, because a webview will not fetch a
 * remote image. Declaring a policy here would only be a second place to keep
 * that in step.
 */
export function renderSidebar(model: SidebarModel, theme: Theme = DARK_THEME): string {
  const rendered = renderSidebarApp(model);

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<style>${sidebarTokens(theme)}</style>`,
    // The components' own styles, scoped by the compiler. After the
    // vocabulary, so a component that means to override one can.
    `<style>${SIDEBAR_STYLES}</style>`,
    rendered.head,
    `</head><body>`,
    `<div id="app">${rendered.body}</div>`,
    `<script>window.__ODIN_SIDEBAR__=${payload(model)};</script>`,
    `<script>${SIDEBAR_SCRIPT}</script>`,
    `</body></html>`,
  ].join("\n");
}

/**
 * The model, as something safe to write into a script tag.
 *
 * `</script>` inside a string in the payload would end the tag early — the
 * parser is looking for those characters, not for JavaScript — and a pull
 * request title is written by whoever opened it. The escapes are invisible to
 * `JSON.parse` and to every reader of the resulting object.
 */
function payload(model: SidebarModel): string {
  return JSON.stringify(model)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    // Valid in JSON, but they terminate a JavaScript string literal, and
    // source text can legitimately contain them.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
