import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodePasted, keepPasted, readImage, withImages } from "../src/images.js";

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

/**
 * Reading a picture back so the page can draw it.
 *
 * A webview cannot open a file on this machine, so the bytes have to travel —
 * which makes this a door into the file system with the page on the other side.
 * It opens exactly as far as the reason for it.
 */
describe("a picture read back for the page", () => {
  let folder: string;
  let outside: string;

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "odin-read-in-"));
    outside = mkdtempSync(join(tmpdir(), "odin-read-out-"));
  });
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("hands back the bytes as something a page can draw", () => {
    const [path] = keepPasted([{ data: PIXEL }], folder);
    const drawn = readImage(path!, [folder]);
    expect(drawn?.startsWith("data:image/png;base64,")).toBe(true);
    expect(drawn).toBe(PIXEL.replace(/\s+/g, ""));
  });

  it("refuses a file outside every folder it was given", () => {
    // The page asking the host to read something it has no business reading is
    // the whole reason this is not just `readFileSync`.
    const [path] = keepPasted([{ data: PIXEL }], outside);
    expect(readImage(path!, [folder])).toBeUndefined();
  });

  it("refuses a path that walks out of the folder", () => {
    const [path] = keepPasted([{ data: PIXEL }], outside);
    const through = join(folder, "..", basename(outside), basename(path!));
    expect(readImage(through, [folder])).toBeUndefined();
  });

  it("refuses a link pointing out of the folder", () => {
    // Resolved before it is compared, or the folder is a door held open by
    // anything anyone can drop into it.
    const [path] = keepPasted([{ data: PIXEL }], outside);
    const link = join(folder, "linked.png");
    symlinkSync(path!, link);
    expect(readImage(link, [folder])).toBeUndefined();
  });

  it("refuses anything that is not a picture", () => {
    const text = join(folder, "notes.txt");
    writeFileSync(text, "hello");
    expect(readImage(text, [folder])).toBeUndefined();
    // Including something that merely sits next to one.
    const shell = join(folder, "run.sh");
    writeFileSync(shell, "#!/bin/sh\n");
    expect(readImage(shell, [folder])).toBeUndefined();
  });

  it("serves a picture pasted by a reading that is over", () => {
    /*
     * A screenshot pasted last week is still named in the remark that carried
     * it, and the folder it went to belonged to a window long gone — so the
     * panel asking for it has never heard of that folder and would refuse its
     * own picture. Odin's own paste folders are served wherever they are.
     */
    const past = mkdtempSync(join(tmpdir(), "odin-pasted-"));
    try {
      const [path] = keepPasted([{ data: PIXEL }], past);
      // Not named among the folders this reading knows about.
      expect(readImage(path!, [folder])).toBe(PIXEL.replace(/\s+/g, ""));
    } finally {
      rmSync(past, { recursive: true, force: true });
    }
  });

  it("does not serve the rest of the temporary directory", () => {
    // The door is Odin's own folders, not everything anyone has left in /tmp.
    const other = mkdtempSync(join(tmpdir(), "somebody-elses-"));
    try {
      const [path] = keepPasted([{ data: PIXEL }], other);
      expect(readImage(path!, [folder])).toBeUndefined();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("says nothing about a file that is not there", () => {
    expect(readImage(join(folder, "gone.png"), [folder])).toBeUndefined();
  });
});
