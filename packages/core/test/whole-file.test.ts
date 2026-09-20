import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { graphFromRepo } from "../src/git/diff.js";
import { enrichSnippets, type SnippetOptions } from "../src/git/snippets.js";
import { displayRows, type DisplayRow } from "../src/layout/display.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runner(dir: string): (...args: string[]) => void {
  return (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      },
    });
}

/** A file long enough to have a head and a tail either side of one change. */
function file(middle: string): string {
  return [
    ...Array.from({ length: 12 }, (_, i) => `const above${i + 1} = ${i + 1};`),
    middle,
    ...Array.from({ length: 12 }, (_, i) => `const below${i + 1} = ${i + 1};`),
  ].join("\n") + "\n";
}

const PATH = "src/middle.ts";

/** A repository whose one commit holds the file with the change not yet made. */
function repo(): { dir: string; git: (...args: string[]) => void } {
  const dir = mkdtempSync(join(tmpdir(), "odin-whole-file-"));
  created.push(dir);
  const git = runner(dir);
  git("init", "-b", "main");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, PATH), file(`const middle = 1;`));
  git("add", "-A");
  git("commit", "-m", "first");
  git("branch", "base", "HEAD");
  return { dir, git };
}

/** The rows of the one card, as a reading of this repository draws them. */
async function card(
  dir: string,
  reading: { worktree?: boolean },
  options: SnippetOptions = { cwd: dir },
): Promise<DisplayRow[]> {
  const graph = await graphFromRepo({
    cwd: dir,
    baseRef: "base",
    ...(reading.worktree ? { worktree: true } : {}),
  });
  const snippets = await enrichSnippets(graph, options);
  const node = graph.nodes.find((n) => n.path === PATH)!;
  return displayRows(node, snippets.get(node.id) ?? []);
}

/** The band standing for the run under the last thing the change touched. */
function tail(rows: DisplayRow[]): Extract<DisplayRow, { kind: "gap" }> | undefined {
  const last = rows[rows.length - 1];
  return last && last.kind === "gap" ? last : undefined;
}

/**
 * The file under the change, which a card used to stop short of.
 *
 * "Show the whole file" opens every band a card is holding, and a card had no
 * band for the run below its last hunk: the material was never fetched, so the
 * control showed the file down to the end of the last thing the change touched
 * and no further. Nothing on the card said so, which is the worse half — a
 * change to the middle of a four-hundred-line file looked exactly like a change
 * to the end of a twenty-line one.
 *
 * The lines come from wherever the reading's head is, which is the working tree
 * for a live reading and the commit for a committed one. That is not a new way
 * of reading a file: it is the pass that already fetches the material behind
 * every other band, asked for one more run.
 */
describe("the run of a file below the last hunk", () => {
  it("stands behind a band the reader can open", async () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, PATH), file(`const middle = 2;`));
    git("add", "-A");
    git("commit", "-m", "second");

    const band = tail(await card(dir, {}));
    expect(band?.kind).toBe("gap");
    expect(band?.rows?.map((row) => (row.kind === "gap" ? "" : row.text))).toEqual([
      `const below4 = 4;`,
      `const below5 = 5;`,
      `const below6 = 6;`,
      `const below7 = 7;`,
      `const below8 = 8;`,
      `const below9 = 9;`,
      `const below10 = 10;`,
      `const below11 = 11;`,
      `const below12 = 12;`,
    ]);
    // Numbered where they are in the file, 25 lines long, not where the band is.
    expect(band?.rows?.map((row) => (row.kind === "gap" ? 0 : row.newLine))).toEqual([
      17, 18, 19, 20, 21, 22, 23, 24, 25,
    ]);
    expect(band?.covers?.head).toEqual([17, 25]);
  }, 30_000);

  it("says how long the run is even when it is too long to fetch", async () => {
    // A band that cannot be opened is still worth drawing: it is the only thing
    // on the card that says the file carries on. Dropping it left a card that
    // ended where the change ended, which reads as a file that does.
    const { dir, git } = repo();
    writeFileSync(join(dir, PATH), file(`const middle = 2;`));
    git("add", "-A");
    git("commit", "-m", "second");

    const band = tail(await card(dir, {}, { cwd: dir, maxGapLines: 4 }));
    expect(band?.hidden).toBe(9);
    expect(band?.rows).toBeUndefined();
  }, 30_000);

  it("reads it from the working tree in a live reading", async () => {
    // A live reading is of the files on disk, uncommitted work and all, so the
    // tail of the file is the tail it has this second.
    // Two lines put in at the top and never committed, which move every line
    // under them: the tail read out of the commit would be the right code at
    // the wrong numbers, and the last two lines of the file would be missing
    // altogether, the commit having two fewer lines than the tree.
    const { dir } = repo();
    const working =
      `const first = 0;\nconst second = 0;\n` + file(`const middle = 2;`);
    writeFileSync(join(dir, PATH), working);

    const band = tail(await card(dir, { worktree: true }));
    const lines = working.split("\n");
    expect(band?.rows?.length).toBeGreaterThan(0);
    for (const row of band?.rows ?? []) {
      if (row.kind === "gap" || row.newLine === undefined) continue;
      expect([row.newLine, row.text]).toEqual([row.newLine, lines[row.newLine - 1]]);
    }
    const last = band?.rows?.[band.rows.length - 1];
    expect(last && last.kind !== "gap" ? last.newLine : 0).toBe(27);
  }, 30_000);

  it("reads it from the revision in a committed reading", async () => {
    // And a committed reading is of a commit, whatever the tree it is read from
    // happens to hold: a reviewer with their own work in progress on the same
    // file must not see any of it in the change they are reading.
    const { dir, git } = repo();
    writeFileSync(join(dir, PATH), file(`const middle = 2;`));
    git("add", "-A");
    git("commit", "-m", "second");
    writeFileSync(
      join(dir, PATH),
      file(`const middle = 2;`) + `const notInTheChange = true;\n`,
    );

    const band = tail(await card(dir, {}));
    const texts = band?.rows?.map((row) => (row.kind === "gap" ? "" : row.text)) ?? [];
    expect(texts).not.toContain(`const notInTheChange = true;`);
    expect(texts[texts.length - 1]).toBe(`const below12 = 12;`);
  }, 30_000);
});
