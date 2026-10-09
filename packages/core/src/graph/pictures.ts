/**
 * Which files are pictures, and how big the picture inside one is.
 *
 * A card is a picture of what happened to a file, and for an image file the
 * diff has nothing to say: git reports the blob as binary, the card draws no
 * rows, and what a reviewer gets is a filename and the word "binary". The one
 * thing they wanted to know — what the image looks like now — is the one thing
 * the card could not tell them.
 *
 * The size is read out of the bytes rather than measured in a browser, and that
 * is the whole reason this module exists. Every card is sized in the extension
 * host before any page exists, because the arrows are placed against those
 * sizes; a card waiting for a browser to tell it how tall it is would have
 * every arrow around it land in the wrong place until it did. So the headers
 * are parsed here: each of these formats writes its dimensions within the first
 * few dozen bytes, and reading them is cheaper and more certain than decoding
 * the image.
 *
 * Nothing here trusts the extension. A file called `.png` holding a JPEG is
 * read as a JPEG, and a file called `.png` holding nothing of the sort is not a
 * picture at all, whatever it is called — the bytes decide, and a card that
 * drew a broken-image glyph because a name lied would be worse than the card
 * that says "binary".
 */

/** What a picture turned out to be. */
export interface Picture {
  /** Intrinsic size in pixels, which is what the card's shape comes from. */
  width: number;
  height: number;
  /** For the data URI the page draws it from. */
  mime: string;
  /**
   * Whether this one also has a diff worth reading.
   *
   * True only for SVG: it is text, so git produces an ordinary patch for it and
   * the card can show either the drawing or the change to the markup. Every
   * other format here has no readable form, so there is nothing to offer.
   */
  textual: boolean;
}

/** The extensions worth opening at all, and what a browser calls each. */
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

/*
 * AVIF and HEIC are deliberately absent.
 *
 * Both are ISO base media files — the same container a video is in — and the
 * size is inside a box inside a box rather than in a header. Listing them
 * without that walk would mean opening every one of them to learn nothing, and
 * a card that read the bytes and then said "binary" anyway. They fall back to
 * what every unreadable blob falls back to, which is honest, and the walk can
 * be written the day one turns up in a change.
 */

/**
 * Whether a path is worth reading the bytes of.
 *
 * A name is not evidence that a file is a picture — that is what the parsing is
 * for — but it is good evidence that it is worth opening, and opening every
 * blob in a change to find out would read the whole repository.
 */
export function looksLikePicture(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return MIME[path.slice(dot + 1).toLowerCase()] !== undefined;
}

/** Whether a path is the one picture format that also has a diff. */
export function isTextualPicture(path: string): boolean {
  return /\.svg$/i.test(path);
}

/**
 * What the bytes are, and how big, or nothing when they are not a picture.
 *
 * Every branch reads a header rather than the image. Where a format can say its
 * size in more than one place, the first authoritative one wins and the rest
 * are not consulted — a second opinion here is a second answer, and the card
 * can only have one shape.
 */
export function pictureIn(bytes: Uint8Array): Picture | undefined {
  return (
    png(bytes) ??
    gif(bytes) ??
    webp(bytes) ??
    bmp(bytes) ??
    ico(bytes) ??
    jpeg(bytes) ??
    svg(bytes)
  );
}

const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u32le = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

function starts(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  return signature.every((byte, i) => bytes[at + i] === byte);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: the size is the first two fields of IHDR, which is always first. */
function png(bytes: Uint8Array): Picture | undefined {
  if (!starts(bytes, PNG_MAGIC) || bytes.length < 24) return undefined;
  return size(u32be(bytes, 16), u32be(bytes, 20), "image/png");
}

/** GIF: a fixed header, little-endian, same for 87a and 89a. */
function gif(bytes: Uint8Array): Picture | undefined {
  if (!starts(bytes, [0x47, 0x49, 0x46, 0x38]) || bytes.length < 10) return undefined;
  return size(u16le(bytes, 6), u16le(bytes, 8), "image/gif");
}

/**
 * WebP, in all three of its shapes.
 *
 * `VP8 ` is lossy, `VP8L` lossless and `VP8X` the extended form that carries an
 * alpha channel or an animation. They agree about nothing: different offsets,
 * different widths of field, and the lossless one packs both dimensions into
 * fourteen bits apiece across four bytes.
 */
function webp(bytes: Uint8Array): Picture | undefined {
  if (!starts(bytes, [0x52, 0x49, 0x46, 0x46]) || !starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return undefined;
  }
  const kind = String.fromCharCode(...bytes.subarray(12, 16));
  if (kind === "VP8 " && bytes.length >= 30) {
    return size(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff, "image/webp");
  }
  if (kind === "VP8L" && bytes.length >= 25) {
    const bits = u32le(bytes, 21);
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, "image/webp");
  }
  if (kind === "VP8X" && bytes.length >= 30) {
    const wide = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const tall = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return size(wide, tall, "image/webp");
  }
  return undefined;
}

/**
 * BMP: little-endian, and its height is signed.
 *
 * A negative height means the rows are stored top down rather than bottom up,
 * which is a fact about the file's layout and not about its shape. Read without
 * the sign it is a card four billion pixels tall.
 */
function bmp(bytes: Uint8Array): Picture | undefined {
  if (!starts(bytes, [0x42, 0x4d]) || bytes.length < 26) return undefined;
  const tall = u32le(bytes, 22) | 0;
  return size(u32le(bytes, 18), Math.abs(tall), "image/bmp");
}

/**
 * ICO: the first entry's size, where a zero means 256.
 *
 * An icon file is several images at several sizes, and the card draws the one a
 * browser picks, which is its own business. The first entry is what its shape
 * is taken from — they are square in practice, and a favicon that is not is
 * still better drawn than described.
 */
function ico(bytes: Uint8Array): Picture | undefined {
  // Reserved zero, type 1 for an icon. Type 2 is a cursor, which has a hotspot
  // where an icon has its colour planes and is not a thing a change contains.
  if (!starts(bytes, [0x00, 0x00, 0x01, 0x00]) || bytes.length < 8) return undefined;
  if (u16le(bytes, 4) === 0) return undefined;
  // A single byte each, so 256 does not fit and is written as zero.
  return size(bytes[6]! || 256, bytes[7]! || 256, "image/x-icon");
}

/**
 * JPEG: walked, because there is no fixed place to look.
 *
 * A JPEG is a chain of segments and the one carrying the dimensions — a
 * start-of-frame — sits after however many tables, comments and thumbnails the
 * encoder felt like writing. So the chain is followed by each segment's own
 * declared length until a frame marker turns up.
 *
 * `0xFFC4`, `0xFFC8` and `0xFFCC` are excluded from the frame markers although
 * they fall inside the range: they are a Huffman table, a reserved extension
 * and an arithmetic-coding table, and reading a table as a frame gives a size
 * out of whatever bytes happened to follow.
 */
function jpeg(bytes: Uint8Array): Picture | undefined {
  if (!starts(bytes, [0xff, 0xd8])) return undefined;

  // Enough to read a marker and the length behind it. What a frame needs is
  // more than that, and the frame itself says so: guarding the loop with a
  // frame's requirement instead stops one byte short of a file whose frame is
  // the last thing in it, which is every file cut to its header.
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1]!;
    // Padding between segments, which is legal and carries no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const frame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (at + 9 > bytes.length) return undefined;
      return size(u16be(bytes, at + 7), u16be(bytes, at + 5), "image/jpeg");
    }

    const length = u16be(bytes, at + 2);
    // A segment shorter than its own length field is a broken file, and
    // stepping by it would not advance.
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

/**
 * SVG: the markup's own `width` and `height`, or the `viewBox` behind them.
 *
 * The viewBox is the fallback and not the first choice, because an SVG with
 * both is saying it wants to be drawn at the stated size. It is a good fallback
 * though: plenty of icons carry only a viewBox, and plenty more state their
 * size in physical units — `12mm` — which say nothing about the proportions of
 * the drawing. Either way only the ratio is used in the end.
 *
 * Read from the first part of the file. An SVG is text and may be a megabyte of
 * path data; the root element is in the first few hundred bytes of all of them.
 */
function svg(bytes: Uint8Array): Picture | undefined {
  const head = text(bytes.subarray(0, 4096));
  if (!/<svg[\s>]/i.test(head)) return undefined;

  const attribute = (name: string) =>
    new RegExp(`<svg[^>]*?\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(head)?.[1];

  const wide = px(attribute("width"));
  const tall = px(attribute("height"));
  if (wide && tall) return size(wide, tall, "image/svg+xml", true);

  const box = attribute("viewBox")?.trim().split(/[\s,]+/);
  if (box?.length === 4) {
    const found = size(Number(box[2]), Number(box[3]), "image/svg+xml", true);
    if (found) return found;
  }
  // A drawing with no stated shape at all. Square is the honest guess, and
  // every renderer that has to pick one picks it.
  return size(1, 1, "image/svg+xml", true);
}

/** A length in a unit that means pixels, or nothing. */
function px(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  if (!match) return undefined;
  const found = Number(match[1]);
  return Number.isFinite(found) && found > 0 ? found : undefined;
}

/** Bytes as text, without pulling Node's Buffer into a module a browser loads. */
function text(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * A size, once it has been checked for being one.
 *
 * Zero in either direction is not a picture anybody can draw, and it divides to
 * infinity in the one place the ratio is used. A ceiling as well, because these
 * numbers come out of a file that may be truncated or may be lying: a header
 * read past the end of a short file yields whatever follows it, and a card a
 * hundred thousand pixels tall is the whole drawing.
 */
const LARGEST = 32_768;

function size(
  width: number,
  height: number,
  mime: string,
  textual = false,
): Picture | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  if (width > LARGEST || height > LARGEST) return undefined;
  return { width: Math.round(width), height: Math.round(height), mime, textual };
}
