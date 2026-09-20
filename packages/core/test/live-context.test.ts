import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { graphFromRepo } from "../src/git/diff.js";
import { enrichSnippets } from "../src/git/snippets.js";
import { displayRows, pairRows, type DisplayRow } from "../src/layout/display.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function commit(dir: string): (...args: string[]) => void {
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

/** A repository whose one commit holds `text` at `path`. */
function repo(path: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-live-context-"));
  created.push(dir);
  const git = commit(dir);
  git("init", "-b", "main");
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
  git("add", "-A");
  git("commit", "-m", "first");
  git("branch", "base", "HEAD");
  return dir;
}

/**
 * The file as the committed version has it: a change near the top, a stretch
 * nobody touches, and a change near the bottom, so the reading has a band of
 * untouched code between two hunks.
 */
const BASE = [
  `const header = "one";`,
  `const header2 = "two";`,
  ``,
  `export class Session {`,
  `  readonly id: string;`,
  ``,
  `  constructor(id: string) {`,
  `    this.id = id;`,
  `  }`,
  ``,
  `  private readonly delivered = counter(0);`,
  ``,
  `  get seq() {`,
  `    return this.delivered.get();`,
  `  }`,
  `  // the seam, which the file only says once`,
  `  advance(n: number) {`,
  `    return this.delivered.set(n);`,
  `  }`,
  `}`,
  ``,
].join("\n");

/** The same file with two lines inserted at the top and the tail rewritten. */
const WORKING = [
  `const header = "one";`,
  `const header2 = "two";`,
  `const header3 = "three";`,
  `const header4 = "four";`,
  ``,
  `export class Session {`,
  `  readonly id: string;`,
  ``,
  `  constructor(id: string) {`,
  `    this.id = id;`,
  `  }`,
  ``,
  `  private readonly delivered = counter(0);`,
  ``,
  `  get seq() {`,
  `    return this.delivered.get();`,
  `  }`,
  `  // the seam, which the file only says once`,
  `  advance(n: number) {`,
  `    return this.delivered.bump(n);`,
  `    // and say so`,
  `  }`,
  `}`,
  ``,
].join("\n");

/** Every row a card holds, the lines behind its bands included. */
function allRows(rows: readonly DisplayRow[]): DisplayRow[] {
  return rows.flatMap((row) =>
    row.kind === "gap" ? allRows(row.rows ?? []) : [row],
  );
}

/** The card for a file, as a live reading of the working tree draws it. */
async function card(cwd: string, path: string): Promise<DisplayRow[]> {
  const graph = await graphFromRepo({ cwd, baseRef: "base", worktree: true });
  const snippets = await enrichSnippets(graph, { cwd });
  const node = graph.nodes.find((n) => n.path === path)!;
  return displayRows(node, snippets.get(node.id) ?? []);
}

/**
 * A live reading of a working tree that has not been committed.
 *
 * The lines a card shows around its hunks are not in the patch; they are read
 * out of the file and merged in. A live reading is of the working tree, so the
 * file is the one on disk — but the material behind the bands was fetched from
 * the commit `HEAD` names instead, which on a tree with uncommitted work is a
 * different file. Every line inserted above a band slid the text under the
 * numbering by one, so opening a band showed the right lines at the wrong
 * numbers and, where the slide ran past the end of the band, showed lines the
 * hunk below was already showing: the same line of the same file, drawn twice,
 * at two numbers only one of which it has.
 */
describe("the code around a change in a live reading", () => {
  it("draws every line at the number it has in the working tree", async () => {
    const cwd = repo("src/session.ts", BASE);
    writeFileSync(join(cwd, "src/session.ts"), WORKING);

    const lines = WORKING.split("\n");
    for (const row of allRows(await card(cwd, "src/session.ts"))) {
      if (row.kind === "del" || row.newLine === undefined) continue;
      expect([row.newLine, row.text]).toEqual([row.newLine, lines[row.newLine - 1]]);
    }
  }, 30_000);

  it("draws a line of the file once in each pane, at the number it has", async () => {
    const cwd = repo("src/session.ts", BASE);
    writeFileSync(join(cwd, "src/session.ts"), WORKING);

    const seam = `  // the seam, which the file only says once`;
    const pairs = pairRows(allRows(await card(cwd, "src/session.ts")));
    const drawn = (side: "left" | "right") =>
      pairs
        .map((pair) => pair[side])
        .filter((row) => row !== undefined && row.kind !== "gap" && row.text === seam);

    expect(drawn("right").length).toBe(1);
    expect(drawn("left").length).toBe(1);
    // Line 16 of the base and 18 of the working tree, and nowhere else.
    expect(drawn("right").map((row) => (row!.kind === "gap" ? 0 : row!.newLine))).toEqual([18]);
  }, 30_000);

  it("shows both of two lines that genuinely read the same", async () => {
    // Nothing here may be de-duplicated by what a line says. A file is allowed
    // to repeat itself — a closing brace, a blank line, the same call twice —
    // and a card that showed one of them would be hiding a line of the file on
    // the grounds that it had seen those words already.
    const twice = [
      `const header = "one";`,
      ``,
      `export function work() {`,
      `  log("same");`,
      `  log("same");`,
      `  log("same");`,
      `  log("same");`,
      `  log("same");`,
      `  return 1;`,
      `}`,
      ``,
    ].join("\n");
    const cwd = repo("src/twice.ts", twice);
    writeFileSync(
      join(cwd, "src/twice.ts"),
      twice.replace(`const header = "one";`, `const header = "one";\nconst extra = 2;`)
        .replace(`  return 1;`, `  return 2;`),
    );

    const rows = allRows(await card(cwd, "src/twice.ts"));
    const same = rows.filter((row) => row.kind !== "gap" && row.text === `  log("same");`);
    expect(same.length).toBe(5);
    expect(same.map((row) => (row.kind === "gap" ? 0 : row.newLine))).toEqual([5, 6, 7, 8, 9]);
  }, 30_000);
});
