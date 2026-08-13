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

/**
 * The policy the editor's own stylesheet has to get through.
 *
 * A webview is given a stylesheet by the editor — the theme's variables and the
 * defaults that make a document visible — and it arrives without a nonce. A
 * policy naming only this page's nonce blocks it, and on a restored frame what
 * the reader gets is nothing at all: the mark is written, it sits there for the
 * eight seconds the build takes, and none of it is painted. The graph's page
 * has always allowed both and has always rendered in that same frame.
 */
describe("letting the editor style its own webview", () => {
  it("allows the webview's own source and inline styles", () => {
    const html = waitingPage({
      mark: "<svg></svg>",
      note: "Reopening #1",
      pulsing: true,
      nonce: "n0nce",
      cspSource: "vscode-webview://x",
    });

    // The whole `content` of the policy tag. Taken with a pattern rather than
    // by slicing between two marks: the document opens with a `<meta charset>`
    // whose own closing quote comes first, so the naive slice reads backwards
    // and hands back nothing, which every assertion then passes over quietly.
    const policy = /Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(policy).toContain("style-src vscode-webview://x 'unsafe-inline'");
    // Scripts stay on the nonce: the page runs one line of its own and has no
    // reason to let anything else in.
    expect(policy).toContain("script-src 'nonce-n0nce'");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
  });
});
