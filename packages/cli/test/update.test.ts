import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { odinRoot, update } from "../src/update.js";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

/**
 * A repository to pull from, and a clone standing in for an installed Odin.
 *
 * The clone carries an install script that writes a marker rather than building
 * anything: what is being tested is whether an update runs it, not what a build
 * does.
 */
function checkout(): { origin: string; clone: string; marker: string } {
  const origin = mkdtempSync(join(tmpdir(), "odin-origin-"));
  made.push(origin);
  git(origin, "init", "--quiet", "-b", "main");
  mkdirSync(join(origin, "scripts"), { recursive: true });
  writeFileSync(join(origin, "README.md"), "one\n");
  const script = join(origin, "scripts", "install.sh");
  writeFileSync(script, '#!/usr/bin/env bash\nprintf ran > "$(dirname "$0")/../installed"\n');
  chmodSync(script, 0o755);
  git(origin, "add", "-A");
  git(origin, "commit", "--quiet", "-m", "one");

  const clone = mkdtempSync(join(tmpdir(), "odin-clone-"));
  made.push(clone);
  rmSync(clone, { recursive: true, force: true });
  git(tmpdir(), "clone", "--quiet", origin, clone);

  return { origin, clone, marker: join(clone, "installed") };
}

/** Something new on main, for the clone to pull. */
function commitOnOrigin(origin: string, what: string): void {
  writeFileSync(join(origin, "README.md"), `${what}\n`);
  git(origin, "add", "-A");
  git(origin, "commit", "--quiet", "-m", what);
}

/**
 * Odin bringing itself level with main.
 *
 * It is installed from a checkout rather than from a registry, so an update is
 * "pull, then build, then put the result back in the editor" — three commands
 * and a directory nobody has thought about since the day they cloned it.
 */
describe("updating Odin", () => {
  it("pulls what is on main and runs the install", async () => {
    const { origin, clone, marker } = checkout();
    commitOnOrigin(origin, "two");

    const done = await update({ root: clone });

    expect(done.arrived).toHaveLength(1);
    expect(done.arrived[0]).toContain("two");
    expect(done.was).not.toBe(done.now);
    expect(done.installed).toBe(true);
    expect(existsSync(marker)).toBe(true);
  }, 30_000);

  it("says so, and installs nothing, when there is nothing to pull", async () => {
    // Rebuilding a copy that has not changed is a minute of somebody's time
    // for no reason, and the answer they wanted was "you are up to date".
    const { clone, marker } = checkout();

    const done = await update({ root: clone });

    expect(done.arrived).toEqual([]);
    expect(done.installed).toBe(false);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  it("refuses to pull over work that is not committed", async () => {
    /*
     * An update is meant to be the boring option. Pulling over somebody's
     * half-finished edit — or stashing it for them — is the opposite of that,
     * and the copy of Odin most likely to have local changes is the one being
     * worked on.
     */
    const { origin, clone } = checkout();
    commitOnOrigin(origin, "two");
    writeFileSync(join(clone, "README.md"), "mine\n");

    await expect(update({ root: clone })).rejects.toThrow(/not committed/);
    expect(git(clone, "log", "--oneline")).not.toContain("two");
  }, 30_000);

  it("refuses when the checkout is on another branch", async () => {
    // Following main from a branch would take the reader off their own work
    // without saying so.
    const { clone } = checkout();
    git(clone, "checkout", "--quiet", "-b", "mine");

    await expect(update({ root: clone })).rejects.toThrow(/is on mine, not main/);
  }, 30_000);

  it("follows another branch when asked to", async () => {
    const { origin, clone, marker } = checkout();
    git(origin, "checkout", "--quiet", "-b", "next");
    commitOnOrigin(origin, "from next");
    git(clone, "fetch", "--quiet", "origin", "next");
    git(clone, "checkout", "--quiet", "-b", "next", "origin/next");
    git(origin, "checkout", "--quiet", "main");
    commitOnOrigin(origin, "later, on next");
    git(origin, "checkout", "--quiet", "next");
    commitOnOrigin(origin, "newer on next");

    const done = await update({ root: clone, branch: "next" });

    expect(done.branch).toBe("next");
    expect(done.installed).toBe(true);
    expect(existsSync(marker)).toBe(true);
  }, 30_000);

  it("says what it would do without doing any of it", async () => {
    const { origin, clone, marker } = checkout();
    commitOnOrigin(origin, "two");

    const said: string[] = [];
    const done = await update({ root: clone, dryRun: true }, (line) => said.push(line));

    expect(done.installed).toBe(false);
    expect(existsSync(marker)).toBe(false);
    expect(git(clone, "log", "--oneline")).not.toContain("two");
    expect(said.join("\n")).toMatch(/would pull main/);
  }, 30_000);

  it("will not merge, only fast-forward", async () => {
    /*
     * A copy with a commit of its own on main has diverged, and an update is
     * not the place to find that out by being dropped into a conflict.
     */
    const { origin, clone } = checkout();
    commitOnOrigin(origin, "theirs");
    writeFileSync(join(clone, "README.md"), "ours\n");
    git(clone, "add", "-A");
    git(clone, "commit", "--quiet", "-m", "ours");

    await expect(update({ root: clone })).rejects.toThrow();
    // Whatever it did, it did not write a merge.
    expect(git(clone, "log", "--oneline").split("\n").filter(Boolean)).toHaveLength(2);
  }, 30_000);

  it("says plainly when it is not looking at a checkout at all", async () => {
    const plain = mkdtempSync(join(tmpdir(), "odin-plain-"));
    made.push(plain);

    await expect(update({ root: plain })).rejects.toThrow(/not a git checkout/);
  }, 30_000);

  it("stops when the new version has no install script", async () => {
    // Better than half an update: the pull has happened and the reader is told
    // exactly what is left to do.
    const { origin, clone } = checkout();
    rmSync(join(origin, "scripts", "install.sh"));
    git(origin, "add", "-A");
    git(origin, "commit", "--quiet", "-m", "no script");

    await expect(update({ root: clone })).rejects.toThrow(/cannot install itself/);
  }, 30_000);
});

/**
 * Where Odin is, from the command that is running.
 *
 * `odin` on a PATH is a symlink into the clone, and asking the link where it is
 * answers `~/.local/bin` — which has no repository in it and never will.
 */
describe("finding the checkout Odin was installed from", () => {
  it("follows the link back to the repository", () => {
    const root = mkdtempSync(join(tmpdir(), "odin-linked-"));
    made.push(root);
    mkdirSync(join(root, "packages", "cli", "dist"), { recursive: true });
    const real = join(root, "packages", "cli", "dist", "main.js");
    writeFileSync(real, "");

    const bin = mkdtempSync(join(tmpdir(), "odin-bin-"));
    made.push(bin);
    const link = join(bin, "odin");
    symlinkSync(real, link);

    expect(odinRoot(link)).toBe(execFileSync("realpath", [root], { encoding: "utf8" }).trim());
  });
});
