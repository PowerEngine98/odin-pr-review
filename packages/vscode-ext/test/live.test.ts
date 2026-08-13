import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ignoredBy, isNoise, LiveGraph } from "../src/live.js";
import { watched } from "./vscode-stub.js";

const run = promisify(execFile);

let repo = "";

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "odin-live-"));
  const git = (args: string[]) => run("git", args, { cwd: repo });

  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "test@example.test"]);
  await git(["config", "user.name", "Test"]);
  await writeFile(join(repo, ".gitignore"), "build/\n*.log\n");
  await mkdir(join(repo, "build"), { recursive: true });
  await writeFile(join(repo, "build", "out.js"), "//\n");
  await writeFile(join(repo, "noise.log"), "\n");
  await writeFile(join(repo, "src.ts"), "export const a = 1;\n");
  // Tracked despite matching an ignore rule. Someone committed it on purpose,
  // and a file under review is under review whatever its name looks like.
  await writeFile(join(repo, "kept.log"), "\n");
  await git(["add", "-f", ".gitignore", "src.ts", "kept.log"]);
  await git(["commit", "-m", "first"]);
}, 30_000);

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => undefined);
});

describe("what is not worth waking up for", () => {
  it("throws away git's own bookkeeping", () => {
    // An editor with a git extension in it touches the index, the refs and a
    // pile of lock files constantly. Rebuilding for those would mean a graph
    // that rebuilds forever, each rebuild provoking the next.
    expect(isNoise(".git/index")).toBe(true);
    expect(isNoise(".git/refs/heads/main")).toBe(true);
    expect(isNoise("packages/thing/.git/HEAD")).toBe(true);
  });

  it("throws away an editor's swap files", () => {
    expect(isNoise(".src.ts.swp")).toBe(true);
  });

  it("keeps a file that merely has git in its name", () => {
    // `.gitignore` is a project file, and editing it changes what is under
    // review — which is exactly a reason to rebuild.
    expect(isNoise(".gitignore")).toBe(false);
    expect(isNoise("src/github.ts")).toBe(false);
  });

  it("keeps ordinary source", () => {
    expect(isNoise("packages/core/src/index.ts")).toBe(false);
  });
});

describe("asking git what it ignores", () => {
  it("finds the ignored ones", async () => {
    const found = await ignoredBy(repo, ["build/out.js", "noise.log", "src.ts"]);
    expect(found.has("build/out.js")).toBe(true);
    expect(found.has("noise.log")).toBe(true);
    expect(found.has("src.ts")).toBe(false);
  });

  it("does not call a tracked file ignored", async () => {
    // `kept.log` matches `*.log` but was committed anyway. A file that is
    // tracked is under review; that is what tracking means.
    const found = await ignoredBy(repo, ["kept.log"]);
    expect(found.has("kept.log")).toBe(false);
  });

  it("treats nothing matching as an answer, not a failure", async () => {
    // `check-ignore` exits 1 when nothing matched, which reads as a broken
    // command unless it is expected.
    await expect(ignoredBy(repo, ["src.ts"])).resolves.toEqual(new Set());
  });

  it("asks nothing when there is nothing to ask", async () => {
    expect(await ignoredBy(repo, [])).toEqual(new Set());
  });

  it("survives being pointed outside a repository", async () => {
    await expect(ignoredBy(tmpdir(), ["whatever.ts"])).resolves.toBeInstanceOf(Set);
  });
});

/**
 * A repository that is never quiet.
 *
 * The settling delay is reset by every event, and plenty of projects have
 * something writing to them all the time — a dev server, a formatter on save,
 * the git worktrees some tools keep inside the tree. Without a ceiling the
 * delay is a promise that is never kept: the rebuild is postponed forever and
 * the graph looks exactly like one whose watcher has died, which is the hardest
 * kind of failure to tell apart from the code being wrong.
 */
describe("a settling delay that is never allowed to settle", () => {
  it("rebuilds within the ceiling however often the events arrive", async () => {
    let rebuilds = 0;
    const live = new LiveGraph({
      repo,
      settle: 60,
      ceiling: 200,
      rebuild: async () => {
        rebuilds++;
        return undefined;
      },
      onChange: () => {},
    });

    // The reader's own edit, and then something else writing every twenty
    // milliseconds — well inside the settling delay, so without a ceiling the
    // timer is reset before it can ever run.
    const touch = () => watched.change?.({ fsPath: `${repo}/src.ts` });
    touch();
    const noise = setInterval(touch, 20);
    await new Promise((done) => setTimeout(done, 700));
    clearInterval(noise);
    live.dispose();

    expect(rebuilds).toBeGreaterThan(0);
  }, 20_000);
});
