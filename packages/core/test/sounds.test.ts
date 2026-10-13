import { describe, expect, it } from "vitest";

import { looksLikeSound, soundIn } from "../src/graph/sounds.js";

/*
 * Real encoder output, cut to the header each branch reads.
 *
 * Written by ffmpeg from a four-hundred-millisecond tone, so no byte in them
 * was chosen by the person writing the parser — which is the thing most likely
 * to be wrong. `MP3_BARE` is the same encoder told to write no tag, because an
 * MP3 that opens with a frame rather than with `ID3` is the case that shares a
 * signature with AAC and is therefore the one worth having.
 */
const MP3_TAGGED = "SUQzBAAAAAAAI1RTU0UAAA==";
const MP3_BARE = "//tQxAAACiw=";
const WAV = "UklGRhaKAABXQVZFZm10IA==";
const OGG = "T2dnUwACAAA=";
const FLAC = "ZkxhQwAAACI=";
const M4A = "AAAAHGZ0eXBNNEEgAAACAA==";
const AAC = "//FQQCE//N4=";

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const of = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

describe("which files are worth opening", () => {
  it("knows a recording by its name", () => {
    for (const name of ["a.mp3", "a.WAV", "deep/path/b.ogg", "c.flac", "d.m4a", "e.opus"]) {
      expect(looksLikeSound(name)).toBe(true);
    }
  });

  it("leaves everything else alone", () => {
    for (const name of ["a.ts", "a.png", "Makefile", "noextension", "a.mp4", "a.mov"]) {
      expect(looksLikeSound(name)).toBe(false);
    }
  });

  it("leaves a container it cannot tell sound from film in", () => {
    // WebM holds either, and knowing which means walking the tracks. A card
    // that read the bytes and then drew a player for a video is worse than one
    // that said "binary" without having opened it.
    expect(looksLikeSound("a.webm")).toBe(false);
    expect(looksLikeSound("a.weba")).toBe(false);
  });
});

describe("what the bytes turn out to be", () => {
  it("reads an MP3 that opens with a tag", () => {
    expect(soundIn(bytes(MP3_TAGGED))).toEqual({ mime: "audio/mpeg" });
  });

  it("reads an MP3 that opens with a frame", () => {
    /*
     * The case that matters. A bare MP3 frame and an AAC stream both begin with
     * eleven set bits, so a parser that stops at the sync word calls every one
     * of these AAC — which a browser then refuses to play, with a control on
     * screen and nothing saying why.
     */
    expect(soundIn(bytes(MP3_BARE))).toEqual({ mime: "audio/mpeg" });
  });

  it("tells AAC from it by the bits after the sync word", () => {
    expect(soundIn(bytes(AAC))).toEqual({ mime: "audio/aac" });
  });

  it("reads a WAV, which says so twice", () => {
    expect(soundIn(bytes(WAV))).toEqual({ mime: "audio/wav" });
  });

  it("reads an Ogg, whatever is inside it", () => {
    // Vorbis and Opus share the container, and the container is what a browser
    // is told. Opus from ffmpeg begins identically.
    expect(soundIn(bytes(OGG))).toEqual({ mime: "audio/ogg" });
  });

  it("reads a FLAC", () => {
    expect(soundIn(bytes(FLAC))).toEqual({ mime: "audio/flac" });
  });

  it("reads an MPEG-4 container by its brand", () => {
    expect(soundIn(bytes(M4A))).toEqual({ mime: "audio/mp4" });
  });

  it("does not believe the extension over the bytes", () => {
    // A file named `.mp3` holding a WAV is a WAV. Told the wrong type, a
    // browser may refuse it outright.
    expect(soundIn(bytes(WAV))?.mime).toBe("audio/wav");
  });
});

describe("bytes that are not a recording", () => {
  it("says so for text", () => {
    expect(soundIn(of("export const two = one() + 1;\n"))).toBeUndefined();
  });

  it("says so for nothing at all", () => {
    expect(soundIn(new Uint8Array())).toBeUndefined();
  });

  it("says so for a RIFF that is not a WAVE", () => {
    // RIFF carries AVI and plenty else. The second signature is what settles
    // it, which is why there are two.
    expect(soundIn(of("RIFF\u0000\u0000\u0000\u0000AVI LIST"))).toBeUndefined();
  });

  it("says so for an MPEG-4 container that is not one of ours", () => {
    const odd = new Uint8Array(16);
    odd.set([...Buffer.from("ftyp")], 4);
    odd.set([...Buffer.from("qt  ")], 8);
    expect(soundIn(odd)).toBeUndefined();
  });

  it("says so for a header cut off mid-signature", () => {
    expect(soundIn(bytes(WAV).subarray(0, 6))).toBeUndefined();
    expect(soundIn(bytes(FLAC).subarray(0, 2))).toBeUndefined();
  });
});
