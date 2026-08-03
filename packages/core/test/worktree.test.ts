import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { worktreeFor, worktrees } from "../src/git/worktree.js";

const run = promisify(execFile);

let root = "";
let second = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "odin-worktree-"));
  const git = (args: string[], cwd = root) => run("git", args, { cwd });

  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "test@example.test"]);
  await git(["config", "user.name", "Test"]);
  await git(["commit", "--allow-empty", "-m", "first"]);
  await git(["branch", "topic"]);

  second = join(root, "..", `${root.split("/").pop()}-topic`);
  await git(["worktree", "add", second, "topic"]);
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  await rm(second, { recursive: true, force: true }).catch(() => undefined);
});

describe("where a branch is checked out", () => {
  it("finds the worktree holding it", async () => {
    // The reason this exists: git refuses to check a branch out twice, and the
    // useful answer to that refusal is where the other copy is.
    const found = await worktreeFor("topic", { cwd: root });
    expect(found).toBeDefined();
    expect(found).toContain("-topic");
  });

  it("says nothing for a branch nobody has open", async () => {
    expect(await worktreeFor("no-such-branch", { cwd: root })).toBeUndefined();
  });

  it("lists every checkout, including the one asking", async () => {
    const all = await worktrees({ cwd: root });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.map((w) => w.branch)).toContain("main");
    expect(all.map((w) => w.branch)).toContain("topic");
  });

  it("hands back nothing outside a repository", async () => {
    expect(await worktrees({ cwd: tmpdir() })).toEqual([]);
  });
});
