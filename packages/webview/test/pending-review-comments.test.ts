import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PENDING_PREFIX, pendingRemarks } from "../src/app/marks/marks.js";

const read = (path: string) => readFileSync(join(__dirname, "../src/app", path), "utf8");

describe("a review comment not posted yet", () => {
  it("is drawn like any other remark, by the reader, and marked pending", () => {
    const [remark] = pendingRemarks(
      [{ id: "d1", path: "src/Main.kt", side: "head", line: 14, startLine: 12, body: "rename this" }],
      "octocat",
      "data:image/png;base64,AA",
    );
    expect(remark).toMatchObject({
      id: `${PENDING_PREFIX}d1`,
      path: "src/Main.kt",
      side: "head",
      line: 14,
      startLine: 12,
      body: "rename this",
      author: "octocat",
      avatar: "data:image/png;base64,AA",
      pending: true,
    });
  });

  it("covers its one line when it was left on a single line, and says 'you' when nobody is signed in", () => {
    const [remark] = pendingRemarks([{ id: "d2", path: "a.ts", side: "base", line: 3, body: "x" }]);
    expect(remark?.startLine).toBe(3);
    expect(remark?.author).toBe("you");
    expect(remark).not.toHaveProperty("avatar");
  });

  it("gets a face in the margin with a pulsing yellow ring, and its lines pulse when it is open", () => {
    const marks = read("marks/Marks.svelte");
    expect(marks).toMatch(/pendingRemarks\(review\.drafts, model\.current\.viewer, model\.current\.viewerFace\)/);
    expect(marks).toMatch(/pending=\{mark\.thread\.root\.pending === true\}/);
    expect(marks).toMatch(/area = opened\?\.pending \? areaOf\(opened\) : null;/);
    expect(marks).toMatch(/\.pending-area \{[\s\S]*?border: 1\.5px solid var\(--warning\);[\s\S]*?animation: pending-pulse/);
    const mark = read("marks/Mark.svelte");
    expect(mark).toMatch(/\.mark\.pending \.face[\s\S]*?border: 2px solid var\(--warning\);\s*animation: pending-ring/);
  });

  it("opens as itself, without the controls that only make sense once it is posted", () => {
    const thread = read("panels/Thread.svelte");
    expect(thread).toMatch(/pendingRemarks\(review\.drafts, model\.current\.viewer, model\.current\.viewerFace\)/);
    expect(thread).toMatch(/\{#if thread\.root\.pending\}\s*<span class="thread-pending"/);
    expect(thread).toMatch(/\{#if host && !thread\.root\.pending\}\s*<div class="thread-reply">/);
    expect(thread).toMatch(/\{#if host && !comment\.pending\}/);
    expect(thread).toMatch(/class:none=\{local \|\| comment\.pending === true\}/);
  });

  it("is counted on Submit review by a badge in the same pulsing yellow", () => {
    const bar = read("chrome/PrBar.svelte");
    expect(bar).toMatch(/\.submit \.count \{[\s\S]*?background: var\(--warning\);[\s\S]*?animation: pending-badge/);
  });
});

describe("review comments not posted yet, as they are actually stored", () => {
  it("each keep a face of their own, though the stored drafts carry no id", () => {
    const remarks = pendingRemarks([
      { path: "a.ts", side: "RIGHT", line: 3, body: "one" },
      { path: "a.ts", side: "RIGHT", line: 9, body: "two" },
      { path: "a.ts", side: "RIGHT", line: 9, body: "three, on the same line" },
    ]);
    expect(new Set(remarks.map((one) => one.id)).size).toBe(3);
    expect(remarks.every((one) => one.id.startsWith(PENDING_PREFIX) && !one.id.includes("undefined"))).toBe(true);
  });

  it("about the file as a whole, sit by the file's name", () => {
    const [remark] = pendingRemarks([{ path: "a.ts", side: "RIGHT", body: "whole file" }]);
    expect(remark?.wholeFile).toBe(true);
  });
});
