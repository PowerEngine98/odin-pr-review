import { describe, expect, it } from "vitest";

import {
  isTextualPicture,
  looksLikePicture,
  pictureIn,
} from "../src/graph/pictures.js";

/*
 * Real encoder output, cut to the header each parser reads.
 *
 * Written by `sips` from a 37×19 source, except the WebPs, which came off a
 * photograph because nothing on a Mac will write one — and whose sizes were
 * confirmed with `sips -g pixelWidth -g pixelHeight` rather than taken from
 * this parser. The point of the fixtures is that no byte in them was chosen by
 * the person writing the parser: a header built by hand tests what its author
 * believed the format to be, which is the thing most likely to be wrong.
 *
 * Cut short because the parsers read headers. A truncated file is also the case
 * worth having: these come out of a repository and may be anything.
 */
const PNG_37x19 = "iVBORw0KGgoAAAANSUhEUgAAACUAAAATCAIAAACY31M=";
const PNG_19x37 = "iVBORw0KGgoAAAANSUhEUgAAABMAAAAlCAIAAAAvEUU=";
const GIF_37x19 = "R0lGODdhJQATAOYAAAAAAPkAB/0ECwAHDgEIDwUMEwg=";
const BMP_37x19 = "Qk2GCAAAAAAAADYAAAAoAAAAJQAAAO3///8BABgAAAA=";
const JPEG_37x19 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAA" +
  "A6ABAAMAAAABAAEAAKACAAQAAAABAAAAJaADAAQAAAABAAAAEwAAAAD/7QA4UGhvdG9zaG9wIDMu" +
  "MAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEwAl";
/** The extended form, which carries an alpha channel or an animation. */
const WEBP_VP8X = "UklGRnSIAABXRUJQVlA4WAoAAAAwAAAA0gMAFQUASUM=";
/** Lossy. */
const WEBP_VP8 = "UklGRvyPAABXRUJQVlA4IPCPAABQTQKdASoHA+ADPjE=";
/** Lossless, which packs both dimensions across four bytes. */
const WEBP_VP8L = "UklGRly7AgBXRUJQVlA4TFC7AgAv0kNFEQ11IaL/wUI=";

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const of = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

describe("which files are worth opening", () => {
  it("knows a picture by its name", () => {
    for (const name of ["a.png", "a.JPG", "deep/path/b.jpeg", "c.gif", "d.webp", "e.svg"]) {
      expect(looksLikePicture(name)).toBe(true);
    }
  });

  it("leaves everything else alone", () => {
    for (const name of ["a.ts", "Makefile", "a.png.ts", "noextension", "a.mp4", "a.pdf"]) {
      expect(looksLikePicture(name)).toBe(false);
    }
  });

  it("leaves formats it cannot measure alone", () => {
    // Opening one to learn nothing is worse than not opening it: the card ends
    // up saying "binary" either way, having read the blob to get there.
    expect(looksLikePicture("a.avif")).toBe(false);
    expect(looksLikePicture("a.heic")).toBe(false);
  });

  it("says which one also has a diff to read", () => {
    expect(isTextualPicture("icons/logo.svg")).toBe(true);
    expect(isTextualPicture("icons/logo.png")).toBe(false);
  });
});

describe("the size inside the bytes", () => {
  it("reads a PNG", () => {
    expect(pictureIn(bytes(PNG_37x19))).toEqual({
      width: 37,
      height: 19,
      mime: "image/png",
      textual: false,
    });
  });

  it("keeps width and height the right way round", () => {
    // The one mistake that produces a plausible card: every picture comes out
    // with the proportions of its own transpose, and nothing looks broken.
    const tall = pictureIn(bytes(PNG_19x37));
    expect(tall?.width).toBe(19);
    expect(tall?.height).toBe(37);
  });

  it("reads a GIF", () => {
    expect(pictureIn(bytes(GIF_37x19))).toMatchObject({ width: 37, height: 19 });
  });

  it("reads a BMP", () => {
    expect(pictureIn(bytes(BMP_37x19))).toMatchObject({ width: 37, height: 19 });
  });

  it("reads a JPEG, past whatever the encoder wrote first", () => {
    // This one carries an Exif block and a Photoshop segment before its frame.
    // A parser that looked at a fixed offset would read the Exif header's own
    // numbers and call the picture 26 by 1.
    expect(pictureIn(bytes(JPEG_37x19))).toMatchObject({
      width: 37,
      height: 19,
      mime: "image/jpeg",
    });
  });

  it("reads all three shapes of WebP", () => {
    // They agree about nothing: different offsets, different field widths, and
    // the lossless one packs fourteen bits per dimension across four bytes.
    expect(pictureIn(bytes(WEBP_VP8X))).toMatchObject({ width: 979, height: 1302 });
    expect(pictureIn(bytes(WEBP_VP8))).toMatchObject({ width: 775, height: 992 });
    expect(pictureIn(bytes(WEBP_VP8L))).toMatchObject({ width: 979, height: 1302 });
  });

  it("reads an icon, where zero means 256", () => {
    const icon = new Uint8Array([0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 32, 0]);
    expect(pictureIn(icon)).toMatchObject({ width: 256, height: 256 });
  });

  it("does not believe the extension over the bytes", () => {
    // A file named `.png` holding a JPEG is a JPEG. Trusting the name gives a
    // card drawn as the wrong type, which a browser refuses to show at all.
    expect(pictureIn(bytes(JPEG_37x19))?.mime).toBe("image/jpeg");
  });
});

describe("an SVG, which is markup rather than bytes", () => {
  it("takes the size it asks to be drawn at", () => {
    expect(pictureIn(of('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"></svg>')))
      .toMatchObject({ width: 24, height: 12, mime: "image/svg+xml", textual: true });
  });

  it("falls back to the viewBox", () => {
    // Most icons carry only this.
    expect(pictureIn(of('<svg viewBox="0 0 48 16"><path d="M0 0"/></svg>')))
      .toMatchObject({ width: 48, height: 16 });
  });

  it("prefers the stated size to the viewBox behind it", () => {
    // Both present means the drawing is saying what it wants to be drawn at.
    expect(pictureIn(of('<svg width="10" height="10" viewBox="0 0 100 50"/>')))
      .toMatchObject({ width: 10, height: 10 });
  });

  it("uses the viewBox when the size is in physical units", () => {
    // `12mm` says nothing about the proportions of the drawing.
    expect(pictureIn(of('<svg width="12mm" height="9mm" viewBox="0 0 40 10"/>')))
      .toMatchObject({ width: 40, height: 10 });
  });

  it("falls back to square when it says nothing at all", () => {
    expect(pictureIn(of("<svg><circle r='1'/></svg>"))).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it("reads one that opens with a declaration or a comment", () => {
    const held =
      '<?xml version="1.0"?>\n<!-- drawn by hand -->\n<svg width="8" height="4"/>';
    expect(pictureIn(of(held))).toMatchObject({ width: 8, height: 4 });
  });

  it("is not fooled by XML that is not a drawing", () => {
    expect(pictureIn(of('<?xml version="1.0"?><plist><dict/></plist>'))).toBeUndefined();
  });
});

describe("bytes that are not a picture", () => {
  it("says so for source code", () => {
    expect(pictureIn(of("export const two = one() + 1;\n"))).toBeUndefined();
  });

  it("says so for nothing at all", () => {
    expect(pictureIn(new Uint8Array())).toBeUndefined();
  });

  it("says so for a header that was cut off mid-field", () => {
    // Read past the end, the numbers are whatever follows in memory. The card
    // falls back to saying "binary", which is true.
    expect(pictureIn(bytes(PNG_37x19).subarray(0, 18))).toBeUndefined();
  });

  it("refuses a size no card could be", () => {
    // A PNG header claiming 2^31 pixels. It comes from a file, so it may be
    // truncated or lying, and one card would otherwise be the whole drawing.
    const huge = bytes(PNG_37x19).slice();
    huge.set([0x7f, 0xff, 0xff, 0xff], 16);
    expect(pictureIn(huge)).toBeUndefined();
  });

  it("refuses a picture with no area", () => {
    const flat = bytes(PNG_37x19).slice();
    flat.set([0, 0, 0, 0], 20);
    expect(pictureIn(flat)).toBeUndefined();
  });
});
