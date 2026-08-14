import { readFileSync } from "node:fs";
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

/**
 * One document per wait, unless there was no document.
 *
 * Two assignments to `webview.html` in quick succession do not produce two
 * pages: the editor tears the frame's document down to install the first, the
 * second arrives before it is standing, and the editor's own bootstrap throws
 * `Found unexpected null` swapping them. The frame is then empty for as long as
 * the build takes, with nothing anywhere saying why. Restoring a window calls
 * the loader twice within a fifth of a second — the interval that breaks.
 *
 * The exception is a frame that never ran the first page at all. There is no
 * document to tear down there, so nothing for a second to collide with, and the
 * page itself is what tells the two apart: it reports `waiting` once it is
 * running, and only silence buys a second write.
 */
describe("putting the wait on screen", () => {
  const showLoading = (() => {
    const source = readFileSync(new URL("../src/panel.ts", import.meta.url), "utf8");
    return source.slice(
      source.indexOf("static async showLoading"),
      source.indexOf("static note("),
    );
  })();

  it("renames a wait already on screen rather than replacing it", () => {
    expect(showLoading).toMatch(/postMessage\(\{\s*type:\s*"note"/);
  });

  it("writes the page unconditionally exactly once", () => {
    // Every other assignment has to sit behind a guard. An unguarded second one
    // is the bug this whole invariant exists for.
    const writes = [...showLoading.matchAll(/webview\.html\s*=/g)];
    expect(writes).toHaveLength(2);

    // The first is the write itself; the second must be inside the retry, and
    // the retry must be reached only after the page has failed to report.
    const retry = showLoading.slice(showLoading.indexOf("setTimeout"));
    expect(retry).toMatch(/webview\.html\s*=/);
    expect(retry).toMatch(/if \(arrived/);
  });

  it("listens for the page before it writes it", () => {
    // The page answers immediately. Registering afterwards would race the very
    // report the retry depends on, and a lost report means a needless second
    // write into a frame that was working.
    expect(showLoading.indexOf("onDidReceiveMessage")).toBeLessThan(
      showLoading.indexOf("webview.html ="),
    );
  });
});

/**
 * The page has to be able to report itself.
 *
 * Nothing outside the frame can tell a document that was taken from one that
 * was quietly dropped — both look like a successful assignment from the host.
 */
describe("the wait saying that it is running", () => {
  it("tells the host once it is", () => {
    const page = waitingPage({
      mark: "<svg></svg>",
      note: "Reopening #1",
      pulsing: true,
      nonce: "n",
      cspSource: "vscode-webview:",
    });
    expect(page).toMatch(/postMessage\(\{\s*type:\s*"waiting"/);
  });

  it("does not fall over where there is no host to tell", () => {
    // The same page is written to disk by the command line, and `odin view`
    // opens it from a file where `acquireVsCodeApi` does not exist.
    const page = waitingPage({
      mark: "<svg></svg>",
      note: "Reading",
      pulsing: true,
      nonce: "n",
      cspSource: "vscode-webview:",
    });
    const script = page.slice(page.lastIndexOf("<script"));
    expect(script).toMatch(/try\s*\{/);
    expect(script).toMatch(/catch/);
  });
});
