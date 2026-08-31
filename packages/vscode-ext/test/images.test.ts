import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodePasted, keepPasted, withImages } from "../src/images.js";

/** A one-pixel PNG, which is a real one: it has to decode. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4" +
  "2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * A screenshot pasted into a conversation.
 *
 * It crosses from the clipboard as a data URI, because that is what the page
 * can hold and draw, and has to become a file before an agent can do anything
 * with it: every one of these tools takes a path.
 */
describe("a picture pasted into a conversation", () => {
  it("takes a data URI apart", () => {
    const decoded = decodePasted(PIXEL);
    expect(decoded?.ext).toBe("png");
    expect(decoded?.bytes.length).toBeGreaterThan(0);
    // The magic number, so this is a PNG rather than something that said it was.
    expect([...decoded!.bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join(""))
      .toBe("PNG");
  });

  it("refuses anything that is not a picture", () => {
    // This decides what gets written to disk from whatever the operating
    // system's clipboard handed the page, so the only shape worth accepting is
    // the one the page produces.
    expect(decodePasted("data:text/html;base64,PGI+aGk8L2I+")).toBeUndefined();
    expect(decodePasted("data:image/png,notbase64")).toBeUndefined();
    expect(decodePasted("https://example.test/x.png")).toBeUndefined();
    expect(decodePasted("")).toBeUndefined();
  });

  it("refuses a picture with nothing in it", () => {
    expect(decodePasted("data:image/png;base64,")).toBeUndefined();
  });

  describe("written somewhere an agent can open it", () => {
    let folder: string;
    beforeAll(() => {
      folder = mkdtempSync(join(tmpdir(), "odin-images-test-"));
    });
    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    it("writes the bytes that were pasted", () => {
      const [path] = keepPasted([{ data: PIXEL }], folder);
      expect(path).toBeDefined();
      expect(path!.endsWith(".png")).toBe(true);
      expect(readFileSync(path!).length).toBe(decodePasted(PIXEL)!.bytes.length);
    });

    it("keeps the ones it can and drops the ones it cannot", () => {
      // A reader who pasted two screenshots and got one through is better
      // served than one whose question never arrived at all.
      const kept = keepPasted(
        [{ data: PIXEL }, { data: "data:text/plain;base64,aGk=" }, { data: PIXEL }],
        folder,
      );
      expect(kept).toHaveLength(2);
    });

    it("gives each one its own name", () => {
      const kept = keepPasted([{ data: PIXEL }, { data: PIXEL }], folder);
      expect(new Set(kept).size).toBe(2);
    });
  });

  describe("named in the message the agent reads", () => {
    it("hangs the pictures off the words", () => {
      expect(withImages("look at this", ["/tmp/a.png"])).toBe(
        "look at this\n\n![pasted image](/tmp/a.png)",
      );
    });

    it("is the whole message when there were no words", () => {
      // "Look at this" is most of what somebody means by pasting a screenshot,
      // and a message that refused to send without a sentence attached would be
      // asking them to type it out.
      expect(withImages("", ["/tmp/a.png"])).toBe("![pasted image](/tmp/a.png)");
    });

    it("leaves a message with no pictures exactly as it was", () => {
      expect(withImages("just words", [])).toBe("just words");
    });
  });
});
