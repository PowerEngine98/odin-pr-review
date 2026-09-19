import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { menuPlace } from "../src/app/panels/caret.js";

const field = {
  offsetTop: 40,
  offsetLeft: 12,
  scrollTop: 0,
  scrollLeft: 0,
  clientWidth: 600,
  lineHeight: 18,
};

/**
 * Where the list of names opens when a reader types `@` in a remark.
 *
 * It opened at the left edge of the box whatever the reader was writing, so
 * an `@` half-way along a sentence summoned a list a whole sentence away from
 * it. These pin the list to the `@` that summoned it.
 */
describe("the list of names under the @", () => {
  it("opens under the @, not at the left edge of the field", () => {
    const place = menuPlace({ top: 6, left: 300 }, field, 180);
    expect(place.left).toBe(field.offsetLeft + 300);
    expect(place.left).toBeGreaterThan(field.offsetLeft);
  });

  it("opens on the line below the one the @ is on", () => {
    // Line three of the field, measured where it is drawn.
    const place = menuPlace({ top: 6 + 2 * 18, left: 20 }, field, 180);
    expect(place.top).toBe(field.offsetTop + 6 + 2 * 18 + 18 + 4);
  });

  it("is moved back left rather than hanging off the end of the field", () => {
    // An @ near the right edge: the list would overrun by most of its width.
    const place = menuPlace({ top: 6, left: 560 }, field, 180);
    expect(place.left + 180).toBeLessThanOrEqual(field.offsetLeft + field.clientWidth);
  });

  it("follows the field when it has been scrolled", () => {
    const scrolled = { ...field, scrollTop: 36, scrollLeft: 0 };
    const place = menuPlace({ top: 6 + 3 * 18, left: 20 }, scrolled, 180);
    expect(place.top).toBe(field.offsetTop + 6 + 3 * 18 + 18 - 36 + 4);
  });

  it("never opens above the field, however far it has scrolled", () => {
    const scrolled = { ...field, scrollTop: 500 };
    expect(menuPlace({ top: 6, left: 20 }, scrolled, 180).top).toBe(field.offsetTop);
  });
});

/**
 * Where the `@` is measured from, which a unit test of the arithmetic cannot
 * see.
 *
 * The line used to be found by counting newlines before the caret, which is not
 * a count of lines: a remark that had run on to a second row without a newline
 * was measured as still on the first, and the list opened over the text being
 * written. Checked as source because the measuring needs a browser.
 */
describe("how the editor finds the @", () => {
  const editor = readFileSync(
    new URL("../src/app/panels/Editor.svelte", import.meta.url),
    "utf8",
  );

  it("measures where the field draws the @ rather than counting newlines", () => {
    expect(editor).not.toMatch(/\.split\("\\n"\)\.length/);
    expect(editor).toMatch(/drawnAt\(box, found\.from\)/);
  });

  it("gives the list a horizontal position of its own", () => {
    expect(editor).toMatch(/left:\{across\}px/);
    const rule = editor.match(/\.mentions \{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toMatch(/left:\s*12px/);
  });
});
