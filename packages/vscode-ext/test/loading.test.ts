import { describe, expect, it } from "vitest";

import { waitingPage } from "../src/loading.js";

const page = (over: Partial<Parameters<typeof waitingPage>[0]> = {}) =>
  waitingPage({
    mark: "<svg></svg>",
    note: "Reading the change",
    pulsing: true,
    nonce: "n0nce",
    cspSource: "vscode-webview:",
    ...over,
  });

describe("the page shown while there is no graph", () => {
  it("says what is being waited for", () => {
    expect(page()).toContain("Reading the change");
  });

  it("breathes while it waits", () => {
    expect(page({ pulsing: true })).toContain("animation: breathe");
  });

  it("stops once there is nothing more coming", () => {
    // An animation still running under a sentence saying the build found
    // nothing reads as a page that is still working.
    expect(page({ pulsing: false })).not.toContain("animation: breathe 1.7s");
  });

  it("carries the nonce the panel's policy allows", () => {
    const html = page();
    expect(html).toContain("'nonce-n0nce'");
    expect(html).toContain('<style nonce="n0nce">');
    expect(html).toContain('<script nonce="n0nce">');
  });

  it("puts the note in as data, not as markup", () => {
    // Branch names and git's own error messages end up here.
    const html = page({ note: 'nothing at <b>"origin/x"</b>' });
    expect(html).toContain(String.raw`"nothing at <b>\"origin/x\"</b>"`);
    expect(html).not.toContain("<b>\"origin/x\"</b><");
  });
});
