/**
 * Which files are recordings, and what kind each one is.
 *
 * The same argument as the pictures beside it. A diff has nothing to say about
 * a sound file: git reports the blob as binary, the card draws no rows, and the
 * reviewer is told the name and the word "binary" — while the one question they
 * have is what it sounds like now.
 *
 * Less is read than for a picture, and the reason is the card. A picture's
 * proportions decide the shape of the card it sits in, so they have to be known
 * in the extension host before any page exists. A player is the same size
 * whatever is in it, so nothing here has to be parsed for the layout's sake,
 * and the only question left is what the bytes are — which the page needs in
 * order to name the type when it hands them to a browser.
 *
 * The bytes decide, not the name. A file called `.mp3` holding something else
 * is read as that something else, and one holding nothing of the sort is not a
 * recording at all — a player that will not play is worse than the card that
 * says "binary", because it looks like a broken file rather than an unread one.
 */

/** What a recording turned out to be. */
export interface Sound {
  /** What to tell a browser it is, which is all a player needs. */
  mime: string;
  /**
   * What these particular bytes are, short.
   *
   * The same reason the pictures carry one: git says "binary" about a replaced
   * recording and nothing else, so every other fact about the file is identical
   * before and after, and a live reading comparing two builds would find no
   * change and never redraw.
   */
  digest?: string;
}

/** The extensions worth opening at all. */
const HEARD = ["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac"];

/*
 * WebM audio is deliberately absent, as AVIF is from the pictures.
 *
 * Its container is EBML and shared with video, so telling a recording from a
 * film means walking the tracks rather than reading a header — and a card that
 * opened a file to learn nothing, then drew a player for a video, is worse than
 * one that says "binary" without having read anything at all.
 */

/**
 * Whether a path is worth reading the bytes of.
 *
 * A name is not evidence that a file is a recording, but it is good evidence
 * that it is worth opening, and opening every blob in a change to find out
 * would read the whole repository.
 */
export function looksLikeSound(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return HEARD.includes(path.slice(dot + 1).toLowerCase());
}

function starts(bytes: Uint8Array, text: string, at = 0): boolean {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * What the bytes are, or nothing when they are not a recording.
 *
 * Every branch reads a signature at a fixed place, except the two that share
 * one: an MPEG audio frame and an AAC stream both begin with eleven set bits,
 * and the bits after them are what tell the two apart.
 */
export function soundIn(bytes: Uint8Array): Sound | undefined {
  // An MP3 carrying a tag, which is how nearly all of them begin.
  if (starts(bytes, "ID3")) return { mime: "audio/mpeg" };

  if (starts(bytes, "RIFF") && starts(bytes, "WAVE", 8)) return { mime: "audio/wav" };
  // Ogg carries Vorbis and Opus alike, and a browser is told the container.
  if (starts(bytes, "OggS")) return { mime: "audio/ogg" };
  if (starts(bytes, "fLaC")) return { mime: "audio/flac" };

  /*
   * An MPEG frame, or an AAC stream, which begin the same way.
   *
   * Both open with a sync word of eleven set bits. What follows differs: in an
   * ADTS header the next bits name the MPEG version and a layer of zero, which
   * is the thing a layered MPEG frame can never be. So the layer bits settle
   * it, and reading them the wrong way round labels every bare MP3 as AAC —
   * which a browser then refuses to play, with nothing on screen saying why.
   */
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    return (bytes[1]! & 0xf6) === 0xf0
      ? { mime: "audio/aac" }
      : { mime: "audio/mpeg" };
  }

  /*
   * An MPEG-4 container, which says what it holds in its first box.
   *
   * The brand is read rather than the tracks, so a file that is really a film
   * could pass here — but only one that somebody named `.m4a`, since that is
   * what opened it, and the browser will say so by playing the sound and
   * drawing nothing. Walking the tracks to be sure is the same cost as decoding
   * the file, for a case nobody produces by accident.
   */
  if (starts(bytes, "ftyp", 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (/^(M4A|M4B|mp4|iso|dash)/.test(brand)) return { mime: "audio/mp4" };
  }

  return undefined;
}
