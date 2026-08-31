import { execFileSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseRoot, fetchedPath, findCheckout, isOdinCheckout, odinRoot, update,
} from "../src/update.js";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  made.push(dir);
  return dir;
}

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
 * What makes a directory look like a clone of Odin, and an install that leaves
 * a trace rather than building anything.
 *
 * What is under test is which checkout gets installed and why, not what a build
 * does — so the script writes down that it ran, and from where.
 */
function asOdin(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "odin-pr-review-workspace", private: true }, null, 2),
  );
  mkdirSync(join(dir, "scripts"), { recursive: true });
  const script = join(dir, "scripts", "install.sh");
  writeFileSync(script, '#!/usr/bin/env bash\nroot="$(cd "$(dirname "$0")/.." && pwd)"\ncat "$root/README.md" > "$root/installed"\n');
  chmodSync(script, 0o755);
}

/** An origin with one commit on main, and a clone of it. */
function checkout(): { origin: string; clone: string; installed: string } {
  const origin = scratch("odin-origin-");
  git(origin, "init", "--quiet", "-b", "main");
  asOdin(origin);
  writeFileSync(join(origin, "README.md"), "one\n");
  git(origin, "add", "-A");
  git(origin, "commit", "--quiet", "-m", "one");

  const clone = scratch("odin-clone-");
  rmSync(clone, { recursive: true, force: true });
  git(tmpdir(), "clone", "--quiet", origin, clone);

  return { origin, clone, installed: join(clone, "installed") };
}

/** Something new on main, for a clone to be behind. */
function commitOnOrigin(origin: string, what: string): void {
  writeFileSync(join(origin, "README.md"), `${what}\n`);
  git(origin, "add", "-A");
  git(origin, "commit", "--quiet", "-m", what);
}

/** What the install script recorded: which tree it built. */
const built = (marker: string) => readFileSync(marker, "utf8").trim();

/**
 * Which copy of Odin an update works on, and what it does to it.
 *
 * The rule is that local work wins. Somebody standing in a clone means that
 * clone, including what they have not committed — the usual reason to
 * reinstall is to try the change just made. Only a clean checkout that is
 * purely behind is pulled.
 */
describe("updating the checkout the command was run in", () => {
  it("installs what is here, uncommitted changes and all", async () => {
    const { origin, clone, installed } = checkout();
    commitOnOrigin(origin, "two");
    writeFileSync(join(clone, "README.md"), "mine\n");

    const done = await update({ cwd: clone });

    expect(done.where).toBe("here");
    expect(done.installed).toBe(true);
    expect(done.pulled).toBe(false);
    // What it built is the working tree, not what is on main.
    expect(built(installed)).toBe("mine");
    // And main was left where it was.
    expect(git(clone, "log", "--oneline")).not.toContain("two");
  }, 30_000);

  it("installs what is here when it is ahead of main", async () => {
    const { clone, installed } = checkout();
    writeFileSync(join(clone, "README.md"), "ours\n");
    git(clone, "add", "-A");
    git(clone, "commit", "--quiet", "-m", "ours");

    const done = await update({ cwd: clone });

    expect(done.standing.ahead).toBe(1);
    expect(done.pulled).toBe(false);
    expect(done.installed).toBe(true);
    expect(built(installed)).toBe("ours");
    expect(done.because).toMatch(/main has not got/);
  }, 30_000);

  it("installs what is here rather than merging a copy that has diverged", async () => {
    /*
     * Ahead and behind at once. An update is not the place to discover that by
     * being dropped into a conflict, and the work in front of the reader is
     * the thing they were about to try.
     */
    const { origin, clone, installed } = checkout();
    commitOnOrigin(origin, "theirs");
    writeFileSync(join(clone, "README.md"), "ours\n");
    git(clone, "add", "-A");
    git(clone, "commit", "--quiet", "-m", "ours");

    const done = await update({ cwd: clone });

    expect(done.standing.ahead).toBe(1);
    expect(done.standing.behind).toBe(1);
    expect(done.pulled).toBe(false);
    expect(built(installed)).toBe("ours");
    // Two commits, and no merge among them.
    expect(git(clone, "log", "--oneline").split("\n").filter(Boolean)).toHaveLength(2);
  }, 30_000);

  it("pulls and installs when it is clean and purely behind", async () => {
    const { origin, clone, installed } = checkout();
    commitOnOrigin(origin, "two");

    const done = await update({ cwd: clone });

    expect(done.pulled).toBe(true);
    expect(done.arrived).toHaveLength(1);
    expect(built(installed)).toBe("two");
  }, 30_000);

  it("does nothing at all when it is level and clean", async () => {
    // Rebuilding an unchanged copy is a minute of somebody's time for the
    // answer they already had.
    const { clone, installed } = checkout();

    const done = await update({ cwd: clone });

    expect(done.installed).toBe(false);
    expect(done.because).toBe("already the latest");
    expect(existsSync(installed)).toBe(false);
  }, 30_000);

  it("leaves another branch alone rather than pulling main into it", async () => {
    const { origin, clone, installed } = checkout();
    commitOnOrigin(origin, "two");
    git(clone, "checkout", "--quiet", "-b", "mine");

    const done = await update({ cwd: clone });

    expect(done.pulled).toBe(false);
    expect(done.installed).toBe(false);
    expect(done.because).toMatch(/on mine, 1 behind main — left alone/);
    expect(existsSync(installed)).toBe(false);
  }, 30_000);

  it("is found from anywhere inside the clone", async () => {
    const { clone } = checkout();
    const deep = join(clone, "packages", "cli", "src");
    mkdirSync(deep, { recursive: true });

    expect(findCheckout(deep)).toBe(clone);
  });

  it("says what it would do without doing any of it", async () => {
    const { origin, clone, installed } = checkout();
    commitOnOrigin(origin, "two");
    writeFileSync(join(clone, "README.md"), "mine\n");

    const said: string[] = [];
    const done = await update({ cwd: clone, dryRun: true }, (line) => said.push(line));

    expect(done.installed).toBe(false);
    expect(existsSync(installed)).toBe(false);
    expect(said.join("\n")).toMatch(/would install this checkout as it stands/);
    expect(said.join("\n")).toMatch(/changes that are not committed/);
  }, 30_000);

  it("stops when the checkout has no install script", async () => {
    const { clone } = checkout();
    rmSync(join(clone, "scripts", "install.sh"));

    await expect(update({ cwd: clone })).rejects.toThrow(/cannot install itself/);
  }, 30_000);
});

/**
 * Standing somewhere that is not a clone of Odin.
 *
 * Then the copy that is installed is what "update Odin" means — and when there
 * is not one of those either, one is fetched, because telling that reader to go
 * and clone something is telling them to do the one thing this command is for.
 */
describe("updating from outside any checkout", () => {
  it("falls back to the copy the command itself was installed from", async () => {
    const elsewhere = scratch("odin-elsewhere-");

    const { root, where } = await chooseRoot({ cwd: elsewhere });

    expect(where).toBe("installed");
    expect(root).toBe(odinRoot());
    expect(isOdinCheckout(root)).toBe(true);
  });

  it("fetches a clone when there is no checkout to be found", async () => {
    const { origin } = checkout();
    const home = scratch("odin-home-");
    const kept = fetchedPath(home);

    const said: string[] = [];
    const { root, where } = await chooseRoot(
      // Nothing in the cwd, and nothing behind the command either — which is
      // what a machine that was handed a `.vsix` rather than a clone looks
      // like.
      { cwd: scratch("odin-nothing-"), installed: scratch("odin-none-"), origin, home },
      (line) => said.push(line),
    );

    expect(where).toBe("fetched");
    expect(root).toBe(kept);
    expect(existsSync(join(kept, ".git"))).toBe(true);
    expect(said.join("\n")).toMatch(/fetching one into/);
  }, 60_000);

  it("keeps a fetched clone where such things go", () => {
    const home = "/home/somebody";
    const kept = fetchedPath(home);
    expect(kept.endsWith(join("odin", "checkout"))).toBe(true);
  });
});

/**
 * Where Odin is, from the command that is running.
 *
 * `odin` on a PATH is a symlink into the clone, and asking the link where it is
 * answers `~/.local/bin` — which has no repository in it and never will.
 */
describe("finding the checkout Odin was installed from", () => {
  it("follows the link back to the repository", () => {
    const root = scratch("odin-linked-");
    mkdirSync(join(root, "packages", "cli", "dist"), { recursive: true });
    const real = join(root, "packages", "cli", "dist", "main.js");
    writeFileSync(real, "");

    const bin = scratch("odin-bin-");
    const link = join(bin, "odin");
    symlinkSync(real, link);

    expect(odinRoot(link)).toBe(execFileSync("realpath", [root], { encoding: "utf8" }).trim());
  });
});
