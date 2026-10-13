import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse.js";
import { buildGraph } from "../src/graph/build.js";
import { readPatch } from "../src/git/diff.js";
import { enrichMedia } from "../src/git/media.js";
import { layoutGraph } from "../src/layout/layout.js";
import { cardTitle, titleLength } from "../src/layout/display.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../src/layout/framing.js";
import { DEFAULT_METRICS } from "../src/layout/metrics.js";
import { graphDelta, rowsOnly } from "../src/graph/delta.js";
import { serializeGraph } from "../src/serialize.js";
import type { ChangeGraph } from "../src/model/types.js";

/**
 * A real PNG, written rather than pasted.
 *
 * Small enough to build here and a genuine one: the parser reads a header, so a
 * fixture that is not really a PNG would pass by accident or fail for the wrong
 * reason. 37 by 19, because a square hides the one mistake that matters — width
 * and height the wrong way round.
 */
function png(width: number, height: number, seed = 0): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  // Uncompressed deflate blocks would need framing; zlib is to hand and the
  // bytes after the header are never read by anything under test.
  const rows = Buffer.alloc(height * (width * 3 + 1));
  // So that two pictures of the same size are genuinely different files, which
  // is the case the live comparison has to notice.
  rows.fill(seed);
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A real WAV, built here rather than pasted.
 *
 * Small enough to write and genuinely one: the recogniser reads a header, so a
 * fixture that only claimed to be a WAV would pass by accident or fail for the
 * wrong reason.
 */
function wav(samples = 8): Buffer {
  const data = Buffer.alloc(samples * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(16000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="16"><rect/></svg>\n';

describe("a change with pictures in it", () => {
  let repo: string;
  let graph: ChangeGraph;

  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "odin-pics-"));
    execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
    writeFileSync(join(repo, "readme.md"), "start\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "base");
    run("branch", "base", "HEAD");

    writeFileSync(join(repo, "logo.png"), png(37, 19));
    writeFileSync(join(repo, "icon.png"), png(19, 37));
    writeFileSync(join(repo, "mark.svg"), SVG);
    // Named like a picture and holding nothing of the sort.
    writeFileSync(join(repo, "fake.png"), "this is not a picture\n");
    writeFileSync(join(repo, "chime.wav"), wav());
    // Long names on small contents, which is where the card's own shape and the
    // name it has to carry disagree.
    writeFileSync(join(repo, "notification-knock-1.mp3"), wav());
    writeFileSync(join(repo, "wide-screenshot-of-the-whole-page.png"), png(16, 16));
    // Named like a recording and holding nothing of the sort.
    writeFileSync(join(repo, "fake.mp3"), "this is not a recording\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "pictures");

    const { patch, meta } = await readPatch({ cwd: repo, baseRef: "base", headRef: "main" });
    graph = buildGraph(parseUnifiedDiff(patch), { meta });
    await enrichMedia(graph, { cwd: repo });
  }, 60_000);

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const nodeFor = (path: string) => graph.nodes.find((n) => n.path === path)!;

  it("measures each picture out of its own bytes", () => {
    expect(nodeFor("logo.png").picture).toMatchObject({ width: 37, height: 19 });
    expect(nodeFor("icon.png").picture).toMatchObject({ width: 19, height: 37 });
  });

  it("reads an SVG, and says it has a diff as well as a drawing", () => {
    expect(nodeFor("mark.svg").picture).toMatchObject({
      width: 48,
      height: 16,
      textual: true,
    });
  });

  it("leaves a file that only looks like a picture entirely alone", () => {
    /*
     * The bytes decide. A card drawn from a name that lied is a broken-image
     * glyph where the diff used to be, and the diff is the thing being
     * reviewed.
     */
    expect(nodeFor("fake.png").picture).toBeUndefined();
    expect(graph.media?.[nodeFor("fake.png").id]).toBeUndefined();
  });

  it("carries each drawing as a data URI of the right type", () => {
    const drawing = graph.media?.[nodeFor("logo.png").id];
    expect(drawing).toMatch(/^data:image\/png;base64,/);
    // Round-trips to the same bytes the repository holds, magic number first.
    const bytes = Buffer.from(drawing!.split(",")[1]!, "base64");
    expect([...bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  });

  it("stops drawing once the change has spent its whole budget", async () => {
    /*
     * A per-file limit bounds one card and says nothing about a page. Forty
     * screenshots each under the per-file limit is a document of a third of a
     * gigabyte — not a slow page but a window that never comes back.
     *
     * The ones that do not fit keep no shape either: a card sized for a picture
     * it has not got is an empty frame.
     */
    const { patch, meta } = await readPatch({ cwd: repo, baseRef: "base", headRef: "main" });
    const tight = buildGraph(parseUnifiedDiff(patch), { meta });
    await enrichMedia(tight, { cwd: repo, maxTotalBytes: 100 });

    // One budget across both kinds: a change carrying pictures and recordings
    // must not be allowed to spend the whole of it twice over.
    const kept = tight.nodes.filter((n) => n.picture !== undefined || n.sound !== undefined);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(4);
    for (const node of tight.nodes) {
      if (node.picture || node.sound) expect(tight.media?.[node.id]).toBeTruthy();
      else expect(tight.media?.[node.id]).toBeUndefined();
    }
  }, 30_000);

  it("notices an image whose bytes changed under an identical patch", async () => {
    /*
     * The live-mode fault this was written for.
     *
     * Git reports a binary blob as binary and says nothing else, so replacing
     * an image produces a patch byte-for-byte identical to the one before it:
     * same status, same zero stats, no hunks — and, for an image redrawn at the
     * same size, the same dimensions too. Every fact the comparison looked at
     * was unchanged, so a live reading read the new picture correctly and then
     * threw it away as not news. The card went on showing the old image until
     * something forced a full rebuild.
     */
    const read = async () => {
      const { patch, meta } = await readPatch({ cwd: repo, baseRef: "base", headRef: "main" });
      const g = buildGraph(parseUnifiedDiff(patch), { meta });
      await enrichMedia(g, { cwd: repo });
      return g;
    };

    const before = await read();
    // The same picture, redrawn: identical dimensions, different bytes.
    writeFileSync(join(repo, "logo.png"), png(37, 19, 0xcc));
    run("add", "-A");
    run("commit", "--quiet", "-m", "redrawn");
    const after = await read();

    const id = after.nodes.find((n) => n.path === "logo.png")!.id;
    expect(before.nodes.find((n) => n.id === id)!.picture!.digest).not.toBe(
      after.nodes.find((n) => n.id === id)!.picture!.digest,
    );
    expect(graphDelta(before, after).changed).toContain(id);
    // And the shortcut that would have reused the picture already on screen
    // refuses: a different image is not "only the rows differ".
    expect(rowsOnly(before, after)).toBeUndefined();
  }, 60_000);

  it("says nothing changed when the pictures are the same", async () => {
    // The other half, and the one that makes the first safe: a digest computed
    // afresh on every build must not make every build look like news.
    const read = async () => {
      const { patch, meta } = await readPatch({ cwd: repo, baseRef: "base", headRef: "main" });
      const g = buildGraph(parseUnifiedDiff(patch), { meta });
      await enrichMedia(g, { cwd: repo });
      return g;
    };
    const first = await read();
    const second = await read();
    expect(graphDelta(first, second).changed).toEqual([]);
    expect(rowsOnly(first, second)).toBeDefined();
  }, 60_000);

  it("says what a recording is, so a player can be given its type", () => {
    // Told the wrong type a browser may refuse the file outright, so the bytes
    // decide rather than the name.
    expect(nodeFor("chime.wav").sound).toMatchObject({ mime: "audio/wav" });
    expect(nodeFor("chime.wav").picture).toBeUndefined();
  });

  it("leaves a file that only sounds like a recording alone", () => {
    expect(nodeFor("fake.mp3").sound).toBeUndefined();
    expect(graph.media?.[nodeFor("fake.mp3").id]).toBeUndefined();
  });

  it("carries the recording as a data URI of the right type", () => {
    const held = graph.media?.[nodeFor("chime.wav").id];
    expect(held).toMatch(/^data:audio\/wav;base64,/);
    const bytes = Buffer.from(held!.split(",")[1]!, "base64");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
  });

  it("gives a recording a card the size of a player", () => {
    /*
     * Fixed, which is the whole difference from a picture: a picture decides
     * the shape of its card and a player is the same size whatever is in it.
     */
    const layout = layoutGraph(graph, {});
    const card = layout.nodes.find((n) => n.path === "chime.wav")!;
    expect(card.height).toBe(DEFAULT_METRICS.titleHeight + DEFAULT_METRICS.padding * 2 + PLAYER_HEIGHT);
    expect(card.width).toBe(PLAYER_WIDTH);
  });

  it("never cuts a filename off, however short the thing it holds", () => {
    /*
     * The reported fault: two recordings called `notification-knock-1.mp3` and
     * `notification-knock-2.mp3` drew cards the width of a scrubber, with the
     * beginning of each name cut away — which is the half that says which file
     * it is, since the ones that differ differ at the front.
     *
     * A player decides how much room a player wants and nothing else. The name
     * sits above it and is the one thing on a card that must always be legible.
     */
    const layout = layoutGraph(graph, {});
    for (const path of ["notification-knock-1.mp3", "wide-screenshot-of-the-whole-page.png"]) {
      const card = layout.nodes.find((n) => n.path === path)!;
      const wanted = titleLength(cardTitle(card.node)) * DEFAULT_METRICS.charWidth;
      expect(card.width).toBeGreaterThan(wanted);
    }
  });

  it("shapes each card like the picture it holds", () => {
    const layout = layoutGraph(graph, {});
    const card = (path: string) => layout.nodes.find((n) => n.path === path)!;

    const wide = card("logo.png");
    const tall = card("icon.png");
    // The title and the padding are the difference between the card and the
    // drawing, so the cards differ in height by the difference in the pictures.
    expect(tall.height - wide.height).toBe(37 - 19);
  });

  it("keeps an SVG the width its markup earned", () => {
    /*
     * The one card that can be turned over. A reader switching between the
     * drawing and the patch is asking about one file, and a card that changed
     * width under them would shove every card beside it across the canvas.
     */
    const layout = layoutGraph(graph, {});
    const svg = layout.nodes.find((n) => n.path === "mark.svg")!;
    const widest = Math.max(...SVG.split("\n").map((line) => line.length));
    expect(svg.width).toBeGreaterThan(widest);
  });
});

describe("the document a change is exported as", () => {
  const graph: ChangeGraph = {
    schemaVersion: "0.1.0",
    meta: { generator: "test" } as ChangeGraph["meta"],
    nodes: [
      {
        id: "n:logo.png",
        path: "logo.png",
        status: "added",
        language: "",
        binary: true,
        picture: { width: 37, height: 19, mime: "image/png", textual: false },
        stats: { additions: 0, deletions: 0 },
        hunks: [],
        symbols: [],
      },
    ],
    edges: [],
    media: { "n:logo.png": "data:image/png;base64,AAAAAAAA" },
  };

  it("leaves the pictures themselves out", () => {
    /*
     * The graph object and the exported file are different things. A change
     * with a dozen screenshots in it would otherwise serialise to a file mostly
     * made of base64 — committed, diffed, and reviewed by somebody.
     */
    const written = serializeGraph(graph);
    expect(written).not.toContain("base64");
    expect(written).not.toContain("media");
  });

  it("keeps each picture's shape, which is what sized the card", () => {
    // A document whose cards differ from the page's is a picture of a different
    // change.
    expect(JSON.parse(serializeGraph(graph)).nodes[0].picture).toEqual({
      width: 37,
      height: 19,
      mime: "image/png",
      textual: false,
    });
  });
});
