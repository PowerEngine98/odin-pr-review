import { describe, expect, it } from "vitest";

import { unhides } from "../src/app/canvas/hidden.js";

describe("a card that was asked for and is not on screen", () => {
  it("turns the tests back on for a test file hidden by the setting", () => {
    // The press names the file. A standing preference about a kind of file is
    // weaker evidence of what the reader wants than them naming one of them.
    expect(unhides({ isTest: true }, { showTests: false })).toBe("tests");
  });

  it("changes nothing for a test file while the tests are already on", () => {
    // Hidden for some other reason — a part is open, it has been ticked away —
    // and the host is the one that can say which.
    expect(unhides({ isTest: true }, { showTests: true })).toBeNull();
  });

  it("changes nothing for a file that is not a test", () => {
    expect(unhides({ isTest: false }, { showTests: false })).toBeNull();
  });

  it("changes nothing for a file this reading has never heard of", () => {
    // The reading on screen is older than the reader's own edits. No setting
    // brings back a file that is not in the change.
    expect(unhides(undefined, { showTests: false })).toBeNull();
  });
});
