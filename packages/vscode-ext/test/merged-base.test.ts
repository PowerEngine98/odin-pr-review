import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildGraphForRepo, stageGraphForRepo, type BuiltGraph } from "../src/graph.js";

const run = promisify(execFile);

let repo = "";
const git = (args: string[]) => run("git", args, { cwd: repo });

function shape(built: BuiltGraph) {
  return {
    mergeBase: built.graph.meta.mergeBase,
    files: built.graph.nodes
      .filter((node) => node.status !== "phantom")
      .map((node) => ({
        path: node.path,
        hunks: node.hunks.map((hunk) => [hunk.newStart, hunk.newLines, hunk.oldStart, hunk.oldLines]),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function settled(built: Promise<{ first: BuiltGraph; rest?: () => Promise<BuiltGraph> }>) {
  const staged = await built;
  return staged.rest ? staged.rest() : staged.first;
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "odin-merged-"));
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "test@example.test"]);
  await git(["config", "user.name", "Test"]);
  await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
  await writeFile(join(repo, "b.ts"), Array.from({ length: 40 }, (_, i) => `export const b${i} = ${i};`).join("\n") + "\n");
  await git(["add", "."]);
  await git(["commit", "-m", "first"]);

  await git(["checkout", "-b", "feature"]);
  await writeFile(join(repo, "mine.ts"), "export const mine = 1;\n");
  await writeFile(join(repo, "a.ts"), "export const a = 2;\n");
  await git(["add", "."]);
  await git(["commit", "-m", "feature work"]);
}, 30_000);

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => undefined);
});

describe("a live reading when the base is merged in", () => {
  it("matches a fresh build after development lands the same code and is merged", async () => {
    const request = { cwd: repo, baseRef: "main", worktree: true, includeImports: false };
    const before = await settled(stageGraphForRepo(request));
    expect(shape(before).files.map((file) => file.path)).toEqual(["a.ts", "mine.ts"]);

    await git(["checkout", "main"]);
    await writeFile(join(repo, "a.ts"), "export const a = 2;\n");
    const b = Array.from({ length: 40 }, (_, i) => `export const b${i} = ${i};`);
    b.splice(5, 0, "export const inserted = 1;", "export const another = 2;");
    await writeFile(join(repo, "b.ts"), b.join("\n") + "\n");
    await git(["add", "."]);
    await git(["commit", "-m", "the same a, landed elsewhere, and more"]);
    await git(["checkout", "feature"]);
    await git(["merge", "--no-edit", "main"]);
    await writeFile(join(repo, "b.ts"), b.map((line) => line.replace("b30 = 30", "b30 = 300")).join("\n") + "\n");

    const after = await settled(stageGraphForRepo(request, before));
    const fresh = await buildGraphForRepo(request);
    expect(shape(after)).toEqual(shape(fresh));
  }, 60_000);
});
