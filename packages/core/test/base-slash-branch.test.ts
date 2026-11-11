import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { followedBase, resolveBaseRef } from "../src/git/exec.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function forge(): { seed: string; clone: string; run: (args: string[], cwd: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), "odin-slash-base-"));
  created.push(dir);
  const origin = join(dir, "origin.git");
  const seed = join(dir, "seed");
  const clone = join(dir, "clone");
  const run = (args: string[], cwd: string) => {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  };
  execFileSync("git", ["init", "--bare", "-b", "develop", origin], { stdio: "ignore" });
  execFileSync("git", ["init", "-b", "develop", seed], { stdio: "ignore" });
  run(["config", "user.email", "t@example.test"], seed);
  run(["config", "user.name", "T"], seed);
  writeFileSync(join(seed, "a.txt"), "one\n");
  run(["add", "."], seed);
  run(["commit", "-m", "first"], seed);
  run(["checkout", "-b", "team/feature"], seed);
  writeFileSync(join(seed, "b.txt"), "two\n");
  run(["add", "."], seed);
  run(["commit", "-m", "feature"], seed);
  run(["remote", "add", "origin", origin], seed);
  run(["push", "origin", "develop", "team/feature"], seed);
  execFileSync("git", ["clone", origin, clone], { stdio: "ignore" });
  run(["branch", "team/feature", "origin/team/feature"], clone);
  return { seed, clone, run };
}

describe("a base branch whose name has a slash in it", () => {
  it("is still a branch, so a local copy that fell behind gives way to the forge's", async () => {
    const { seed, clone, run } = forge();
    writeFileSync(join(seed, "c.txt"), "three\n");
    run(["add", "."], seed);
    run(["commit", "-m", "more"], seed);
    run(["push", "origin", "team/feature"], seed);
    run(["fetch", "origin"], clone);
    expect(await resolveBaseRef("team/feature", { cwd: clone })).toBe("origin/team/feature");
  }, 30_000);

  it("is not confused with a ref that already names its remote", async () => {
    const { clone } = forge();
    expect(await resolveBaseRef("origin/team/feature", { cwd: clone })).toBe("origin/team/feature");
    expect(await resolveBaseRef("team/feature", { cwd: clone })).toBe("team/feature");
  }, 30_000);
});

describe("a pull request whose base branch was merged and deleted", () => {
  it("is measured against the branch the forge now merges it into", async () => {
    const { seed, clone, run } = forge();
    run(["push", "origin", "--delete", "team/feature"], seed);
    run(["fetch", "--prune", "origin"], clone);
    expect(await followedBase("team/feature", "develop", { cwd: clone })).toBe("develop");
    expect(await followedBase("origin/team/feature", "develop", { cwd: clone })).toBe("develop");
  }, 30_000);

  it("keeps a base that is still there, even when the forge names another", async () => {
    const { clone } = forge();
    expect(await followedBase("team/feature", "develop", { cwd: clone })).toBe("team/feature");
    expect(await followedBase("develop", "develop", { cwd: clone })).toBe("develop");
    expect(await followedBase("HEAD~1", "develop", { cwd: clone })).toBe("HEAD~1");
  }, 30_000);
});
